import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import {
  generateRecordsRequestPdf,
  type RecordsRequestFields,
} from "@/lib/records-request-pdf";
import { recordsRequest } from "@/lib/emails/templates";
import { sendEmail } from "@/lib/emails/send";

/**
 * Admin-only records-request endpoint.
 *
 * One POST, two modes:
 *   - `mode: "preview"` → generates the letter PDF and streams it back
 *     inline so the compose dialog can show a faithful preview. No
 *     email is sent.
 *   - `mode: "send"` (default) → generates the same PDF and emails it
 *     via Resend from admissions@sailfuture.org to the previous school,
 *     CC admissions@, with the PDF attached. Audit-logged like every
 *     other send when family/year context is supplied.
 *
 * jsPDF + the logo read need Node, so this route opts into the Node
 * runtime explicitly.
 */
export const runtime = "nodejs";

/** Slugify the student name into a friendly attachment filename. */
function pdfFilename(studentName: string): string {
  const safe =
    studentName
      .trim()
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "") || "student";
  return `Records-Request-${safe}.pdf`;
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();

    const body = await req.json().catch(() => ({}) as Record<string, unknown>);
    const mode = body?.mode === "preview" ? "preview" : "send";

    const fields: RecordsRequestFields = {
      studentName: String(body?.studentName ?? "").trim(),
      dateOfBirth: String(body?.dateOfBirth ?? "").trim(),
      previousSchool: String(body?.previousSchool ?? "").trim(),
      effectiveDate: String(body?.effectiveDate ?? "").trim(),
      academicYear: String(body?.academicYear ?? "").trim(),
    };

    // Preview: render whatever's been typed so far (blanks allowed) and
    // stream the bytes straight back for an <iframe> preview.
    if (mode === "preview") {
      const pdf = await generateRecordsRequestPdf(fields);
      // Wrap in a plain Uint8Array — NextResponse's BodyInit type
      // doesn't accept a Node Buffer directly.
      return new NextResponse(new Uint8Array(pdf), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${pdfFilename(fields.studentName)}"`,
          "Cache-Control": "no-store",
        },
      });
    }

    // Send: every field must be filled so the letter doesn't go out
    // with empty blanks, and we need somewhere to send it.
    const recipientEmail = String(body?.recipientEmail ?? "").trim();
    const missing: string[] = [];
    if (!recipientEmail) missing.push("recipient email");
    if (!fields.studentName) missing.push("student name");
    if (!fields.dateOfBirth) missing.push("date of birth");
    if (!fields.previousSchool) missing.push("previous school");
    if (!fields.effectiveDate) missing.push("effective date");
    if (!fields.academicYear) missing.push("academic year");
    if (missing.length > 0) {
      return NextResponse.json(
        { error: `Missing required field(s): ${missing.join(", ")}.` },
        { status: 400 }
      );
    }
    if (!recipientEmail.includes("@")) {
      return NextResponse.json(
        { error: "Recipient email looks invalid." },
        { status: 400 }
      );
    }

    const familyId = Number(body?.familyId);
    const yearId = Number(body?.yearId);

    const pdf = await generateRecordsRequestPdf(fields);
    const result = await sendEmail({
      to: [recipientEmail],
      // Override the default dean@+admissions@ CC — for an external
      // records request the team only needs the single admissions copy.
      cc: ["admissions@sailfuture.org"],
      content: recordsRequest({ student_name: fields.studentName }),
      tag: "records-request",
      familyId: Number.isFinite(familyId) ? familyId : undefined,
      yearId: Number.isFinite(yearId) ? yearId : undefined,
      attachments: [
        { filename: pdfFilename(fields.studentName), content: pdf },
      ],
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error ?? "Email send failed." },
        { status: 502 }
      );
    }
    return NextResponse.json({ ok: true, id: result.id });
  } catch (err) {
    return handleAdminError(err);
  }
}

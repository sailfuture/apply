import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import {
  sendAdditionAcceptedEmail,
  sendAdditionReturnedEmail,
} from "@/lib/emails/triggers";
import { sendAdditionAcceptedSms } from "@/lib/sms/triggers";
import { ADDITION_RETURNED } from "@/lib/midyear-additions";

/**
 * Admissions decision on a mid-year sibling addition (see
 * `lib/midyear-additions.ts`). The family is already accepted for the
 * year, so the family-level Accept / Return on the Decision card can't
 * speak for this one student — this route does, per application:
 *
 *   { action: "accept" }
 *     Requires a submitted application (`addition_submitted_at > 0`)
 *     whose scholarship award admin has confirmed. Creates the student's
 *     `registration_student_registration` packet — the packet's
 *     existence IS the acceptance (`registration_application` has no
 *     decision columns) — and emails + texts the parents a link to the
 *     student's registration. Idempotent: a packet that already exists
 *     returns ok without notifying again.
 *
 *   { action: "return", message?: string }
 *     Sends a submitted, not-yet-accepted application back to the
 *     parents. `addition_submitted_at` goes to the -1 "returned"
 *     sentinel (Xano's PATCH ignores empty inputs, and 0 means "never
 *     submitted"); the parent edits and submits again.
 *
 * Both write an admin note on the family timeline.
 */
/**
 * The addition's packet (or null before it's accepted), for the admin
 * family page's mid-year panel. The tuition signature image is left out
 * — the panel only needs to know whether and when it was signed.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ applicationId: string }> }
) {
  try {
    await requireAdmin();
    const { applicationId } = await params;
    const appId = Number(applicationId);
    if (!Number.isFinite(appId) || appId <= 0) {
      return NextResponse.json(
        { error: "Invalid application id" },
        { status: 400 }
      );
    }
    const app = await xano.applications.getById(appId);
    if (!app || app.is_midyear_addition !== true) {
      return NextResponse.json(
        { error: "Not a mid-year addition" },
        { status: 400 }
      );
    }
    const packet = await xano.studentRegistration.getByStudentAndYear(
      Number(app.registration_students_id),
      Number(app.registration_school_years_id)
    );
    if (!packet) return NextResponse.json({ packet: null });
    const rest: Partial<typeof packet> = { ...packet };
    delete rest.addition_tuition_signature;
    return NextResponse.json({ packet: rest });
  } catch (err) {
    return handleAdminError(err);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ applicationId: string }> }
) {
  try {
    const { admin } = await requireAdmin();
    const { applicationId } = await params;
    const appId = Number(applicationId);
    if (!Number.isFinite(appId) || appId <= 0) {
      return NextResponse.json(
        { error: "Invalid application id" },
        { status: 400 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const action = body?.action;
    if (action !== "accept" && action !== "return") {
      return NextResponse.json(
        { error: "action must be 'accept' or 'return'" },
        { status: 400 }
      );
    }

    const app = await xano.applications.getById(appId);
    if (!app || app.is_midyear_addition !== true) {
      return NextResponse.json(
        { error: "Not a mid-year addition" },
        { status: 400 }
      );
    }
    if (app.isActive === false) {
      return NextResponse.json(
        { error: "This application is archived." },
        { status: 409 }
      );
    }
    const familyId = Number(app.registration_families_id);
    const studentId = Number(app.registration_students_id);
    const yearId = Number(app.registration_school_years_id);
    if (!(familyId > 0 && studentId > 0 && yearId > 0)) {
      return NextResponse.json(
        { error: "Application is missing its family, student or year link." },
        { status: 500 }
      );
    }

    const existingPacket = await xano.studentRegistration.getByStudentAndYear(
      studentId,
      yearId
    );
    const submitted = (app.addition_submitted_at ?? 0) > 0;
    const student = await xano.students.getById(studentId);
    const firstName = student.first_name?.trim() ?? "";
    const studentName = `${firstName} ${student.last_name ?? ""}`.trim();
    const appBase = (
      process.env.NEXT_PUBLIC_APP_URL ?? "https://apply.sailfutureacademy.org"
    ).replace(/\/$/, "");
    const studentUrl = `${appBase}/dashboard/add-student/${appId}`;

    const note = async (text: string) => {
      try {
        await xano.adminNotes.create({
          registration_families_id: familyId,
          registration_students_id: studentId,
          registration_school_years_id: yearId,
          registration_student_registration_progress_id: null,
          registration_family_application_progress_id: null,
          author_email: admin.email,
          author_name: admin.name,
          body: text,
          category: "other",
          is_pinned: false,
          section: "admissions",
          is_shared_with_parent: false,
        });
      } catch (err) {
        console.error(
          `[/api/admin/student-additions/${appId}] audit note failed:`,
          err
        );
      }
    };

    if (action === "accept") {
      if (existingPacket) {
        return NextResponse.json(
          { ok: true, packetId: existingPacket.id, alreadyAccepted: true },
          { status: 200 }
        );
      }
      if (!submitted) {
        return NextResponse.json(
          { error: "The family hasn't submitted this application yet." },
          { status: 409 }
        );
      }
      if (app.confirmed_scholarship !== true) {
        return NextResponse.json(
          {
            error:
              "Confirm this student's scholarship award on the Scholarship Determination card first.",
          },
          { status: 409 }
        );
      }

      const packet = await xano.studentRegistration.resolve(studentId, yearId);

      // Best-effort: the acceptance already landed.
      const [email, sms] = await Promise.allSettled([
        sendAdditionAcceptedEmail(familyId, yearId, firstName, studentUrl),
        sendAdditionAcceptedSms(familyId, yearId, firstName, studentUrl),
      ]);
      const emailSent = email.status === "fulfilled" && email.value.ok;
      const smsSent = sms.status === "fulfilled" && sms.value.ok;
      await note(
        [
          `Accepted ${studentName} (added mid-year). Their registration and tuition paperwork is now open to the family.`,
          `Acceptance email ${emailSent ? "sent" : "NOT sent"}; text ${smsSent ? "sent" : "not sent"}.`,
        ].join("\n")
      );
      return NextResponse.json(
        { ok: true, packetId: packet.id, emailSent, smsSent },
        { status: 200 }
      );
    }

    // ── Return ────────────────────────────────────────────────────────
    if (existingPacket) {
      return NextResponse.json(
        { error: "This student is already accepted." },
        { status: 409 }
      );
    }
    if (!submitted) {
      return NextResponse.json(
        { error: "There's no submitted application to return." },
        { status: 409 }
      );
    }
    const message =
      typeof body?.message === "string" ? body.message.trim().slice(0, 2000) : "";
    const updated = await xano.applications.update(appId, {
      addition_submitted_at: ADDITION_RETURNED,
    });
    let emailSent = false;
    try {
      const res = await sendAdditionReturnedEmail(
        familyId,
        yearId,
        firstName,
        studentUrl,
        message
      );
      emailSent = res.ok;
    } catch (err) {
      console.error(
        `[/api/admin/student-additions/${appId}] returned email failed:`,
        err
      );
    }
    await note(
      [
        `Returned ${studentName}'s mid-year application to the family for changes.`,
        message ? `Message: ${message}` : "No message.",
        `Email ${emailSent ? "sent" : "NOT sent"}.`,
      ].join("\n")
    );
    return NextResponse.json({ ok: true, app: updated, emailSent }, { status: 200 });
  } catch (err) {
    return handleAdminError(err);
  }
}

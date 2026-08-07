import { auth, currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { getResend } from "@/lib/emails/resend";
import { xano } from "@/lib/xano";

/**
 * Full content of one email the school sent this family — fetched
 * from Resend by the audit row's `resend_id` so the parent can read
 * exactly what was delivered.
 *
 * Ownership gate: the id is the family-scoped audit-row id, resolved
 * through `getByFamily` — a parent can never address another
 * family's email.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const familyId = user.publicMetadata.registration_families_id as
    | number
    | undefined;
  if (!familyId) {
    return NextResponse.json({ error: "No family on file" }, { status: 400 });
  }

  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "Invalid email id" }, { status: 400 });
  }

  // Single-row fetch + explicit ownership check — pulling the whole
  // family history here would drag down every stored HTML body just
  // to render one message.
  const row = await xano.emailNotifications.getById(id);
  if (!row || Number(row.registration_families_id) !== familyId) {
    return NextResponse.json(
      { error: "This email isn't available to view." },
      { status: 404 }
    );
  }

  // Prefer our own stored copy — it never expires, and it saves a
  // Resend round trip. Rows sent before the `html` column existed
  // fall through to the Resend lookup below.
  const storedHtml = (row.html ?? "").trim();
  if (storedHtml) {
    return NextResponse.json({
      subject: row.subject,
      html: storedHtml,
      text: "",
      sent_at: row.created_at,
      recipients: row.recipient_emails,
    } satisfies ParentEmailContent);
  }

  if (!row.resend_id) {
    return NextResponse.json(
      { error: "This email isn't available to view." },
      { status: 404 }
    );
  }

  try {
    const { data, error } = await getResend().emails.get(row.resend_id);
    // Resend only retains message content for a limited window (per
    // the account's data-retention setting) — older sends return
    // `not_found`. That's expected, not a fault: report it as a 410
    // so the viewer can say "no longer available" instead of showing
    // a scary error. See the `expired` flag consumers key off.
    if (error?.name === "not_found") {
      return NextResponse.json(
        {
          error:
            "This email is no longer available to view — we only keep the full message for a short time after sending.",
          expired: true,
        },
        { status: 410 }
      );
    }
    if (error || !data) {
      throw new Error(error?.message ?? "Resend returned no data");
    }
    return NextResponse.json({
      subject: data.subject ?? row.subject,
      html: data.html ?? "",
      text: data.text ?? "",
      sent_at: row.created_at,
      recipients: row.recipient_emails,
    } satisfies ParentEmailContent);
  } catch (err) {
    console.error(
      `[/api/notifications/email] Resend fetch failed for ${row.resend_id}:`,
      err
    );
    return NextResponse.json(
      { error: "Couldn't load this email right now — please try again." },
      { status: 502 }
    );
  }
}

export interface ParentEmailContent {
  subject: string;
  html: string;
  text: string;
  sent_at: number;
  recipients: string;
}

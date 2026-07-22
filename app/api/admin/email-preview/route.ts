import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { getResend } from "@/lib/emails/resend";

/**
 * Full-content preview of a sent transactional email.
 *
 *   GET /api/admin/email-preview?id=<resend id>
 *
 * The `email_notifications` audit table stores only the subject +
 * template tag per send — the rendered HTML was never persisted on
 * our side. Resend keeps it: their GET /emails/:id returns the exact
 * from/to/subject/html/text of the message as sent, so the activity
 * stream's "View email" preview proxies through here (admin-gated,
 * API key stays server-side) instead of us re-rendering templates
 * and risking drift from what the family actually received.
 *
 * Degrades with a readable error when the key isn't configured
 * locally or Resend no longer has the message.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const id = req.nextUrl.searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }
    if (!process.env.RESEND_API_KEY) {
      return NextResponse.json(
        {
          error:
            "RESEND_API_KEY isn't configured in this environment, so the sent email can't be retrieved.",
        },
        { status: 503 }
      );
    }

    const resend = getResend();
    const { data, error } = await resend.emails.get(id);
    if (error || !data) {
      return NextResponse.json(
        {
          error: `Resend couldn't return this email${
            error?.message ? `: ${error.message}` : ""
          }`,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      subject: data.subject ?? "",
      from: data.from ?? "",
      to: Array.isArray(data.to) ? data.to.join(", ") : (data.to ?? ""),
      cc: Array.isArray(data.cc) ? data.cc.join(", ") : (data.cc ?? ""),
      html: data.html ?? "",
      text: data.text ?? "",
      createdAt: data.created_at ?? "",
      lastEvent: data.last_event ?? "",
    } satisfies EmailPreviewResponse);
  } catch (err) {
    return handleAdminError(err);
  }
}

export interface EmailPreviewResponse {
  subject: string;
  from: string;
  to: string;
  cc: string;
  html: string;
  text: string;
  createdAt: string;
  lastEvent: string;
}

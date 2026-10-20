import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { getResend } from "@/lib/emails/resend";
import { xano } from "@/lib/xano";

/**
 * Full-content preview of a sent transactional email.
 *
 *   GET /api/admin/email-preview?notificationId=<audit row id>
 *   GET /api/admin/email-preview?id=<resend id>          (legacy)
 *
 * The `registration_email_notifications` audit row keeps the exact
 * HTML we sent (`html` column, written by `lib/emails/send.ts`), so
 * the preview never expires and costs no Resend round trip. Rows
 * written before that column existed carry only `resend_id`; for
 * those — and for the legacy `?id=` form — we fall back to Resend's
 * GET /emails/:id, which returns the message as sent for as long as
 * their retention window keeps it. Past that window Resend answers
 * `not_found`, reported here as a 410 with `expired: true` so the
 * dialog can say "no longer available" rather than "error".
 *
 * Admin-gated; the Resend API key stays server-side.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const notificationIdParam = req.nextUrl.searchParams.get("notificationId");
    const resendIdParam = req.nextUrl.searchParams.get("id");

    if (notificationIdParam) {
      const notificationId = Number(notificationIdParam);
      if (!Number.isFinite(notificationId) || notificationId <= 0) {
        return NextResponse.json(
          { error: "notificationId must be a positive number" },
          { status: 400 }
        );
      }
      const row = await xano.emailNotifications.getById(notificationId);
      if (!row) {
        return NextResponse.json({ error: "Email not found" }, { status: 404 });
      }

      // Our own stored copy first — it is exactly what went out and it
      // never ages out.
      const storedHtml = (row.html ?? "").trim();
      if (storedHtml) {
        return NextResponse.json({
          subject: row.subject ?? "",
          from: "",
          to: row.recipient_emails ?? "",
          cc: row.cc_emails ?? "",
          html: storedHtml,
          text: "",
          createdAt: row.created_at
            ? new Date(row.created_at).toISOString()
            : "",
          lastEvent: row.status ?? "",
        } satisfies EmailPreviewResponse);
      }

      if (!row.resend_id) {
        return NextResponse.json(
          {
            error:
              "This email's content wasn't stored, so there is nothing to show.",
          },
          { status: 404 }
        );
      }
      return fetchFromResend(row.resend_id, {
        subject: row.subject ?? "",
        to: row.recipient_emails ?? "",
        cc: row.cc_emails ?? "",
      });
    }

    if (!resendIdParam) {
      return NextResponse.json(
        { error: "notificationId or id is required" },
        { status: 400 }
      );
    }
    return fetchFromResend(resendIdParam);
  } catch (err) {
    return handleAdminError(err);
  }
}

/** Resend lookup by message id. `fallback` fills in what the audit row
 *  already knows (subject / recipients) when Resend returns blanks. */
async function fetchFromResend(
  resendId: string,
  fallback: { subject?: string; to?: string; cc?: string } = {}
) {
  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json(
      {
        error:
          "RESEND_API_KEY isn't configured in this environment, so the sent email can't be retrieved.",
      },
      { status: 503 }
    );
  }

  const { data, error } = await getResend().emails.get(resendId);
  if (error?.name === "not_found") {
    return NextResponse.json(
      {
        error:
          "This email is no longer available to view — Resend only keeps the full message for a short time after sending.",
        expired: true,
      },
      { status: 410 }
    );
  }
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

  const joined = (v: string | string[] | null | undefined): string =>
    Array.isArray(v) ? v.join(", ") : (v ?? "");

  return NextResponse.json({
    subject: data.subject || fallback.subject || "",
    from: data.from ?? "",
    to: joined(data.to) || fallback.to || "",
    cc: joined(data.cc) || fallback.cc || "",
    html: data.html ?? "",
    text: data.text ?? "",
    createdAt: data.created_at ?? "",
    lastEvent: data.last_event ?? "",
  } satisfies EmailPreviewResponse);
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

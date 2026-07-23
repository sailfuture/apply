import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { xano } from "@/lib/xano";

/**
 * Resend webhook — stamps open-tracking events onto the
 * `registration_email_notifications` audit rows so the activity feed
 * can show "Viewed …" on email bubbles.
 *
 * Handled events:
 *   - `email.opened`  → sets `opened_at` (FIRST open only; later
 *     opens are ignored so the stamp stays "first viewed at")
 *   - `email.bounced` → best-effort flips the row to failed with a
 *     bounce message (only sticks if those inputs exist on the Xano
 *     edit endpoint; harmlessly dropped otherwise)
 *
 * Everything else (delivered, clicked, complained…) is acknowledged
 * and ignored. Rows are matched by `resend_id` = the event's
 * `data.email_id`.
 *
 * Auth: Resend signs webhooks with Svix. We verify the
 * `svix-signature` HMAC against RESEND_WEBHOOK_SECRET (`whsec_…`) —
 * no secret configured → 503 so Resend retries once it's set. The
 * route is Clerk-exempt via the `/api/webhooks(.*)` matcher in
 * proxy.ts.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[resend webhook] RESEND_WEBHOOK_SECRET not set");
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }

  const payload = await req.text();
  const svixId = req.headers.get("svix-id") ?? "";
  const svixTimestamp = req.headers.get("svix-timestamp") ?? "";
  const svixSignature = req.headers.get("svix-signature") ?? "";
  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 401 });
  }

  // Svix scheme: HMAC-SHA256 over `${id}.${timestamp}.${payload}`
  // keyed with the base64-decoded secret (after the `whsec_` prefix);
  // the header carries space-separated `v1,<base64>` candidates.
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = crypto
    .createHmac("sha256", key)
    .update(`${svixId}.${svixTimestamp}.${payload}`)
    .digest("base64");
  const candidates = svixSignature
    .split(" ")
    .map((part) => part.split(",")[1] ?? "")
    .filter(Boolean);
  const valid = candidates.some((sig) => {
    try {
      return crypto.timingSafeEqual(
        Buffer.from(sig),
        Buffer.from(expected)
      );
    } catch {
      return false; // length mismatch
    }
  });
  if (!valid) {
    return NextResponse.json({ error: "Bad signature" }, { status: 401 });
  }
  // Reject stale timestamps (replay window: 5 minutes).
  const ts = Number(svixTimestamp) * 1000;
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > 5 * 60_000) {
    return NextResponse.json({ error: "Stale timestamp" }, { status: 401 });
  }

  let event: {
    type?: string;
    created_at?: string;
    data?: { email_id?: string };
  } | null = null;
  try {
    event = JSON.parse(payload);
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }
  const type = event?.type ?? "";
  const emailId = event?.data?.email_id ?? "";
  if (!emailId || (type !== "email.opened" && type !== "email.bounced")) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  try {
    // Scan-and-match by resend_id — the audit table is small (one row
    // per send) and has no by-resend-id query endpoint.
    const rows = await xano.emailNotifications.getAll();
    const row = rows.find((r) => r.resend_id === emailId);
    if (!row) return NextResponse.json({ ok: true, unmatched: true });

    if (type === "email.opened") {
      if (row.opened_at) {
        return NextResponse.json({ ok: true, already: true });
      }
      const openedAt = event?.created_at
        ? Date.parse(event.created_at) || Date.now()
        : Date.now();
      await xano.emailNotifications.update(row.id, {
        opened_at: openedAt,
      });
      return NextResponse.json({ ok: true, opened: true });
    }

    // email.bounced — best-effort failure stamp (inputs may not be
    // wired on the edit endpoint; Xano drops unknown fields).
    await xano.emailNotifications.update(row.id, {
      status: "failed",
      error_message: "Bounced (Resend webhook)",
    });
    return NextResponse.json({ ok: true, bounced: true });
  } catch (err) {
    console.error("[resend webhook] handling failed:", err);
    // 500 → Resend retries with backoff.
    return NextResponse.json({ error: "Handler failed" }, { status: 500 });
  }
}

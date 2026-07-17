import { NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { syncMessagesFromTwilio } from "@/lib/sms/sync";

/**
 * Admin-triggered Twilio backfill — pulls the recent Twilio message
 * log and imports anything missing from `sms_messages` (texts sent
 * from the Twilio console, the legacy forward-to-email function, or
 * inbound messages from before the webhook was wired up). The
 * messages page fires this on load so the inbox self-heals; the
 * daily cron (`/api/cron/sms-sync`) covers the days nobody opens it.
 *
 * Idempotent (SID-keyed), so firing it on every page load is safe.
 */
export const dynamic = "force-dynamic";
// Twilio list + up to a few hundred sequential Xano inserts on the
// first backfill — give it room beyond the default.
export const maxDuration = 60;

export async function POST() {
  try {
    await requireAdmin();
    const result = await syncMessagesFromTwilio({ days: 30 });
    // `not_configured` (Twilio env vars absent) is an expected state —
    // the sync is simply a no-op, so answer 200 rather than painting a
    // red 502 in the console on every messages-page load. Only a real
    // sync failure (Twilio API error, Xano write failure) is a 502.
    const ok = result.ok || result.skipped === "not_configured";
    return NextResponse.json(result, { status: ok ? 200 : 502 });
  } catch (err) {
    return handleAdminError(err);
  }
}

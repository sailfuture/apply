import { NextRequest, NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { syncMessagesFromTwilio } from "@/lib/sms/sync";

/**
 * Daily Twilio → `sms_messages` reconciliation sweep. The messages
 * page also syncs on load; this cron keeps the log complete on days
 * nobody opens the inbox, so trigger texts, console replies, and
 * inbound messages all land in the portal within a day regardless.
 *
 * Authorization: shared `requireCronAuth` — fails closed in
 * production when `CRON_SECRET` is unset (this route mutates data
 * and returns phone numbers); open only in local dev.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  const result = await syncMessagesFromTwilio({ days: 7 });
  // Not-configured = expected no-op (Twilio env absent), not a failure
  // worth flagging to Vercel Cron's error reporting.
  const ok = result.ok || result.skipped === "not_configured";
  if (!ok) {
    console.error("[cron/sms-sync] sync failed:", result);
  }
  return NextResponse.json(result, { status: ok ? 200 : 502 });
}

import { NextRequest, NextResponse } from "next/server";
import { syncMessagesFromTwilio } from "@/lib/sms/sync";

/**
 * Daily Twilio → `sms_messages` reconciliation sweep. The messages
 * page also syncs on load; this cron keeps the log complete on days
 * nobody opens the inbox, so trigger texts, console replies, and
 * inbound messages all land in the portal within a day regardless.
 *
 * Authorization mirrors `/api/cron/email-reminders`: Vercel Cron
 * sends `Authorization: Bearer $CRON_SECRET` when the env var is
 * set; with it unset (local dev) the endpoint is open for manual
 * spot-checks.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization") ?? "";
  const expected = process.env.CRON_SECRET
    ? `Bearer ${process.env.CRON_SECRET}`
    : null;
  if (expected && authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await syncMessagesFromTwilio({ days: 7 });
  if (!result.ok) {
    console.error("[cron/sms-sync] sync failed:", result);
  }
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}

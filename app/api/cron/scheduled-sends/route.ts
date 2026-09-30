import { NextRequest, NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { runDueScheduledSends } from "@/lib/sms/scheduled";

/**
 * Every 5 minutes: send the texts staff scheduled for a time that has
 * now passed (lib/sms/scheduled.ts). Each row is claimed before it's
 * sent, and the group engine resumes by blast id, so an overlapping run
 * can't repeat a text.
 *
 * Authorization: shared `requireCronAuth` (fails closed in production).
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;
  const result = await runDueScheduledSends();
  if (!result.ok) console.error("[cron/scheduled-sends] failed:", result);
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}

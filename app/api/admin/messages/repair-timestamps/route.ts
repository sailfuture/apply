import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { repairSmsTimestamps } from "@/lib/sms/repair-timestamps";

/**
 * One-time repair for imported SMS rows stamped with the backfill's
 * import time instead of Twilio's real send time — see
 * `lib/sms/repair-timestamps.ts` for the full story.
 *
 * Previews by default: `POST` with no body reports what WOULD change
 * (including a sample of before/after timestamps) and writes nothing.
 * Pass `{ "apply": true }` to actually PATCH the drifted rows.
 *
 * Body: `{ apply?: boolean, days?: number }` — `days` sizes the bulk
 * Twilio window (default 120); anything older is looked up per-SID, so
 * raising it is an optimization, not a requirement.
 *
 * Idempotent: only rows off by more than a minute are touched, so a
 * second run reports 0 drifted.
 */
export const dynamic = "force-dynamic";
// Twilio list + per-SID lookups + sequential Xano PATCHes.
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = await req.json().catch(() => ({}));
    const apply = (body as { apply?: unknown }).apply === true;
    const daysRaw = Number((body as { days?: unknown }).days);
    const days =
      Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(daysRaw, 3650) : 120;

    const result = await repairSmsTimestamps({ days, dryRun: !apply });
    const ok = result.ok || result.skipped === "not_configured";
    return NextResponse.json(result, { status: ok ? 200 : 502 });
  } catch (err) {
    return handleAdminError(err);
  }
}

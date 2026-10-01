import { NextRequest, NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { lastQuoActivity, syncQuoMainLine } from "@/lib/quo/sync";
import { checkDeliveryAndAlert } from "@/lib/sms/delivery-alert";

/**
 * Every 15 minutes: pull the Main Line's recent texts and calls from
 * Quo and upsert anything the webhook missed (see lib/quo/sync.ts).
 * `?since=<unix ms>` widens the window for a backfill; without it the
 * window starts a day before Apply's newest Quo record (or three days
 * back when there is none).
 *
 * Authorization: shared `requireCronAuth` (fails closed in production).
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  const sinceParam = Number(req.nextUrl.searchParams.get("since"));
  const backfill = Number.isFinite(sinceParam) && sinceParam > 0;
  let since: number | undefined;
  if (backfill) {
    since = sinceParam;
  } else {
    const latest = await lastQuoActivity().catch(() => null);
    if (latest) since = latest - 86_400_000;
  }

  const result = await syncQuoMainLine({ since, allDetails: backfill });
  const ok = result.ok || result.skipped === "not_configured";
  if (!ok) console.error("[cron/quo-sync] failed:", result);

  // Carrier-filtering watch (lib/sms/delivery-alert.ts): runs on the
  // same cadence, after the sync has pulled in any receipts the
  // webhook missed. Never fails the sync.
  const delivery = await checkDeliveryAndAlert().catch((err) => {
    console.error("[cron/quo-sync] delivery watch failed:", err);
    return null;
  });
  return NextResponse.json(
    { ...result, delivery: delivery?.verdict ?? null },
    { status: ok ? 200 : 502 }
  );
}

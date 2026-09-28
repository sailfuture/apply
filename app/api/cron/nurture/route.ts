import { NextRequest, NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { syncTourBookings } from "@/lib/tour-sync";
import { runNurture } from "@/lib/nurture/run";

/**
 * Every 30 minutes: pull fresh tour bookings from Google Calendar,
 * then send whatever follow-up texts are due (`lib/nurture`). The plan
 * enforces sending hours (9 AM–7 PM school time) and the on/off
 * switch itself, so this runs around the clock and mostly no-ops.
 *
 * The tour sync used to run only when someone opened the Tours tab;
 * doing it here means a tour booked on the website tonight still gets
 * its reminder tomorrow.
 *
 * Authorization: shared `requireCronAuth` (fails closed in production).
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  const tourSync = await syncTourBookings({
    actor: { email: "", name: "Google Calendar" },
  }).catch((err) => {
    console.error("[cron/nurture] tour sync failed:", err);
    return { error: err instanceof Error ? err.message : "Tour sync failed" };
  });

  const nurture = await runNurture();
  if (!nurture.ok) console.error("[cron/nurture] run failed:", nurture);
  return NextResponse.json(
    { tourSync, nurture },
    { status: nurture.ok ? 200 : 502 }
  );
}

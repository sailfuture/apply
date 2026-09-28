import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { syncTourBookings, type TourSyncResult } from "@/lib/tour-sync";

/**
 * Pull website tour bookings off Google Calendar into the app — see
 * `syncTourBookings` in lib/tour-sync.ts. POST because it writes;
 * fires-and-forgets from the Tours tab on every mount.
 */
export const dynamic = "force-dynamic";

export type { TourSyncResult };

/** Floor for a DEEP sync (`{ deep: true }`) — the start of the
 *  2026 recruitment year, which is as far back as the booking page
 *  has meaningful history. The routine on-mount sync stays on the
 *  30-day window; the manual button asks for everything. */
const DEEP_SYNC_FROM = Date.UTC(2026, 0, 1);

export async function POST(req: NextRequest) {
  try {
    const { admin } = await requireAdmin();
    // `{ deep: true }` widens the window back to DEEP_SYNC_FROM so
    // historical bookings (before this feature existed) import too;
    // `{ since: <unix ms> }` overrides it explicitly. Body is
    // optional — the auto-sync posts nothing.
    const body = await req.json().catch(() => null);
    const sinceParam = Number(body?.since);
    const since = Number.isFinite(sinceParam) && sinceParam > 0
      ? sinceParam
      : body?.deep === true
        ? DEEP_SYNC_FROM
        : null;
    return NextResponse.json(await syncTourBookings({ since, actor: admin }));
  } catch (err) {
    return handleAdminError(err);
  }
}

import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano, type SeasonPublishResult } from "@/lib/xano";
import { repairSeasons, type SeasonRepairResult } from "@/lib/season-sync";

/**
 * Publish the year's seasons to the school apps.
 *
 *   POST { yearId, wait? }
 *     → { released, renames, published }
 *
 * Repairs first (orphaned day stamps released, "Season N" renumbered
 * into calendar order — see `lib/season-sync.ts`), then republishes the
 * school-operations workspace's `seasons` table from the calendar.
 *
 * The repair is awaited because the calendar page refetches straight
 * after and has to show its result. The publish is a ~6s round trip
 * through Xano, so by default it goes out under `after()` — the save
 * that triggered it doesn't wait, and `published` comes back null.
 * `wait: true` (the Sync button) awaits it and reports the counts.
 *
 * Called after every season save, delete and date-range change, so the
 * assembly app reflects an edit in seconds rather than at the next run
 * of the six-hourly Xano task.
 */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 }
      );
    }
    const yearId = Number(body.yearId);
    if (!Number.isFinite(yearId) || yearId <= 0) {
      return NextResponse.json(
        { error: "yearId is required" },
        { status: 400 }
      );
    }

    const repair = await repairSeasons(yearId);

    if (body.wait === true) {
      const published = await xano.academicSeasons.publish();
      return NextResponse.json({
        ...repair,
        published,
      } satisfies SeasonSyncResponse);
    }

    after(async () => {
      try {
        await xano.academicSeasons.publish();
      } catch (err) {
        // A failed publish costs freshness, not correctness — the
        // six-hourly task republishes from the same calendar.
        console.error(
          "[/api/admin/academic-seasons/sync] publish failed:",
          err
        );
      }
    });

    return NextResponse.json({
      ...repair,
      published: null,
    } satisfies SeasonSyncResponse);
  } catch (err) {
    return handleAdminError(err);
  }
}

export interface SeasonSyncResponse extends SeasonRepairResult {
  /** Null when the publish was left to run after the response. */
  published: SeasonPublishResult | null;
}

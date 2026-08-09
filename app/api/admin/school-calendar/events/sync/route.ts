import { NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { isSchoolCalendarPushConfigured } from "@/lib/google-calendar";
import { pushSchoolEventToGoogle } from "@/lib/school-event-sync";
import { xano } from "@/lib/xano";

/**
 * Push EVERY school-calendar event (all years) onto the shared school
 * Google Calendar — the backfill/repair companion to the per-write
 * mirror in the event routes. Safe to run repeatedly: pushes are
 * upserts keyed on deterministic Google event ids, so re-syncing an
 * already-synced event just rewrites it in place.
 *
 * Use it to seed the calendar when the push is first configured, or
 * to retry after a "couldn't be pushed" warning.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Concurrent Google writes — enough to finish a few hundred events
 *  well inside the route budget without tripping rate limits. */
const WORKERS = 4;

export async function POST() {
  try {
    await requireAdmin();
    if (!isSchoolCalendarPushConfigured()) {
      return NextResponse.json(
        {
          error:
            "Google Calendar push isn't configured — set GOOGLE_SCHOOL_CALENDAR_ID " +
            "(alongside the GOOGLE_CALENDAR_* service-account envs) first. " +
            "Calendar apps can still subscribe to the ICS feed meanwhile.",
        },
        { status: 400 }
      );
    }

    const [days, events] = await Promise.all([
      xano.schoolCalendar.getAll(),
      xano.schoolCalendarEvents.getAll(),
    ]);
    const dateByDayId = new Map(days.map((d) => [d.id, d.date]));

    let pushed = 0;
    let failed = 0;
    let skipped = 0;
    const queue = [...events];
    async function worker(): Promise<void> {
      for (;;) {
        const event = queue.shift();
        if (!event) return;
        const date = dateByDayId.get(Number(event.school_calendar_id));
        if (!date) {
          // Orphaned event (its day row is gone) — nothing to place.
          skipped++;
          continue;
        }
        const result = await pushSchoolEventToGoogle(event, date);
        if (result === "synced") pushed++;
        else failed++;
      }
    }
    await Promise.all(Array.from({ length: WORKERS }, worker));

    console.log(
      `[school-calendar sync] total=${events.length} pushed=${pushed} failed=${failed} skipped=${skipped}`
    );
    return NextResponse.json({
      total: events.length,
      pushed,
      failed,
      skipped,
    });
  } catch (err) {
    return handleAdminError(err);
  }
}

import { NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import {
  checkSchoolCalendarAccess,
  isSchoolCalendarPushConfigured,
} from "@/lib/google-calendar";
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

    // Preflight. When the calendar id is wrong or the impersonated
    // account can't reach it, EVERY event fails for that one reason —
    // so say the reason once, up front, instead of returning a bare
    // "N failed" the admin has to go read server logs to understand.
    const access = await checkSchoolCalendarAccess();
    if (!access.ok) {
      console.error(`[school-calendar sync] preflight failed: ${access.reason}`);
      return NextResponse.json({ error: access.reason }, { status: 502 });
    }

    const [days, events, items] = await Promise.all([
      xano.schoolCalendar.getAll(),
      xano.schoolCalendarEvents.getAll(),
      // Once for the run, not once per event — each push needs the
      // event's needs list for its description.
      xano.eventItems.getAll().catch(() => []),
    ]);
    const dateByDayId = new Map(days.map((d) => [d.id, d.date]));
    const itemsByEvent = new Map<number, typeof items>();
    for (const it of items) {
      const eid = Number(it.school_calendar_events_id);
      const list = itemsByEvent.get(eid) ?? [];
      list.push(it);
      itemsByEvent.set(eid, list);
    }
    for (const list of itemsByEvent.values()) {
      list.sort(
        (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.id - b.id
      );
    }

    let pushed = 0;
    let failed = 0;
    let skipped = 0;
    let firstError: string | undefined;
    // A run that has failed this many times in a row without a single
    // success is hitting something systemic (read-only sharing, a
    // revoked key). Stop rather than spend the whole route budget
    // re-proving it.
    const ABORT_AFTER_FAILURES = 5;
    let aborted = false;

    const queue = [...events];
    async function worker(): Promise<void> {
      for (;;) {
        if (aborted) return;
        const event = queue.shift();
        if (!event) return;
        const date = dateByDayId.get(Number(event.school_calendar_id));
        if (!date) {
          // Orphaned event (its day row is gone) — nothing to place.
          // Counted separately: it's a data problem, not a Google one.
          skipped++;
          continue;
        }
        const result = await pushSchoolEventToGoogle(
          event,
          date,
          itemsByEvent.get(event.id) ?? []
        );
        if (result.status === "synced") {
          pushed++;
          continue;
        }
        failed++;
        if (!firstError && result.error) firstError = result.error;
        if (pushed === 0 && failed >= ABORT_AFTER_FAILURES) aborted = true;
      }
    }
    await Promise.all(Array.from({ length: WORKERS }, worker));

    console.log(
      `[school-calendar sync] total=${events.length} pushed=${pushed} failed=${failed} skipped=${skipped}${
        aborted ? " (aborted early)" : ""
      }${firstError ? ` firstError=${firstError}` : ""}`
    );
    return NextResponse.json({
      total: events.length,
      pushed,
      failed,
      skipped,
      aborted,
      firstError,
    });
  } catch (err) {
    return handleAdminError(err);
  }
}

import {
  deleteSchoolEvent,
  isSchoolCalendarPushConfigured,
  upsertSchoolEvent,
} from "@/lib/google-calendar";
import { calendarEventDescription } from "@/lib/school-calendar";
import { loadEventItems } from "@/lib/school-event-items";
import type { XanoSchoolCalendarEvent } from "@/lib/xano";

/**
 * Best-effort mirror of school-calendar events onto the shared school
 * Google Calendar — the push complement to the pull-based ICS feed
 * (/api/calendar-feed), which Google only refreshes every ~8-24 hours.
 * The event routes call these after every Xano write so a change shows
 * up on Google within seconds instead of a day.
 *
 * Contract (same as the tour sync): the Xano row is the source of
 * truth and has already been written — these helpers NEVER throw, they
 * log and report so the route can attach a warning to an otherwise
 * successful response. Unconfigured (`GOOGLE_SCHOOL_CALENDAR_ID`
 * unset) reports "off", which is not a warning — the ICS feed still
 * covers those deployments.
 */

// Description is built by `calendarEventDescription` in
// lib/school-calendar, shared with the ICS feed so an event reads the
// same whether it reached the parent by push or by subscription —
// including the RSVP deep link on sign-up events.

/**
 * Outcome of one push. `error` carries Google's own explanation on
 * failure — the bulk-sync route reports it to the admin, because
 * "check the server logs" is not something an admin staring at a
 * toast can act on.
 */
export interface SchoolEventSyncResult {
  status: "synced" | "failed" | "off";
  error?: string;
}

/** Upsert one event onto the school calendar. `dayDate` is the
 *  event's `school_calendar` day ("YYYY-MM-DD") — undefined when the
 *  day row couldn't be resolved, which fails the push (an all-day
 *  event without a date can't be placed). */
export async function pushSchoolEventToGoogle(
  event: XanoSchoolCalendarEvent,
  dayDate: string | undefined,
  /** The event's needs rows. Pass them when you already have them —
   *  the bulk sync reads the item table once for the whole run rather
   *  than once per event. Omitted, they're fetched here. */
  items?: Array<{ label: string; quantity: number }>
): Promise<SchoolEventSyncResult> {
  if (!isSchoolCalendarPushConfigured()) return { status: "off" };
  if (!dayDate) {
    const error = `Event ${event.id} ("${event.title}") points at calendar day ${event.school_calendar_id}, which no longer exists — it has no date to place on Google.`;
    console.error(`[school-event-sync] ${error}`);
    return { status: "failed", error };
  }
  try {
    await upsertSchoolEvent(event.id, {
      summary: event.title,
      // Items come from their own table now, so the description
      // builder can't read them off the event row.
      description: calendarEventDescription(
        event,
        items ?? (await loadEventItems(event.id))
      ),
      location: (event.location ?? "").trim(),
      date: dayDate,
      startMs: Number(event.start_time) || 0,
      endMs: Number(event.end_time) || 0,
    });
    return { status: "synced" };
  } catch (err) {
    console.error(
      `[school-event-sync] Google push failed for event ${event.id}:`,
      err
    );
    return {
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Delete one event from the school calendar (post-Xano-delete). */
export async function removeSchoolEventFromGoogle(
  eventId: number
): Promise<"removed" | "failed" | "off"> {
  if (!isSchoolCalendarPushConfigured()) return "off";
  try {
    await deleteSchoolEvent(eventId);
    return "removed";
  } catch (err) {
    console.error(
      `[school-event-sync] Google delete failed for event ${eventId}:`,
      err
    );
    return "failed";
  }
}

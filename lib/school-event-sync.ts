import {
  deleteSchoolEvent,
  isSchoolCalendarPushConfigured,
  upsertSchoolEvent,
} from "@/lib/google-calendar";
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

/** Google-facing description — the event description plus the same
 *  mandatory/volunteer footnotes the ICS feed appends. */
function googleDescription(e: XanoSchoolCalendarEvent): string {
  return [
    e.description?.trim() ?? "",
    e.mandatory ? "Mandatory attendance." : "",
    e.parent_volunteer_hours
      ? `Counts toward parent volunteer hours (${e.volunteer_hour_total || 0} hrs).`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Upsert one event onto the school calendar. `dayDate` is the
 *  event's `school_calendar` day ("YYYY-MM-DD") — undefined when the
 *  day row couldn't be resolved, which fails the push (an all-day
 *  event without a date can't be placed). */
export async function pushSchoolEventToGoogle(
  event: XanoSchoolCalendarEvent,
  dayDate: string | undefined
): Promise<"synced" | "failed" | "off"> {
  if (!isSchoolCalendarPushConfigured()) return "off";
  if (!dayDate) {
    console.error(
      `[school-event-sync] no calendar day found for event ${event.id} (day ${event.school_calendar_id}) — skipping Google push`
    );
    return "failed";
  }
  try {
    await upsertSchoolEvent(event.id, {
      summary: event.title,
      description: googleDescription(event),
      location: (event.location ?? "").trim(),
      date: dayDate,
      startMs: Number(event.start_time) || 0,
      endMs: Number(event.end_time) || 0,
    });
    return "synced";
  } catch (err) {
    console.error(
      `[school-event-sync] Google push failed for event ${event.id}:`,
      err
    );
    return "failed";
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

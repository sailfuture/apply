import { xano } from "@/lib/xano";
import { SCHOOL_TIME_ZONE } from "@/lib/school-calendar";

/**
 * Cancel a family's event sign-ups: their `school_event_rsvps` rows
 * and the item claims ("we'll bring 2 of the 4 chaperones") that hang
 * off the same events.
 *
 * Two callers:
 *   - unenrolling a family's LAST enrolled student (`upcomingOnly`) —
 *     the spots and items they'd committed to for events still ahead
 *     go back to families who are still here, while past sign-ups
 *     stay as history for the volunteer-hours ledger.
 *   - the delete-family cascade (everything) — nothing about the
 *     family survives, so neither do its sign-ups.
 *
 * Throws only when the initial reads fail (a table missing, Xano
 * down). Per-row deletes are settled individually and reported in
 * `failures`, so one stuck row never stops the rest.
 */
export interface CancelSignupsResult {
  rsvpsRemoved: number;
  claimsRemoved: number;
  failures: string[];
}

export async function cancelFamilyEventSignups(
  familyId: number,
  { upcomingOnly }: { upcomingOnly: boolean }
): Promise<CancelSignupsResult> {
  const [rsvps, claims, items, events, days] = await Promise.all([
    xano.eventRsvps.getAll(),
    xano.eventItemClaims.getAll(),
    xano.eventItems.getAll(),
    xano.schoolCalendarEvents.getAll(),
    xano.schoolCalendar.getAll(),
  ]);

  // "Upcoming" is judged by the event's calendar day in the school's
  // timezone — the same test the parent RSVP endpoint uses to refuse
  // sign-ups for events that already happened.
  const inScope = (eventId: number): boolean => {
    if (!upcomingOnly) return true;
    return upcomingEventIds.has(eventId);
  };
  const upcomingEventIds = new Set<number>();
  if (upcomingOnly) {
    const todayIso = new Date().toLocaleDateString("en-CA", {
      timeZone: SCHOOL_TIME_ZONE,
    });
    const dayById = new Map(days.map((d) => [d.id, d]));
    for (const e of events) {
      const day = dayById.get(Number(e.school_calendar_id));
      if (day && day.date >= todayIso) upcomingEventIds.add(e.id);
    }
  }

  const myRsvps = rsvps.filter(
    (r) =>
      Number(r.registration_families_id) === familyId &&
      inScope(Number(r.school_calendar_events_id))
  );
  // A claim reaches its event through the item it's against. Under
  // `upcomingOnly` a claim whose item is gone can't be dated, so it's
  // left alone; when deleting everything it goes with the rest.
  const eventByItem = new Map(
    items.map((it) => [it.id, Number(it.school_calendar_events_id)])
  );
  const myClaims = claims.filter((c) => {
    if (Number(c.registration_families_id) !== familyId) return false;
    const eventId = eventByItem.get(Number(c.registration_school_event_items_id));
    return eventId === undefined ? !upcomingOnly : inScope(eventId);
  });

  const failures: string[] = [];
  const count = (
    label: string,
    results: PromiseSettledResult<unknown>[]
  ): number => {
    let ok = 0;
    for (const r of results) {
      if (r.status === "fulfilled") ok += 1;
      else
        failures.push(
          `${label}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`
        );
    }
    return ok;
  };

  const rsvpsRemoved = count(
    "RSVP",
    await Promise.allSettled(myRsvps.map((r) => xano.eventRsvps.delete(r.id)))
  );
  const claimsRemoved = count(
    "item claim",
    await Promise.allSettled(
      myClaims.map((c) => xano.eventItemClaims.delete(c.id))
    )
  );

  return { rsvpsRemoved, claimsRemoved, failures };
}

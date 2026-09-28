import { xano } from "@/lib/xano";
import type { XanoEventRsvp, XanoSchoolEventItemClaim } from "@/lib/xano";
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

/** What one family should hold on one event once a save lands. */
export interface FamilySignup {
  eventId: number;
  familyId: number;
  /** Parent spots reserved, >= 1. */
  spots: number;
  /** "Who's coming", already trimmed. "" clears it. */
  comment: string;
  /** The family's COMPLETE set of claims on this event's items —
   *  anything they held that isn't listed is released. */
  claims: Array<{ itemId: number; quantity: number }>;
}

/** The sign-up tables as the caller already loaded them to validate,
 *  so the write reconciles against the same snapshot. */
export interface SignupTables {
  rsvps: XanoEventRsvp[];
  claims: XanoSchoolEventItemClaim[];
  /** The event's own item ids. Claims on any other item belong to
   *  other events and are never touched. */
  eventItemIds: Set<number>;
}

/**
 * Write one family's sign-up for one event — their RSVP row and their
 * claims on the event's items — to exactly `signup`. Shared by the
 * parent RSVP route and admin's RSVP editing so both write the same
 * way; validation is the caller's (parents are held to the event's
 * limits, admin may go past them).
 *
 * Claims are reconciled rather than replaced: a claim already at the
 * wanted count is left alone, anything else is deleted and re-created.
 * Nothing references claim ids, so re-creating is safe, and it avoids
 * leaning on PATCH for a table only ever written by POST/DELETE.
 */
export async function saveFamilyEventSignup(
  signup: FamilySignup,
  tables: SignupTables
): Promise<void> {
  const { eventId, familyId, spots, comment } = signup;

  const wanted = new Map<number, number>();
  for (const c of signup.claims) {
    if (c.quantity <= 0) continue;
    wanted.set(c.itemId, (wanted.get(c.itemId) ?? 0) + c.quantity);
  }
  const held = new Map<number, XanoSchoolEventItemClaim[]>();
  for (const c of tables.claims) {
    if (Number(c.registration_families_id) !== familyId) continue;
    const itemId = Number(c.registration_school_event_items_id);
    if (!tables.eventItemIds.has(itemId)) continue;
    const rows = held.get(itemId) ?? [];
    rows.push(c);
    held.set(itemId, rows);
  }
  const claimDeletes: number[] = [];
  const claimCreates: Array<{ itemId: number; quantity: number }> = [];
  for (const [itemId, rows] of held) {
    const want = wanted.get(itemId) ?? 0;
    if (rows.length === 1 && Number(rows[0].quantity) === want) continue;
    claimDeletes.push(...rows.map((r) => r.id));
    if (want > 0) claimCreates.push({ itemId, quantity: want });
  }
  for (const [itemId, quantity] of wanted) {
    if (!held.has(itemId)) claimCreates.push({ itemId, quantity });
  }
  for (const id of claimDeletes) {
    await xano.eventItemClaims.delete(id);
  }
  for (const c of claimCreates) {
    await xano.eventItemClaims.create({
      registration_school_event_items_id: c.itemId,
      registration_families_id: familyId,
      quantity: c.quantity,
    });
  }

  // One RSVP row per (event, family). A duplicate would double-count
  // the family's spots, so any extra rows go.
  const [mine, ...duplicates] = tables.rsvps.filter(
    (r) =>
      Number(r.school_calendar_events_id) === eventId &&
      Number(r.registration_families_id) === familyId
  );
  for (const d of duplicates) {
    await xano.eventRsvps.delete(d.id);
  }
  const currentComment = (mine?.comment ?? "").trim();
  if (mine && (comment || !currentComment)) {
    const patch: Partial<XanoEventRsvp> = {};
    if (Number(mine.spots) !== spots) patch.spots = spots;
    if (comment && comment !== currentComment) patch.comment = comment;
    if (Object.keys(patch).length > 0) {
      await xano.eventRsvps.update(mine.id, patch);
    }
  } else {
    // Clearing the comment can't go through PATCH — this table's
    // comment input trims the usual " " sentinel to "" and Xano then
    // drops the empty input, leaving the old text in place (verified
    // live 2026-08-06). Recreate the row instead; nothing references
    // RSVP ids, so the id churn is harmless.
    if (mine) await xano.eventRsvps.delete(mine.id);
    await xano.eventRsvps.create({
      school_calendar_events_id: eventId,
      registration_families_id: familyId,
      spots,
      comment,
    });
  }
}

/**
 * Cancel one family's sign-up for one event: its RSVP row(s) and its
 * claims on the event's items. Leaving the claims behind would hold
 * that capacity against an event nobody from the family is attending.
 */
export async function removeFamilyEventSignup(
  eventId: number,
  familyId: number,
  tables: SignupTables
): Promise<void> {
  for (const r of tables.rsvps) {
    if (Number(r.school_calendar_events_id) !== eventId) continue;
    if (Number(r.registration_families_id) !== familyId) continue;
    await xano.eventRsvps.delete(r.id);
  }
  for (const c of tables.claims) {
    if (Number(c.registration_families_id) !== familyId) continue;
    if (!tables.eventItemIds.has(Number(c.registration_school_event_items_id))) {
      continue;
    }
    await xano.eventItemClaims.delete(c.id);
  }
}

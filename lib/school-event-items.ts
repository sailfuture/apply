import { xano } from "@/lib/xano";
import type { XanoSchoolEventItem } from "@/lib/xano";

/**
 * Server-side reconcile for an event's needs list
 * (`registration_school_event_items`).
 *
 * The admin dialog always submits the COMPLETE list, so the client
 * never has to track deletions: rows carrying an id are updated in
 * place, rows without one are inserted, and any existing row whose id
 * isn't in the submitted set is deleted.
 *
 * Updating in place (rather than delete-all + re-insert) is the whole
 * point of the table. Item ids are what family claims reference, so
 * recreating rows on every save would detach every claim — the exact
 * failure the previous text-encoded design had, just moved.
 */
export interface EventItemInput {
  id?: number;
  label: string;
  quantity: number;
}

/** Parse + clamp the `items` array off a request body. Anything
 *  without a usable label is dropped; quantity floors at 1. */
export function parseEventItemsInput(raw: unknown): EventItemInput[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: EventItemInput[] = [];
  for (const row of raw) {
    const label =
      typeof (row as { label?: unknown })?.label === "string"
        ? (row as { label: string }).label.trim().slice(0, 120)
        : "";
    if (!label) continue;
    // Same-label duplicates would race each other for claims.
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const rawId = Number((row as { id?: unknown })?.id);
    const rawQty = Number((row as { quantity?: unknown })?.quantity);
    out.push({
      id: Number.isFinite(rawId) && rawId > 0 ? rawId : undefined,
      label,
      quantity: Number.isFinite(rawQty)
        ? Math.min(Math.max(Math.round(rawQty), 1), 500)
        : 1,
    });
  }
  return out;
}

/**
 * Apply `items` to one event. Best-effort by the same contract as the
 * Google push: the event row itself is already saved, so a failure
 * here is reported, never thrown, and never fails the event write.
 *
 * Returns an error string on failure, or null on success.
 */
export async function syncEventItems(
  eventId: number,
  items: EventItemInput[]
): Promise<string | null> {
  let existing: XanoSchoolEventItem[];
  try {
    existing = (await xano.eventItems.getAll()).filter(
      (i) => Number(i.school_calendar_events_id) === eventId
    );
  } catch (err) {
    console.error(`[school-event-items] load failed for ${eventId}:`, err);
    return "Event saved, but its needs list couldn't be loaded to update.";
  }

  const submittedIds = new Set(
    items.map((i) => i.id).filter((id): id is number => typeof id === "number")
  );
  try {
    for (const row of existing) {
      if (!submittedIds.has(row.id)) {
        await xano.eventItems.delete(row.id);
      }
    }
    const byId = new Map(existing.map((r) => [r.id, r]));
    for (const [index, item] of items.entries()) {
      const prior = item.id ? byId.get(item.id) : undefined;
      if (prior) {
        // Skip no-op writes so a save that only touched the event's
        // title doesn't churn every item row.
        if (
          prior.label === item.label &&
          Number(prior.quantity) === item.quantity &&
          Number(prior.sort_order) === index
        ) {
          continue;
        }
        await xano.eventItems.update(prior.id, {
          label: item.label,
          quantity: item.quantity,
          sort_order: index,
        });
      } else {
        await xano.eventItems.create({
          school_calendar_events_id: eventId,
          label: item.label,
          quantity: item.quantity,
          sort_order: index,
        });
      }
    }
  } catch (err) {
    console.error(`[school-event-items] write failed for ${eventId}:`, err);
    return "Event saved, but its needs list couldn't be updated.";
  }
  return null;
}

/** The event's items, for the calendar description builders. Never
 *  throws — a description without its needs block is better than a
 *  failed calendar push. */
export async function loadEventItems(
  eventId: number
): Promise<XanoSchoolEventItem[]> {
  try {
    return (await xano.eventItems.getAll())
      .filter((i) => Number(i.school_calendar_events_id) === eventId)
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.id - b.id);
  } catch (err) {
    console.error(`[school-event-items] load failed for ${eventId}:`, err);
    return [];
  }
}

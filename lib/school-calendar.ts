/**
 * School-calendar display helpers shared by the admin Settings →
 * Calendar surfaces and the parent-facing calendar page. Pure data +
 * date math only — no client components, safe to import anywhere.
 */

/** "YYYY-MM-DD" → local Date (avoids the UTC-midnight off-by-one that
 *  `new Date("YYYY-MM-DD")` gives in western timezones). */
export function parseDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

/**
 * Event categories and their colors — the brand etiquette palette.
 * The slug is what `school_calendar_events.color` stores; empty (or
 * the " " clear-sentinel) renders the neutral gray chip.
 */
export const EVENT_COLORS = [
  {
    value: "sky",
    label: "Testing",
    dot: "bg-sky-400",
    chip: "bg-sky-100 text-sky-900",
  },
  {
    value: "emerald",
    label: "SailFuture Serves",
    dot: "bg-emerald-400",
    chip: "bg-emerald-100 text-emerald-900",
  },
  {
    value: "violet",
    label: "Student Events",
    dot: "bg-violet-400",
    chip: "bg-violet-100 text-violet-900",
  },
  {
    value: "amber",
    label: "Parent Events",
    dot: "bg-amber-400",
    chip: "bg-amber-100 text-amber-900",
  },
] as const;

export function eventColor(color: string | null | undefined) {
  const slug = (color ?? "").trim();
  return EVENT_COLORS.find((c) => c.value === slug) ?? null;
}

/** Split an event's `needs` text (one per line, " " = cleared
 *  sentinel) into display-ready list items. */
export function parseNeeds(needs: string | null | undefined): string[] {
  return (needs ?? "")
    .trim()
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * An event item as the parent RSVP dialog needs it: what's wanted,
 * what's spoken for across every family, and what this family holds.
 *
 * Items live in their own table keyed by id (see `XanoSchoolEventItem`),
 * so this carries the id through to the client — a claim references
 * it, which is what makes renaming a need safe.
 */
export interface EventItemAvailability {
  id: number;
  label: string;
  /** How many admin asked for. */
  quantity: number;
  /** Claimed across every family, including this one. */
  claimed: number;
  /** Claimed by the viewing family. */
  mine: number;
}

/**
 * Join items to claims for one event.
 *
 * `claims` may include rows for other events — they're filtered by
 * item id, so callers can pass the whole table without pre-slicing.
 */
export function eventItemAvailability(
  items: Array<{ id: number; label: string; quantity: number; sort_order?: number }>,
  claims: Array<{
    registration_school_event_items_id: number;
    registration_families_id: number;
    quantity: number;
  }>,
  familyId: number
): EventItemAvailability[] {
  const claimedById = new Map<number, number>();
  const mineById = new Map<number, number>();
  for (const c of claims) {
    const itemId = Number(c.registration_school_event_items_id);
    const qty = Number(c.quantity) || 0;
    if (qty <= 0) continue;
    claimedById.set(itemId, (claimedById.get(itemId) ?? 0) + qty);
    if (familyId > 0 && Number(c.registration_families_id) === familyId) {
      mineById.set(itemId, (mineById.get(itemId) ?? 0) + qty);
    }
  }
  return [...items]
    .sort(
      (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.id - b.id
    )
    .map((item) => ({
      id: item.id,
      label: item.label,
      quantity: Math.max(1, Number(item.quantity) || 1),
      claimed: claimedById.get(item.id) ?? 0,
      mine: mineById.get(item.id) ?? 0,
    }));
}

/** How many more of an item one family may take: everything not
 *  already held by OTHER families. Editing your own claim down
 *  releases it rather than counting against you twice. */
export function itemHeadroom(item: EventItemAvailability): number {
  return Math.max(item.quantity - (item.claimed - item.mine), 0);
}

/**
 * `school_calendar_events.parent_spots` encodes three states in one
 * int column:
 *
 *    0  → no parent sign-up at all (the event never reaches parents)
 *   >0  → sign-up open, capped at that many spots
 *   -1  → sign-up open with no cap  (`UNLIMITED_PARENT_SPOTS`)
 *
 * The sentinel rides in the existing column rather than a new boolean
 * so Xano needs no schema change, matching how the rest of the app
 * handles this (the `" "` clear-sentinel on `needs` and `color`).
 * Read it through `isSignUpEvent` / `isUnlimitedSpots` — never
 * compare `parent_spots > 0` directly, or unlimited events silently
 * drop out of the list.
 */
export const UNLIMITED_PARENT_SPOTS = -1;

/** True when parents can sign up at all — capped or uncapped. */
export function isSignUpEvent(
  parentSpots: number | null | undefined
): boolean {
  const n = Number(parentSpots ?? 0);
  return n > 0 || n === UNLIMITED_PARENT_SPOTS;
}

/** True when sign-up is open with no attendance limit. */
export function isUnlimitedSpots(
  parentSpots: number | null | undefined
): boolean {
  return Number(parentSpots ?? 0) === UNLIMITED_PARENT_SPOTS;
}

/** Absolute base for parent-facing links that leave the app — a
 *  calendar event lands in Gmail, Apple Calendar or a phone widget,
 *  where a relative path means nothing. */
export function appBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ?? "https://apply.sailfutureacademy.org"
  );
}

/**
 * Deep link to one event's RSVP on the parent volunteer-hours page.
 * The page opens that event's sign-up dialog straight away, so a
 * parent who taps this from a calendar entry reserves their spot
 * without hunting for the event in a list.
 *
 * `yearId` is intentionally omitted — the page falls back to the
 * family's most recent application year, and a hardcoded year in a
 * link that lives in someone's calendar for months ages badly.
 */
export function parentRsvpUrl(eventId: number): string {
  return `${appBaseUrl()}/dashboard/volunteer-hours?eventId=${eventId}`;
}

/** The event fields that shape a calendar description. Structural
 *  subset of `XanoSchoolCalendarEvent` so this module stays free of
 *  the Xano import. */
export interface CalendarDescriptionEvent {
  id: number;
  description?: string | null;
  mandatory?: boolean;
  parent_volunteer_hours?: boolean;
  volunteer_hour_total?: number;
  parent_spots?: number;
}

/** What the event needs, for the "What we need" block. Passed in
 *  rather than read off the event: items live in their own table now,
 *  so the caller (push or ICS feed) does the load. */
export interface CalendarDescriptionItem {
  label: string;
  quantity: number;
}

/**
 * The description shown on an event once it leaves the app — used by
 * BOTH the Google Calendar push and the ICS feed so a parent sees the
 * same thing wherever the event reaches them.
 *
 * Plain text on purpose: Google linkifies bare URLs in its own UI,
 * and Apple Calendar / Outlook render HTML in descriptions
 * inconsistently (often as visible tags). A raw URL is the one form
 * every client handles.
 */
export function calendarEventDescription(
  event: CalendarDescriptionEvent,
  items: CalendarDescriptionItem[] = []
): string {
  const blocks: string[] = [];

  const body = (event.description ?? "").trim();
  if (body) blocks.push(body);

  const flags = [
    event.mandatory ? "Mandatory attendance." : "",
    event.parent_volunteer_hours
      ? `Counts toward parent volunteer hours (${event.volunteer_hour_total || 0} hrs).`
      : "",
  ].filter(Boolean);
  if (flags.length > 0) blocks.push(flags.join("\n"));

  if (items.length > 0) {
    blocks.push(
      [
        "What we need:",
        ...items.map((n) =>
          n.quantity > 1
            ? `• ${n.label} (${n.quantity} needed)`
            : `• ${n.label}`
        ),
      ].join("\n")
    );
  }

  // RSVP invitation, only where sign-ups are actually open. On an
  // event nobody can sign up for, a "reserve your spot" link is a
  // dead end.
  if (isSignUpEvent(event.parent_spots)) {
    const capacity = isUnlimitedSpots(event.parent_spots)
      ? "Parent sign-up is open — no attendance limit."
      : `Parent sign-up is open (${event.parent_spots} spots).`;
    blocks.push(`${capacity}\nRSVP: ${parentRsvpUrl(event.id)}`);
  }

  return blocks.join("\n\n");
}

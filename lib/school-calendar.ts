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

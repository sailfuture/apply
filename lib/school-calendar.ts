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

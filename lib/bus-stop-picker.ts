/**
 * Client-safe bus-stop helpers for the parent pickers (the students
 * step and the mid-year sibling application). Kept apart from
 * `lib/bus-stops`, which imports the server data layer.
 */

/**
 * The stop a parent-facing picker should show for a stored election:
 * the stored name when it is still one of the current stops, else ""
 * (so the parent sees "Select a bus stop" and picks a current one).
 * Applications keep the stop by NAME, so a row saved before a stop
 * was renamed or retired can still name it — and a <select> whose
 * value matches no option LOOKS empty while the form keeps (and
 * re-saves) the old name. An empty `stops` list means the catalog
 * didn't load; the stored value is left alone then.
 */
export function currentStopOrBlank(
  stored: string | null | undefined,
  stops: ReadonlyArray<{ name?: string | null }>
): string {
  const value = (stored ?? "").trim();
  if (!value || stops.length === 0) return value;
  return stops.some((s) => (s.name ?? "").trim() === value) ? value : "";
}

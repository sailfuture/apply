/**
 * Chronological sort for school-year dropdowns — oldest first, most
 * recent last, so the list reads like a timeline.
 *
 * `/api/admin/school-years` itself serves a bucketed order (upcoming →
 * active → future → past) that the settings list and dashboard rely
 * on, so dropdown surfaces re-sort client-side with this instead of
 * changing the endpoint. Prefers `start_date` (the year's real
 * position in time) and falls back to a numeric-aware `year_name`
 * compare for rows without one ("2024-2025" < "2025-2026").
 */
export function sortYearsOldestFirst<
  T extends { year_name?: string | null; start_date?: string | null },
>(years: T[]): T[] {
  return [...years].sort((a, b) => {
    const aStart = a.start_date ?? "";
    const bStart = b.start_date ?? "";
    if (aStart && bStart && aStart !== bStart) {
      return aStart.localeCompare(bStart);
    }
    return (a.year_name ?? "").localeCompare(b.year_name ?? "", undefined, {
      numeric: true,
    });
  });
}

/**
 * Which years a lead list shows. "working" is the list admissions is
 * actually working: leads tagged for the top bar's year PLUS the
 * untagged ones — a year is only ever set by hand, so an untagged
 * lead is still unsorted, not uninteresting. Families tagged for
 * another year (looking a couple of years down the line) drop out of
 * that view without being marked not interested. "any" shows every
 * lead; a number picks one year, 0 = only the untagged leads.
 */
export type LeadYearView = "working" | "any" | number;

/** Does a lead tagged `yearId` (0 = untagged) belong in `view`? The
 *  working view also admits every lead while the top bar's year
 *  hasn't landed in the URL yet, so a list never flashes empty. */
export function matchesLeadYearView(
  yearId: number,
  view: LeadYearView,
  workingYearId: number
): boolean {
  if (view === "any") return true;
  if (view === "working") {
    return yearId === 0 || workingYearId === 0 || yearId === workingYearId;
  }
  return yearId === view;
}

/** Parses a year-view picker's string value back into a view. */
export function parseLeadYearView(value: string): LeadYearView {
  return value === "working" || value === "any" ? value : Number(value) || 0;
}

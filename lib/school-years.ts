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

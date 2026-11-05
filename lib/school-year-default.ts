/**
 * Which school year an admin page shows when the URL carries no
 * `?yearId=` — the year this browser last worked in (remembered in
 * the ADMIN_YEAR_COOKIE cookie, see lib/admin-year-memory.ts), else
 * the default rule below. ONE rule shared by the YearSelector (which injects it
 * into the URL) and the server routes that need to answer before that
 * injection has happened (the Messages inbox feed). If the two ever
 * disagreed, the inbox would classify a family against one year and
 * the page would then re-fetch for another, and a deep link could
 * bounce to the wrong page.
 *
 * Pure, dependency-free: imported by client components and routes.
 */

export interface AdminYearLike {
  id: number;
  year_name?: string | null;
  /** ISO date; places an unflagged row on the timeline. */
  start_date?: string | null;
  isActive?: boolean;
  isNextYear?: boolean;
  isPast?: boolean;
  isFuture?: boolean;
}

/** Calendar year a row starts in, from `start_date` else the first
 *  four digits of `year_name` ("2027-2028" → 2027); NaN if neither. */
function startYearOf(y: AdminYearLike): number {
  return Number.parseInt((y.start_date ?? y.year_name ?? "").slice(0, 4), 10);
}

/**
 * Is `y` a year the admin tool works in: the live year, enrollment's
 * upcoming year, or history? Years further out — flagged `isFuture`,
 * or unflagged rows that start after the upcoming year — exist so a
 * lead can be tagged for them and so admin can set them up ahead of
 * time; they never appear in a working-year picker and are never the
 * default (user request, 2026-11-05: the tool kept opening on
 * 2027-2028). An unflagged row that starts BEFORE the live year is
 * history whose `isPast` flag was never set (2023-2024), so it stays.
 */
export function isAdminWorkingYear<T extends AdminYearLike>(
  y: T,
  years: readonly T[]
): boolean {
  if (y.isActive || y.isNextYear || y.isPast) return true;
  if (y.isFuture) return false;
  const horizon =
    years.find((o) => o.isNextYear) ?? years.find((o) => o.isActive);
  if (!horizon) return true;
  const start = startYearOf(y);
  const limit = startYearOf(horizon);
  return Number.isFinite(start) && Number.isFinite(limit) && start < limit;
}

/** The years a working-year picker lists, in the given order. */
export function adminWorkingYears<T extends AdminYearLike>(years: T[]): T[] {
  return years.filter((y) => isAdminWorkingYear(y, years));
}

/** Upcoming year first, then active, then future, then past. Within
 *  a group the newer `year_name` sorts first. */
export function sortAdminYears<T extends AdminYearLike>(years: T[]): T[] {
  const rank = (y: AdminYearLike) => {
    if (y.isNextYear) return 0;
    if (y.isActive) return 1;
    if (y.isFuture) return 2;
    return 3; // past or unflagged
  };
  return [...years].sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    return (b.year_name ?? "").localeCompare(a.year_name ?? "");
  });
}

/** The year the admin tool opens on: the live year, else enrollment's
 *  upcoming year, else whatever working year sorts first. Null for an
 *  empty list. The live year comes first (since 2026-11-05) because
 *  the upcoming year is flagged months before anyone works in it, and
 *  a browser without the remembered-year cookie kept landing there. */
export function defaultAdminYear<T extends AdminYearLike>(
  years: T[]
): T | null {
  const sorted = adminWorkingYears(sortAdminYears(years));
  return (
    sorted.find((y) => y.isActive) ??
    sorted.find((y) => y.isNextYear) ??
    sorted[0] ??
    null
  );
}

/** Cookie holding the year this browser last worked in. A cookie (not
 *  localStorage) so the server routes that resolve a missing
 *  `?yearId=` can honor it too. */
export const ADMIN_YEAR_COOKIE = "sfa_admin_year";

/** Parses the cookie value; null for a missing or malformed one. */
export function parseAdminYearId(value: string | null | undefined): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** The year to show when the URL names none: the remembered one while
 *  it still exists and is still a working year, else
 *  `defaultAdminYear`. A cookie left pointing at a year that has since
 *  moved out past the upcoming one falls back instead of reopening it. */
export function resolveAdminYear<T extends AdminYearLike>(
  years: T[],
  rememberedId: number | null
): T | null {
  const remembered =
    rememberedId !== null
      ? years.find(
          (y) => y.id === rememberedId && isAdminWorkingYear(y, years)
        )
      : undefined;
  return remembered ?? defaultAdminYear(years);
}

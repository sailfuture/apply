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
  isActive?: boolean;
  isNextYear?: boolean;
  isPast?: boolean;
  isFuture?: boolean;
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

/** The year the admin tool opens on: enrollment's upcoming year, else
 *  the live year, else whatever sorts first. Null for an empty list. */
export function defaultAdminYear<T extends AdminYearLike>(
  years: T[]
): T | null {
  const sorted = sortAdminYears(years);
  return (
    sorted.find((y) => y.isNextYear) ??
    sorted.find((y) => y.isActive) ??
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
 *  it still exists, else `defaultAdminYear`. */
export function resolveAdminYear<T extends AdminYearLike>(
  years: T[],
  rememberedId: number | null
): T | null {
  const remembered =
    rememberedId !== null ? years.find((y) => y.id === rememberedId) : undefined;
  return remembered ?? defaultAdminYear(years);
}

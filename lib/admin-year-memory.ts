"use client";

import { useSyncExternalStore } from "react";
import { ADMIN_YEAR_COOKIE, parseAdminYearId } from "@/lib/school-year-default";

/**
 * Remembers the school year this browser last worked in, so a link,
 * bookmark, new tab or typed URL without `?yearId=` lands on that
 * year instead of jumping to the default one (user request). Written
 * by the YearSelector whenever the URL shows a real year; read by it
 * when the URL has none, by the Messages inbox, and (via the request
 * cookie) by the inbox feed route.
 *
 * Every access is wrapped: cookies can be blocked, and the default
 * year rule is the fallback whenever nothing can be read.
 */

const CHANGE_EVENT = "sfa-admin-year-change";
const ONE_YEAR_S = 60 * 60 * 24 * 365;

export function readRememberedAdminYearId(): number | null {
  try {
    const match = document.cookie
      .split("; ")
      .find((c) => c.startsWith(`${ADMIN_YEAR_COOKIE}=`));
    return parseAdminYearId(match?.slice(ADMIN_YEAR_COOKIE.length + 1));
  } catch {
    return null;
  }
}

export function rememberAdminYear(yearId: number): void {
  try {
    if (readRememberedAdminYearId() === yearId) return;
    document.cookie = `${ADMIN_YEAR_COOKIE}=${yearId}; path=/; max-age=${ONE_YEAR_S}; samesite=lax`;
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    // Unwritable cookies just mean the default year next time.
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => window.removeEventListener(CHANGE_EVENT, onChange);
}

/** The remembered year id; null during SSR/hydration and when unset. */
export function useRememberedAdminYearId(): number | null {
  return useSyncExternalStore(subscribe, readRememberedAdminYearId, () => null);
}

/** True on a family record — its `?yearId=` is that application's
 *  year, not the year the admin is working in. */
export function isFamilyRecordPath(pathname: string): boolean {
  return pathname.startsWith("/admin/families/");
}

/**
 * The admin's working year as a string id: the URL's `?yearId=`
 * everywhere except a family record, where it's the remembered year
 * (a 2027-2028 family opened from the 2026-2027 list keeps the top
 * bar and the menu links on 2026-2027 — user request). Null when
 * neither is known; the YearSelector then fills in the default.
 */
export function useWorkingYearId(
  pathname: string,
  urlYearId: string | null
): string | null {
  const remembered = useRememberedAdminYearId();
  if (!isFamilyRecordPath(pathname)) return urlYearId;
  return remembered !== null ? String(remembered) : null;
}

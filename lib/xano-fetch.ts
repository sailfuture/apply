/**
 * The one door every Xano request in lib/xano.ts goes through.
 *
 * Two jobs:
 *
 *   1. CACHE the reads that were making every admin page re-download
 *      the database. Measured 2026-09-17: the admin list routes pull
 *      6–12 whole tables per request (students 282 KB / 0.7 s,
 *      applications 196 KB / 0.8 s, sms_messages 729 KB / 3.3 s …),
 *      every time, because every fetch was `cache: "no-store"`. GETs
 *      against the tables below now go through the Next Data Cache
 *      with a short TTL and a per-table tag; every write to a table
 *      made through this door expires that tag immediately
 *      (`revalidateTag` with `expire: 0` — read-your-own-writes), so
 *      an admin who edits a row and refetches the list sees the change. The residual
 *      staleness is edits made OUTSIDE this app (directly in the Xano
 *      UI), which show up within `XANO_CACHE_TTL_SECONDS`.
 *
 *   2. ACCOUNT for every call (table, method, duration) into the
 *      per-request store so `withServerTiming` can report it.
 *
 * This module has NO imports on purpose. lib/xano.ts reaches browser
 * bundles through a couple of shared helper modules, and Turbopack
 * refuses a client chunk that pulls in `node:async_hooks` or
 * `next/cache`. The server-only halves (the AsyncLocalStorage store
 * and `updateTag`) live in lib/xano-runtime.ts, which registers them
 * on `globalThis` at server start via instrumentation.ts; in a
 * browser or a plain tsx script the hooks are simply absent and this
 * degrades to a plain fetch.
 *
 * Tables deliberately NOT cached: the two progress tables (their
 * fetch-or-create `resolve` paths are race-guarded on fresh reads),
 * payments + transactions (billing invariants), event RSVPs / item
 * claims (capacity checks must not oversell), store orders (webhook
 * mirror), admin notes, and anything not listed. Add a table here
 * only when every write to it goes through lib/xano.ts.
 */

export const XANO_CACHE_TTL_SECONDS = 30;

/** Calls slower than this get a warning line even on un-timed routes. */
const SLOW_CALL_MS = 1500;

const CACHED_TABLES = new Set<string>([
  "registration_students",
  "registration_families",
  "registration_parents",
  "registration_application",
  "registration_student_registration",
  "registration_opportunity_scholarship",
  "registration_opportunity_scholarship_benefits",
  "registration_opportunity_scholarship_contributing_members",
  "registration_opportunity_scholarship_home",
  "registration_opportunity_scholarship_vehicles",
  "registration_emergency_contacts",
  "registration_school_years",
  "registration_email_notifications",
  "sms_messages",
  "registration_inquiry",
  "registration_tours",
  "school_calendar",
  "school_calendar_events",
  "registration_academic_terms",
  "registration_academic_seasons",
  "registration_bus",
  "registration_families_volunteer_hours",
  // Lead sources — read whole by every messaging + leads route for
  // contact-name resolution. The waiver list is only cacheable
  // because its endpoint stopped returning signature images
  // (3.1 MB → ~50 KB); the per-row read still carries them.
  "registration_summer_camp",
  "tasco_summer_visit",
  "website_liability_waiver",
]);

export interface XanoCall {
  /** Table path segment ("registration_students"), or "other" for
   *  non-table URLs (uploads, custom queries). */
  table: string;
  method: string;
  ms: number;
  status: number;
  /** Heuristic: a cacheable GET that came back in under 60 ms was
   *  served by the Next Data Cache — Xano itself never answers that
   *  fast (its measured floor is ~200 ms). */
  cached: boolean;
}

/** What lib/xano-runtime.ts installs on the server. */
export interface XanoServerHooks {
  record(call: XanoCall): void;
  expire(table: string): void;
}

declare global {
  var __xanoServerHooks: XanoServerHooks | undefined;
}

function hooks(): XanoServerHooks | undefined {
  return globalThis.__xanoServerHooks;
}

export interface XanoUrlInfo {
  /** Table path segment after the API group, or null for non-table
   *  URLs. Custom queries parse as a "table" too — harmless, they
   *  just aren't in the cached set. */
  table: string | null;
  /** True for `/table` and `/table?…`, false for `/table/<id>…`. */
  isList: boolean;
}

/** `https://host/api:GROUP/<table>[/<id>][?query]` → parts. Pure, so
 *  it can be unit-tested without a request. */
export function classifyXanoUrl(url: string): XanoUrlInfo {
  const m = url.match(/\/api:[A-Za-z0-9_-]+\/([A-Za-z0-9_]+)(\/([^/?#]+))?/);
  if (!m) return { table: null, isList: false };
  return { table: m[1], isList: !m[3] };
}

export function cacheTagFor(table: string): string {
  return `xano:${table}`;
}

export function isCachedTable(table: string | null): table is string {
  return table !== null && CACHED_TABLES.has(table);
}

/**
 * Drop-in for `fetch` inside lib/xano.ts. Same signature, same
 * Response; only the caching + accounting differ.
 */
export async function xanoFetch(
  input: string | URL | Request,
  init?: RequestInit
): Promise<Response> {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
  const method = (
    init?.method ??
    (input instanceof Request ? input.method : "GET")
  ).toUpperCase();
  const { table } = classifyXanoUrl(url);
  const cacheable = method === "GET" && isCachedTable(table);

  let finalInit = init;
  if (cacheable) {
    // `cache: "no-store"` and `next.revalidate` are mutually exclusive
    // in Next's fetch — drop the former, the callers all pass it.
    const { cache: _noStore, ...rest } = init ?? {};
    void _noStore;
    finalInit = {
      ...rest,
      next: {
        ...rest.next,
        revalidate: XANO_CACHE_TTL_SECONDS,
        tags: [cacheTagFor(table)],
      },
    };
  }

  const started = performance.now();
  let status = 0;
  try {
    const res = await fetch(input, finalInit);
    status = res.status;
    return res;
  } finally {
    const ms = performance.now() - started;
    hooks()?.record({
      table: table ?? "other",
      method,
      ms,
      status,
      cached: cacheable && ms < 60,
    });
    if (ms > SLOW_CALL_MS) {
      console.warn(
        `[xano] slow ${method} ${table ?? url} took ${ms.toFixed(0)}ms`
      );
    }
    // A write to a cached table expires it whether or not Xano
    // accepted the write — a spurious expiry costs one re-read; a
    // missed one shows a stale list for up to the TTL.
    if (method !== "GET" && isCachedTable(table)) hooks()?.expire(table);
  }
}

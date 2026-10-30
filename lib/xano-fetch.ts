/**
 * The one door every Xano request in lib/xano.ts goes through (and
 * the handful of routes and scripts that build their own Xano URLs).
 *
 * Four jobs:
 *
 *   1. CACHE the reads that were making every admin page re-download
 *      the database. Measured 2026-09-17: the admin list routes pull
 *      6–12 whole tables per request (students 282 KB / 0.7 s,
 *      applications 196 KB / 0.8 s, sms_messages 729 KB / 3.3 s …),
 *      every time, because every fetch was `cache: "no-store"`. GETs
 *      against the tables below now go through the Next Data Cache
 *      with a per-table TTL and tag; every write to a table made
 *      through this door expires that tag immediately
 *      (`revalidateTag` with `expire: 0` — read-your-own-writes), so
 *      an admin who edits a row and refetches the list sees the change.
 *      Past its TTL an entry is still served while Next refreshes it in
 *      the background (stale-while-revalidate), so the TTL mostly sets
 *      how often a busy page re-reads Xano. The residual staleness is
 *      edits made OUTSIDE this app (the website's forms, the Xano UI),
 *      which show up within that table's TTL — see `cacheTtlFor`.
 *
 *   2. TIME OUT reads instead of hanging. Xano shares one instance
 *      with the student dashboard and Passage Logs; in school hours it
 *      queues requests (2026-10-26: a 6-row table took up to 3.5 s,
 *      list reads up to 92 s, a few 502s), and with no timeout a stuck
 *      read kept a page spinning until the function died. GETs now
 *      give up after `READ_TIMEOUT_MS` and are retried once on a
 *      timeout, network error or 429 / 502 / 503 / 504, so a page
 *      either loads or shows its retry card. Writes are never retried
 *      or timed out here — a write Xano finished after we gave up
 *      would be repeated.
 *
 *   3. ACCOUNT for every call (table, method, duration) into the
 *      per-request store so `withServerTiming` can report it.
 *
 *   4. AUTHENTICATE to the "SFA Registration" API group (`2GcBXyoA`,
 *      what `XANO_API_BASE_URL` and `XANO_UPLOAD_URL` point at). As of
 *      the 2026-10-22 audit every endpoint in it was open to anyone;
 *      Xano is getting a guard that wants `Authorization: Bearer
 *      <SFA_REGISTRATION_API_KEY>`, so every request to that group
 *      carries `XANO_API_KEY` (same value; server-only, never
 *      `NEXT_PUBLIC_`). Only that group, and only on the host those env
 *      vars name: the Toddle (`fJsHVIeC`) and ops (`jzQ2liPL`) groups,
 *      vault file URLs and every other host never see the key. Until
 *      the guard is on, Xano ignores the header.
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
 * Tables deliberately NOT cached: payments + transactions (billing
 * invariants), event RSVPs / item claims (capacity checks must not
 * oversell), store orders (webhook mirror), and anything not listed.
 * The two progress tables ARE cached for their list reads, but their
 * fetch-or-create `resolve` paths read with `fresh: true`. Add a
 * table here only when every write to it goes through lib/xano.ts.
 */

/** TTL for tables something outside this app also writes. */
export const XANO_CACHE_TTL_SECONDS = 30;

/** TTL for tables only this app writes — every write expires the tag,
 *  so a long TTL costs nothing but staleness for direct Xano UI edits. */
export const XANO_LONG_CACHE_TTL_SECONDS = 300;

/** Per-attempt budget for a GET. Xano's normal answer is 0.2–2 s. */
const READ_TIMEOUT_MS = 12_000;

/** Pause before the one retry, so it doesn't land in the same queue
 *  spike. */
const READ_RETRY_DELAY_MS = 400;

/** Statuses worth one more try: Xano overloaded / restarting. */
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

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
  // Main Line calls — read whole by the inbox feed (20 s poll) since
  // calls joined the conversation list; 414 KB because of the
  // transcripts. Writes go through lib (ingest/sync), which expires
  // the tag.
  "registration_calls",
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
  // The two progress tables and their per-year query views. Every
  // write goes through lib/xano.ts (expires the tag); the reads that
  // DECIDE a write — `resolve`'s pre/post-create matches and
  // `getByFamilyAndYear` — pass `fresh: true`, so only the list reads
  // the admin pages fan out (pipeline, applications, registrations,
  // all-leads, stats, dashboard search) are served from the cache.
  "registration_family_application_progress",
  "registration_family_application_progress_by_year",
  "registration_student_registration_progress",
  "registration_student_registration_progress_by_year",
  // Admin notes — 249 KB read whole by inquiries, all-leads and
  // lead-activity for "last note" columns. The website's admin-notes
  // CRUD also writes it, hence the short TTL.
  "registration_admin_notes",
  // App settings (follow-up switch, SMS provider, closed
  // conversations…). Read by the unread badge on every poll from every
  // admin tab; every write goes through lib/xano.ts. The reads that
  // decide a write (`upsert`, the provider switch) stay strict/fresh.
  "registration_app_settings",
]);

/**
 * Cached query views that read a base table: a write to the base
 * table must expire them too, or the Registrations list would show
 * the pre-edit row for up to the TTL after an admin accepts a family.
 */
const DERIVED_VIEWS: Record<string, readonly string[]> = {
  registration_family_application_progress: [
    "registration_family_application_progress_by_year",
  ],
  registration_student_registration_progress: [
    "registration_student_registration_progress_by_year",
  ],
};

/**
 * Cached tables something OUTSIDE this app writes, which keep the
 * short TTL so those rows appear within 30 s: the website's inquiry,
 * camp, TASCO and waiver forms, and tour bookings. Every other cached
 * table is written only through this door (writes in Xano's request
 * history, 2026-10-26) and gets `XANO_LONG_CACHE_TTL_SECONDS` — since
 * 2026-10-30 that includes texts and calls: every inbound text and
 * call reaches `sms_messages` / `registration_calls` through Apply's
 * Quo webhook and sync (which expire the tag), so the inbox and badge
 * still see them at once; the only outside writer is the website's
 * welcome text, which may take up to the TTL to show. The two tables
 * are 1.2 MB and 470 KB, re-read by every badge poll past the TTL.
 */
const SHORT_TTL_TABLES = new Set<string>([
  "registration_inquiry",
  "registration_tours",
  "registration_email_notifications",
  "registration_summer_camp",
  "tasco_summer_visit",
  "website_liability_waiver",
  "registration_admin_notes",
]);

export function cacheTtlFor(table: string): number {
  return SHORT_TTL_TABLES.has(table)
    ? XANO_CACHE_TTL_SECONDS
    : XANO_LONG_CACHE_TTL_SECONDS;
}

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

const REGISTRATION_GROUP = "/api:2GcBXyoA";

function originOf(url: string | undefined): string | null {
  try {
    return url ? new URL(url.trim()).origin : null;
  } catch {
    return null;
  }
}

/** True when `url` is in the registration group on the Xano host the
 *  env names — the only requests that get `XANO_API_KEY`. */
export function isRegistrationGroupUrl(url: string): boolean {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return false;
  }
  const inGroup =
    target.pathname === REGISTRATION_GROUP ||
    target.pathname.startsWith(`${REGISTRATION_GROUP}/`);
  if (!inGroup) return false;
  return [process.env.XANO_API_BASE_URL, process.env.XANO_UPLOAD_URL]
    .map(originOf)
    .includes(target.origin);
}

export interface XanoFetchOptions {
  /** Read straight from Xano even when the table is cached. For the
   *  reads that decide a WRITE — "is this SID already logged?" — where
   *  a copy that is seconds old is simply a wrong answer: a cached
   *  list can predate rows a group blast wrote a moment ago, and the
   *  tag expiry can't help a fetch that was already in flight when
   *  the write landed. List views should never need this. */
  fresh?: boolean;
}

/**
 * `init` plus a `READ_TIMEOUT_MS` abort, merged with any signal the
 * caller passed. Where `AbortSignal.any` is missing (older browsers)
 * a caller's own signal wins and the read runs untimed.
 */
function withReadTimeout(init: RequestInit | undefined): RequestInit {
  const timeout = AbortSignal.timeout(READ_TIMEOUT_MS);
  const own = init?.signal;
  if (!own) return { ...init, signal: timeout };
  if (typeof AbortSignal.any !== "function") return init ?? {};
  return { ...init, signal: AbortSignal.any([own, timeout]) };
}

/**
 * Drop-in for `fetch` for any Xano URL. Same signature, same
 * Response; only the caching, accounting and registration key differ.
 */
export async function xanoFetch(
  input: string | URL | Request,
  init?: RequestInit,
  options?: XanoFetchOptions
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
  const cacheable =
    method === "GET" && isCachedTable(table) && !options?.fresh;

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
        revalidate: cacheTtlFor(table),
        tags: [cacheTagFor(table)],
      },
    };
  }

  // An Authorization header doesn't stop the Data Cache here: Next only
  // skips caching an authorized fetch when it has no explicit
  // revalidate, and the cached reads above always set one.
  const key = process.env.XANO_API_KEY;
  if (key && isRegistrationGroupUrl(url)) {
    const headers = new Headers(
      finalInit?.headers ?? (input instanceof Request ? input.headers : undefined)
    );
    headers.set("Authorization", `Bearer ${key}`);
    finalInit = { ...finalInit, headers };
  }

  const isRead = method === "GET" || method === "HEAD";
  const started = performance.now();
  let status = 0;
  let attempts = 0;
  try {
    if (!isRead) {
      attempts = 1;
      const res = await fetch(input, finalInit);
      status = res.status;
      return res;
    }
    for (;;) {
      attempts += 1;
      const last = attempts >= 2;
      try {
        const res = await fetch(input, withReadTimeout(finalInit));
        status = res.status;
        if (last || !RETRYABLE_STATUSES.has(res.status)) return res;
        await res.body?.cancel().catch(() => {});
      } catch (err) {
        // The caller cancelled — not ours to retry.
        if (finalInit?.signal?.aborted || last) throw err;
      }
      await new Promise((r) => setTimeout(r, READ_RETRY_DELAY_MS));
    }
  } finally {
    const ms = performance.now() - started;
    hooks()?.record({
      table: table ?? "other",
      method,
      ms,
      status,
      cached: cacheable && ms < 60,
    });
    if (ms > SLOW_CALL_MS || attempts > 1) {
      console.warn(
        `[xano] slow ${method} ${table ?? url} took ${ms.toFixed(0)}ms` +
          (attempts > 1 ? ` over ${attempts} attempts (status ${status || "none"})` : "")
      );
    }
    // A write to a cached table expires it whether or not Xano
    // accepted the write — a spurious expiry costs one re-read; a
    // missed one shows a stale list for up to the TTL.
    if (method !== "GET" && isCachedTable(table)) {
      hooks()?.expire(table);
      for (const view of DERIVED_VIEWS[table] ?? []) hooks()?.expire(view);
    }
  }
}

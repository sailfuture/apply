import { AsyncLocalStorage } from "node:async_hooks";
import { revalidateTag } from "next/cache";
import { after } from "next/server";
import { cacheTagFor, type XanoCall, type XanoServerHooks } from "@/lib/xano-fetch";

/**
 * Server half of the Xano door (see lib/xano-fetch.ts for why it is
 * split): the per-request accounting store, the cache-expiry hook,
 * and the auth-mode note.
 *
 * Loaded once per server process by instrumentation.ts, which is what
 * makes the hooks available to EVERY route — including the ones not
 * wrapped in `withServerTiming` — so a write anywhere expires the
 * right cache tag. Importing this module from client code would break
 * the browser bundle; nothing does.
 */

export type AuthMode = "claims" | "clerk";

export interface RequestTiming {
  start: number;
  calls: XanoCall[];
  auth?: AuthMode;
}

export const requestTiming = new AsyncLocalStorage<RequestTiming>();

/** No-op outside a timed request (scripts, cron, un-wrapped routes). */
export function recordXanoCall(call: XanoCall): void {
  requestTiming.getStore()?.calls.push(call);
}

/** Last writer wins: the auth helpers try the session-token claim
 *  first and only note "clerk" when they had to fall back. */
export function noteAuthMode(mode: AuthMode): void {
  const store = requestTiming.getStore();
  if (store) store.auth = mode;
}

/** Expire a table's cached reads NOW, so the next read anywhere
 *  refetches. `{ expire: 0 }` is Next 16's immediate-expiry profile
 *  for `revalidateTag`; the string profiles ("max") are
 *  stale-while-revalidate, which would hand an admin their own
 *  pre-edit list once more before refreshing, and `updateTag` is
 *  refused outside Server Actions.
 *
 *  Next also refuses `revalidateTag` while a Server Component is
 *  RENDERING, and that refusal used to be swallowed here. The `/`
 *  resolver creates a new parent's row during its render, so the
 *  "no parent yet" lookup it had just cached outlived the insert for
 *  the whole TTL: `/api/parents/me` kept answering "no parent" and
 *  /welcome opened with empty name fields. A refused expiry is now
 *  handed to `after()`, which runs it as soon as that render's
 *  response has gone out (a redirect included), so the browser's
 *  next request reads Xano again. Reads later in the SAME render
 *  still see the cached copy; one that decides a write there should
 *  pass `fresh: true`.
 *
 *  Outside a Next request scope (tsx scripts, tests) both calls
 *  throw — nothing is cached there, so that is swallowed. */
export function expireXanoTable(table: string): void {
  const expire = () => revalidateTag(cacheTagFor(table), { expire: 0 });
  try {
    expire();
    return;
  } catch {
    // Refused: a Server Component render, or no request at all.
  }
  try {
    after(() => {
      try {
        expire();
      } catch (err) {
        // Worth a line: a lost expiry serves the pre-write rows for up
        // to the table's TTL.
        console.warn(`[xano] could not expire cached ${table} after render:`, err);
      }
    });
  } catch {
    // Not inside a Next request — nothing cached.
  }
}

const serverHooks: XanoServerHooks = {
  record: recordXanoCall,
  expire: expireXanoTable,
};

globalThis.__xanoServerHooks = serverHooks;

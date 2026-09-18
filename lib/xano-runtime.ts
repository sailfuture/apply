import { AsyncLocalStorage } from "node:async_hooks";
import { revalidateTag } from "next/cache";
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
 *  refused outside Server Actions. Throws outside a Next request
 *  scope (tsx scripts, tests) — nothing is cached there, so the
 *  throw is swallowed. */
export function expireXanoTable(table: string): void {
  try {
    revalidateTag(cacheTagFor(table), { expire: 0 });
  } catch {
    // Not inside a route handler / server action — nothing cached.
  }
}

const serverHooks: XanoServerHooks = {
  record: recordXanoCall,
  expire: expireXanoTable,
};

globalThis.__xanoServerHooks = serverHooks;

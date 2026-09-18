import type { NextRequest } from "next/server";
import { requestTiming, type RequestTiming } from "@/lib/xano-runtime";

type RouteHandler<C> = (req: NextRequest, ctx: C) => Promise<Response>;

/**
 * Wrap a route handler so every response carries a `Server-Timing`
 * header and every request logs one line:
 *
 *   [timing] GET /api/admin/enrolled 412ms | xano 12 calls, 380ms
 *   summed, 11 cached, slowest registration_students 210ms | auth claims
 *
 * `xano` is the SUM of call durations (they mostly run in parallel,
 * so it can exceed the total); `cached` counts Data Cache hits;
 * `auth` says whether the caller was resolved from the session token
 * (`claims`) or needed a Clerk Backend API round trip (`clerk`) —
 * `clerk` on every request means the Clerk session-token template
 * still isn't enabled. The header is visible in the browser's
 * Network → Timing panel; the line is what to grep in Vercel logs.
 *
 * Usage — rename the handler and export the wrapped one, so the
 * function body and its `params` typing stay untouched:
 *
 *   async function handleGET(req: NextRequest) { … }
 *   export const GET = withServerTiming(handleGET);
 */
export function withServerTiming<C>(handler: RouteHandler<C>): RouteHandler<C> {
  return async (req, ctx) => {
    const store: RequestTiming = { start: performance.now(), calls: [] };
    return requestTiming.run(store, async () => {
      const res = await handler(req, ctx);
      const total = performance.now() - store.start;
      const summed = store.calls.reduce((a, c) => a + c.ms, 0);
      const cached = store.calls.filter((c) => c.cached).length;
      const slowest = store.calls.reduce<typeof store.calls[number] | null>(
        (top, c) => (top && top.ms >= c.ms ? top : c),
        null
      );
      const auth = store.auth ?? "none";
      try {
        res.headers.append(
          "Server-Timing",
          `total;dur=${total.toFixed(0)}, xano;dur=${summed.toFixed(0)};desc="${store.calls.length} calls, ${cached} cached", auth;desc="${auth}"`
        );
      } catch {
        // Immutable headers (a Response passed straight through from
        // fetch) — the log line below still lands.
      }
      console.log(
        `[timing] ${req.method} ${req.nextUrl.pathname} ${total.toFixed(0)}ms | xano ${store.calls.length} calls, ${summed.toFixed(0)}ms summed, ${cached} cached${
          slowest ? `, slowest ${slowest.table} ${slowest.ms.toFixed(0)}ms` : ""
        } | auth ${auth}`
      );
      return res;
    });
  };
}

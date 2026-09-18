/**
 * Next.js server-start hook. Loads the server half of the Xano door
 * (lib/xano-runtime.ts) so its cache-expiry + request-accounting
 * hooks are registered on `globalThis` before any route handles a
 * request — see lib/xano-fetch.ts for why they can't be imported
 * there directly.
 *
 * Gated to the Node runtime: the module uses AsyncLocalStorage, and
 * every route in this app runs on Node (none opt into edge).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./lib/xano-runtime");
  }
}

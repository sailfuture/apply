"use client";

import { SWRConfig } from "swr";

/**
 * Global SWR config. Caps the retry budget so a persistent backend
 * failure (auth provider down, API outage) eventually surfaces as an
 * error state in the consuming hook instead of spinning forever.
 *
 * Budget: initial fetch + 1 retry = 2 tries total. With SWR's
 * exponential backoff (`errorRetryInterval` default 5000ms, jitter
 * 0.5x–1.5x), the worst case is ~8.5s before `useSWR()` settles into
 * `{ error, data: undefined }` and pages can render
 * `<ServiceUnavailable />` instead of the spinner. Comfortably under
 * the 15s "users shouldn't stare at a blank screen" budget.
 */
export function SWRProvider({ children }: { children: React.ReactNode }) {
  return <SWRConfig value={{ errorRetryCount: 1 }}>{children}</SWRConfig>;
}

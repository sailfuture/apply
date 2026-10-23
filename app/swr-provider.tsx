"use client";

import { SWRConfig } from "swr";

/**
 * Global SWR config. Caps the retry budget so a persistent backend
 * failure (auth provider down, API outage) eventually surfaces as an
 * error state in the consuming hook instead of spinning forever.
 *
 * Budget: initial fetch + 1 retry = 2 tries total. SWR schedules the
 * retry at `errorRetryInterval × (1 or 2)` — its backoff truncates a
 * 0.5–1.5× jitter on `1 << retryCount` — so at 3000ms the retry lands
 * 3–6s after the failure (the 5000ms default put it at 5–10s). Pages
 * then settle into `{ error, data: undefined }` and render
 * `<ServiceUnavailable />` instead of the spinner, well inside the
 * ~12s window after which `LoadingScreen` offers a reload.
 */
export function SWRProvider({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig value={{ errorRetryCount: 1, errorRetryInterval: 3000 }}>
      {children}
    </SWRConfig>
  );
}

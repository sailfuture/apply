/**
 * Throwing fetcher for SWR on admin pages.
 *
 * The default `fetch().then(r => r.json())` pattern silently passes API
 * error bodies (`{ error: "Forbidden" }`) through as `data`, which then
 * blows up at downstream call sites that assume an array shape — most
 * commonly with `.sort is not a function`. By rejecting on non-OK we
 * push the failure into SWR's `error` channel where pages can render an
 * actual error state.
 */
export const adminFetcher = async <T = unknown>(url: string): Promise<T> => {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(
      (body as { error?: string } | null)?.error ??
        `Request failed (${res.status})`
    );
  }
  return res.json();
};

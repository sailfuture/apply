/**
 * Client-side read-watermark helpers for the parent notifications
 * log. The authoritative watermark is `notifications_read_at` on the
 * family row (survives devices); localStorage mirrors it so the
 * badge clears instantly on this device even if the server stamp
 * lags or the Xano column/input isn't wired yet. Consumers use
 * max(server, local).
 */

const STORAGE_KEY = "parent-notifications-read-at";

export function getLocalReadAt(): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

export function setLocalReadAt(ms: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, String(ms));
  } catch {
    /* ignore */
  }
}

/** Entries newer than the effective watermark. */
export function countUnread(
  entries: { at: number }[] | undefined,
  serverReadAt: number
): number {
  if (!entries) return 0;
  const watermark = Math.max(serverReadAt || 0, getLocalReadAt());
  return entries.filter((e) => e.at > watermark).length;
}

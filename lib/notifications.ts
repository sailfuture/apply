/**
 * Unread math for the parent Notifications log.
 *
 * The read watermark is server-side and arrives with the feed (see
 * `/api/notifications`), so this is pure: no storage, no clock, same
 * answer on every device the parent signs in from.
 */

/** Entries newer than the family's read watermark. */
export function countUnread(
  entries: { at: number }[] | undefined,
  readAt: number
): number {
  if (!entries) return 0;
  return entries.filter((e) => e.at > (readAt || 0)).length;
}

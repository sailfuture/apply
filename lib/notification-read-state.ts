import "server-only";
import { clerkClient, currentUser } from "@clerk/nextjs/server";

/**
 * Read watermark for the parent Notifications log, stored on the
 * parent's CLERK USER.
 *
 * There are two watermarks and the effective one is the later of them:
 *
 *   - `registration_families.notifications_read_at` — family-wide, so
 *     one parent clearing the log clears it for the co-parent too.
 *     Best-effort: Xano silently drops inputs that aren't wired on the
 *     edit endpoint, so this can be a no-op.
 *   - this one — per parent account, always writable, and it follows
 *     them to whatever phone or laptop they sign in from.
 *
 * The second exists because the badge used to fall back to
 * `localStorage`, which meant a parent who read their messages on a
 * laptop still saw the red dot on their phone — and clearing browser
 * data brought every old notification back.
 */

const KEY = "notifications_read_at";

function parse(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** The signed-in parent's own watermark (0 when never stamped).
 *  `currentUser()` is memoized per request. Never throws — a Clerk
 *  hiccup degrades to "nothing read", which over-counts the badge
 *  rather than hiding a message. */
export async function getUserNotificationsReadAt(): Promise<number> {
  try {
    const user = await currentUser();
    if (!user) return 0;
    return parse((user.privateMetadata as Record<string, unknown>)?.[KEY]);
  } catch (err) {
    console.error("[notification-read-state] failed to load:", err);
    return 0;
  }
}

/** Stamp the parent's watermark. Best-effort: a failed write just
 *  means the badge clears on the next successful visit. */
export async function setUserNotificationsReadAt(
  userId: string,
  at: number
): Promise<boolean> {
  try {
    const clerk = await clerkClient();
    await clerk.users.updateUserMetadata(userId, {
      privateMetadata: { [KEY]: at },
    });
    return true;
  } catch (err) {
    console.error("[notification-read-state] failed to persist:", err);
    return false;
  }
}

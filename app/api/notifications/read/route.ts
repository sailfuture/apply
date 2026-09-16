import { getFamilyAuth } from "@/lib/family-auth";
import { NextResponse } from "next/server";
import { xano } from "@/lib/xano";
import { setUserNotificationsReadAt } from "@/lib/notification-read-state";

/**
 * Stamp the notifications read-watermark (opened the Notifications
 * page → everything currently in the log counts as read).
 *
 * Writes BOTH watermarks:
 *   - the parent's own, on their Clerk user — always writable, and it
 *     follows them across devices, so this is the one the badge can
 *     actually rely on
 *   - the family row, so a co-parent's badge clears too. Best-effort:
 *     Xano silently drops inputs that aren't wired on the edit
 *     endpoint, and `persisted` reports whether it landed.
 */
export async function POST() {
  const session = await getFamilyAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { userId, familyId } = session;
  const now = Date.now();

  // Per-parent stamp first: it's the one that always works, so the
  // badge clears even for an account with no family row yet.
  const userStamped = await setUserNotificationsReadAt(userId, now);

  if (!familyId) {
    return NextResponse.json({
      ok: true,
      persisted: userStamped,
      read_at: now,
    });
  }

  let persisted = false;
  try {
    const updated = await xano.families.update(familyId, {
      notifications_read_at: now,
    });
    // Xano drops inputs that aren't wired on the edit endpoint — the
    // echo tells us whether the stamp actually landed.
    persisted =
      Number((updated as { notifications_read_at?: number | null })
        ?.notifications_read_at) === now;
  } catch (err) {
    console.error("[/api/notifications/read] stamp failed:", err);
  }

  return NextResponse.json({
    ok: true,
    // True when the watermark landed somewhere durable — either
    // watermark is enough for the badge to stay cleared.
    persisted: persisted || userStamped,
    read_at: now,
  });
}

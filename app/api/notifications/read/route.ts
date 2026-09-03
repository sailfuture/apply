import { getFamilyAuth } from "@/lib/family-auth";
import { NextResponse } from "next/server";
import { xano } from "@/lib/xano";

/**
 * Stamp the family's notifications read-watermark (opened the
 * Notifications page → everything currently in the log counts as
 * read). Best-effort: if the `notifications_read_at` column or its
 * edit-endpoint input isn't wired in Xano yet, the write silently
 * no-ops — `persisted` tells the client whether the server watermark
 * actually moved so it can lean on its localStorage mirror.
 */
export async function POST() {
  const session = await getFamilyAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { familyId } = session;
  if (!familyId) {
    return NextResponse.json({ ok: true, persisted: false, read_at: 0 });
  }

  const now = Date.now();
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

  return NextResponse.json({ ok: true, persisted, read_at: now });
}

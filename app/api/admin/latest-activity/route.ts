import { NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";

/** Latest note-or-text preview per family, keyed by family id (as a
 *  string — JSON object keys). */
export type LatestActivityMap = Record<
  string,
  { kind: "note" | "text"; body: string; at: number }
>;

/**
 * The newest admin note or SMS per family — one bulk fetch that the
 * Applications and Registrations lists join client-side for their
 * "Latest Activity" column (which replaced the primary-contact email
 * column). Notes and texts are the two composer modes, so this is
 * the same universe the activity stream leads with.
 */
export async function GET() {
  try {
    await requireAdmin();
    const [notes, sms] = await Promise.all([
      xano.adminNotes.getAll().catch(() => []),
      xano.smsMessages.getAll().catch(() => []),
    ]);

    const byFamily: LatestActivityMap = {};
    const consider = (
      familyId: number,
      cand: { kind: "note" | "text"; body: string; at: number }
    ) => {
      if (!familyId || !cand.body.trim()) return;
      const cur = byFamily[String(familyId)];
      if (!cur || cand.at > cur.at) byFamily[String(familyId)] = cand;
    };

    for (const n of notes) {
      consider(Number(n.registration_families_id), {
        kind: "note",
        body: (n.body ?? "").trim(),
        at: Number(n.created_at) || 0,
      });
    }
    for (const s of sms) {
      consider(Number(s.registration_families_id ?? 0), {
        kind: "text",
        body: (s.body ?? "").trim(),
        at: Number(s.created_at) || 0,
      });
    }

    return NextResponse.json({ byFamily });
  } catch (err) {
    return handleAdminError(err);
  }
}

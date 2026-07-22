import { NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";

/** Latest note-or-text preview per family, keyed by family id (as a
 *  string — JSON object keys). */
export type LatestActivityMap = Record<
  string,
  { kind: "note" | "text"; body: string; at: number }
>;

/** Family id (string key) → unix-ms of the newest sent
 *  records-request email — derived from the email audit log. */
export type RecordsRequestMap = Record<string, number>;

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
    const [notes, sms, emails] = await Promise.all([
      xano.adminNotes.getAll().catch(() => []),
      xano.smsMessages.getAll().catch(() => []),
      xano.emailNotifications.getAll().catch(() => []),
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

    // Records-request tracking is DERIVED from the email audit log
    // (no dedicated columns exist): any successfully sent
    // "records-request" email marks the family, newest send wins.
    const recordsByFamily: Record<string, number> = {};
    for (const e of emails) {
      if (e.template !== "records-request") continue;
      if (e.status !== "sent") continue;
      const fid = Number(e.registration_families_id);
      if (!fid) continue;
      const at = Number(e.created_at) || 0;
      if (at > (recordsByFamily[String(fid)] ?? 0)) {
        recordsByFamily[String(fid)] = at;
      }
    }

    return NextResponse.json({ byFamily, recordsByFamily });
  } catch (err) {
    return handleAdminError(err);
  }
}

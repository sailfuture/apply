import { xano, type LeadNoteSource } from "@/lib/xano";

/**
 * Shared write helpers for the four recruitment lead sources
 * (`registration_inquiry`, `registration_summer_camp`,
 * `website_liability_waiver`, `tasco_summer_visit`).
 *
 * The four tables are separate but carry the same three admin-owned
 * columns — `interest_level` (1–5 conversion stars, 0 = unrated),
 * `isFollowedUp` (we've reached out), and `last_reach_out` (server-
 * managed timestamp of the most recent note). Routing the writes
 * through one place keeps All Leads and the per-source pages from
 * drifting on which table gets patched or what shape it accepts.
 */

/** Admin-writable fields shared by every lead table. `last_reach_out`
 *  is deliberately absent — only `bumpLeadReachOut` sets it. */
export interface LeadAdminPatch {
  interest_level?: number;
  isFollowedUp?: boolean;
}

/** Patch a lead on its own source table. */
export async function updateLead(
  source: LeadNoteSource,
  id: number,
  patch: LeadAdminPatch & { last_reach_out?: number }
): Promise<unknown> {
  if (source === "inquiry") return xano.inquiries.update(id, patch);
  if (source === "camp") return xano.summerCamp.update(id, patch);
  if (source === "visit") return xano.websiteWaivers.update(id, patch);
  return xano.tascoSummerVisits.update(id, patch);
}

/**
 * Stamp "we contacted them just now" on a lead — called after a note
 * is written so the recruitment lists can show "last contacted 3d ago"
 * without scanning the notes timeline per row.
 *
 * Best-effort by contract: a failed bump must never fail the note
 * write that triggered it (the admin still gets their note saved), so
 * this logs and swallows. Returns whether the bump landed.
 */
export async function bumpLeadReachOut(
  source: LeadNoteSource,
  id: number
): Promise<boolean> {
  try {
    await updateLead(source, id, { last_reach_out: Date.now() });
    return true;
  } catch (err) {
    console.error(
      `[bumpLeadReachOut] failed for ${source} #${id}:`,
      err
    );
    return false;
  }
}

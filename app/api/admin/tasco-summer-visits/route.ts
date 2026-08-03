import { NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";

/**
 * TASCO summer-visit sign-ups for the admin TASCO Summer Visits page.
 *
 * A recruitment lead list captured on paper/tablet at St. Pete
 * recreation centers over the summer — no family/student links, no
 * school year. Rows come back newest-first.
 *
 * The one piece of real logic here is normalizing `recreation_center`:
 * it's free text and the same center shows up under several spellings
 * ("J.W. Cate Recreation Center", "jwcate recreation cenetre", "JW
 * Cate"). Left raw, the filter dropdown would list the same place three
 * times and split its counts. Each row therefore carries BOTH the
 * normalized `recreation_center` (what the table and filter use) and
 * the untouched `recreation_center_raw` (exported, so nothing the
 * signer actually typed is lost).
 */
export const dynamic = "force-dynamic";

// A `type` (not `interface`) so it satisfies DataTable's
// `Record<string, unknown>` constraint — type aliases get an implicit
// index signature, interfaces don't.
export type TascoSummerVisitRow = {
  id: number;
  submitted_ts: number;
  student_name: string;
  current_grade: string;
  current_school: string;
  /** Canonical center name — use this for display / filtering. */
  recreation_center: string;
  /** Exactly what was submitted, before normalization. */
  recreation_center_raw: string;
  parent_phone: string;
  parent_email: string;
  marketing_opt_in: boolean;
  /** Admin's 1–5 conversion stars; 0 = unrated. */
  rating: number;
  /** Admin's "we've reached out" flag. */
  followed_up: boolean;
  /** Server-stamped time of the most recent note; 0 when never
   *  contacted. */
  last_reach_out: number;
};

/**
 * Canonical center names keyed by a match token. The token is tested
 * against the submitted value squashed to lowercase alphanumerics, so
 * punctuation, casing, spacing and trailing-word typos ("cenetre") all
 * collapse to the same key. Anything unrecognized falls through to the
 * trimmed raw value rather than being forced into a bucket — a new
 * center should show up as itself, not silently merge.
 */
const CENTER_ALIASES: Array<[token: string, label: string]> = [
  ["jwcate", "J.W. Cate Recreation Center"],
  ["azalea", "Azalea Recreation Center"],
  ["roberts", "Roberts Recreation Center"],
  ["walterfuller", "Walter Fuller Recreation Center"],
  ["gladdenpark", "Gladden Park Recreation Center"],
  ["fossilpark", "Fossil Park Recreation Center"],
  ["willis", "Willis S. Johns Recreation Center"],
  ["shoreacres", "Shore Acres Recreation Center"],
  ["tasco", "TASCO"],
];

function normalizeCenter(raw: string): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "";
  const squashed = trimmed.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const [token, label] of CENTER_ALIASES) {
    if (squashed.includes(token)) return label;
  }
  return trimmed;
}

export async function GET() {
  try {
    await requireAdmin();
    const visits = await xano.tascoSummerVisits.getAll();

    const rows: TascoSummerVisitRow[] = visits
      .map((v) => ({
        id: v.id,
        submitted_ts: v.created_at,
        student_name: v.student_name ?? "",
        current_grade: v.current_grade ?? "",
        current_school: v.current_school ?? "",
        recreation_center: normalizeCenter(v.recreation_center ?? ""),
        recreation_center_raw: (v.recreation_center ?? "").trim(),
        parent_phone: v.parent_phone ?? "",
        parent_email: v.parent_email ?? "",
        marketing_opt_in: v.marketing_opt_in === true,
        rating: Number(v.interest_level) || 0,
        followed_up: v.isFollowedUp === true,
        last_reach_out: Number(v.last_reach_out) || 0,
      }))
      .sort((a, b) => b.submitted_ts - a.submitted_ts);

    return NextResponse.json(rows);
  } catch (err) {
    return handleAdminError(err);
  }
}

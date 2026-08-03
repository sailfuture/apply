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

/**
 * Source-agnostic contact fields the All Leads triage sheet edits.
 * Each maps onto whatever the lead's own table calls that fact —
 * see `buildLeadContactPatch` for the per-source column names.
 */
export interface LeadContactFields {
  student_name?: string;
  parent_name?: string;
  phone?: string;
  email?: string;
  grade?: string;
  school?: string;
  /** Messaging/marketing consent. Column varies by source:
   *  inquiry `messaging_opt_in`, visit/tasco `marketing_opt_in`;
   *  camp has NO column (sign-up is the implied consent). */
  opt_in?: boolean;
}

/** Split a full name at the LAST space — "Mary Jane Smith" →
 *  first "Mary Jane", last "Smith". Single word = all first name. */
function splitName(full: string): { first: string; last: string } {
  const t = full.trim().replace(/\s+/g, " ");
  const i = t.lastIndexOf(" ");
  return i === -1
    ? { first: t, last: "" }
    : { first: t.slice(0, i), last: t.slice(i + 1) };
}

function digitsOnly(raw: string): string {
  const d = raw.replace(/\D/g, "");
  return d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
}

/**
 * Translate the generic contact fields into the source table's own
 * column names. Returns the column patch plus:
 *   - `unsupported` — fields this source has no column for (camp
 *     `opt_in`, tasco `parent_name`); the route 400s on these so the
 *     admin never thinks an impossible edit saved.
 *   - `skippedEmpty` — blank string values, which are EXCLUDED from
 *     the patch: Xano's edit endpoints silently drop empty inputs, so
 *     a "clear this field" write can never land (see the
 *     xano-patch-ignores-empty-inputs project note).
 */
export function buildLeadContactPatch(
  source: LeadNoteSource,
  fields: LeadContactFields
): {
  patch: Record<string, unknown>;
  unsupported: string[];
  skippedEmpty: string[];
} {
  const patch: Record<string, unknown> = {};
  const unsupported: string[] = [];
  const skippedEmpty: string[] = [];

  // Column names per source for each generic field. `null` = the
  // source has no such column. Name-pair sources (inquiry, camp)
  // split student/parent names into first/last below.
  const COLUMNS: Record<
    LeadNoteSource,
    {
      studentPair: [string, string] | null;
      studentSingle: string | null;
      parentPair: [string, string] | null;
      parentSingle: string | null;
      phone: string;
      email: string;
      grade: string;
      school: string;
      optIn: string | null;
    }
  > = {
    inquiry: {
      studentPair: ["student_first_name", "student_last_name"],
      studentSingle: null,
      parentPair: ["primary_first_name", "primary_last_name"],
      parentSingle: null,
      phone: "primary_phone",
      email: "primary_email",
      grade: "starting_grade",
      school: "previous_school",
      optIn: "messaging_opt_in",
    },
    camp: {
      studentPair: ["student_first_name", "student_last_name"],
      studentSingle: null,
      parentPair: ["primary_parent_first_name", "primary_parent_last_name"],
      parentSingle: null,
      phone: "primary_phone",
      email: "primary_email",
      grade: "last_grade_completed",
      school: "current_school",
      optIn: null,
    },
    visit: {
      studentPair: null,
      studentSingle: "student_name",
      parentPair: null,
      parentSingle: "parent_name",
      phone: "parent_phone",
      email: "parent_email",
      grade: "student_grade",
      school: "student_school",
      optIn: "marketing_opt_in",
    },
    tasco: {
      studentPair: null,
      studentSingle: "student_name",
      parentPair: null,
      parentSingle: null,
      phone: "parent_phone",
      email: "parent_email",
      grade: "current_grade",
      school: "current_school",
      optIn: "marketing_opt_in",
    },
  };
  const cols = COLUMNS[source];

  const setString = (field: string, column: string, raw: string) => {
    const v = raw.trim();
    if (!v) {
      skippedEmpty.push(field);
      return;
    }
    patch[column] = v;
  };

  if (fields.student_name !== undefined) {
    if (cols.studentPair) {
      const v = fields.student_name.trim();
      if (!v) skippedEmpty.push("student_name");
      else {
        const n = splitName(v);
        patch[cols.studentPair[0]] = n.first;
        patch[cols.studentPair[1]] = n.last;
      }
    } else if (cols.studentSingle) {
      setString("student_name", cols.studentSingle, fields.student_name);
    }
  }
  if (fields.parent_name !== undefined) {
    if (cols.parentPair) {
      const v = fields.parent_name.trim();
      if (!v) skippedEmpty.push("parent_name");
      else {
        const n = splitName(v);
        patch[cols.parentPair[0]] = n.first;
        patch[cols.parentPair[1]] = n.last;
      }
    } else if (cols.parentSingle) {
      setString("parent_name", cols.parentSingle, fields.parent_name);
    } else {
      unsupported.push("parent_name");
    }
  }
  if (fields.phone !== undefined) {
    const d = digitsOnly(fields.phone);
    if (!d) skippedEmpty.push("phone");
    else patch[cols.phone] = d;
  }
  if (fields.email !== undefined) setString("email", cols.email, fields.email);
  if (fields.grade !== undefined) setString("grade", cols.grade, fields.grade);
  if (fields.school !== undefined)
    setString("school", cols.school, fields.school);
  if (fields.opt_in !== undefined) {
    if (cols.optIn) patch[cols.optIn] = fields.opt_in === true;
    else unsupported.push("opt_in");
  }

  return { patch, unsupported, skippedEmpty };
}

/** Patch a lead on its own source table. */
export async function updateLead(
  source: LeadNoteSource,
  id: number,
  patch: (LeadAdminPatch & { last_reach_out?: number }) &
    Record<string, unknown>
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

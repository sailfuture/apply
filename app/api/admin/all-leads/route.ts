import { NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import {
  xano,
  LEAD_NOTE_COLUMN,
  LEAD_NOTE_SOURCES,
  tourLeadScope,
  type XanoAdminNote,
  type XanoTour,
} from "@/lib/xano";
import { leadConvertedFamilyId } from "@/lib/lead-conversion";

/**
 * All Leads — every pre-application lead across the four recruitment
 * sources, flattened into one ratable list:
 *
 *   - `inquiry` — website inquiries (`registration_inquiry`)
 *   - `camp`    — summer-camp registrations (`registration_summer_camp`)
 *   - `visit`   — liability-waiver visits (`website_liability_waiver`)
 *   - `tasco`   — TASCO summer-visit sign-ups (`tasco_summer_visit`)
 *
 * Each row carries the admin's 1–5 conversion stars (`interest_level`
 * on its own source table — inquiries always had the column; the other
 * three need it added in Xano, and until then read as unrated). Rows
 * come back newest-first; the page filters by source/rating client-side
 * so toggles are instant.
 *
 * `detail` is the one source-specific fact worth a column: the rec
 * center for TASCO rows, camp attendance for camp rows, the inquiry
 * lifecycle status ("converted" / "not interested") for inquiries.
 */
export const dynamic = "force-dynamic";

export type LeadSource = "inquiry" | "camp" | "visit" | "tasco";

// A `type` (not `interface`) so it satisfies DataTable's
// `Record<string, unknown>` constraint.
export type AllLeadRow = {
  /** Stable key: `${source}-${id}`. */
  key: string;
  source: LeadSource;
  id: number;
  submitted_ts: number;
  student_name: string;
  grade: string;
  school: string;
  parent_name: string;
  phone: string;
  email: string;
  /** Admin's 1–5 conversion stars; 0 = unrated. */
  rating: number;
  /** Admin's "we've reached out" flag. */
  followed_up: boolean;
  /** Server-stamped time of the most recent note on this lead; 0 when
   *  never contacted. Falls back to the newest note's timestamp when
   *  the column is empty (legacy rows written before the bump). */
  last_reach_out: number;
  /** Source-specific annotation (rec center / attended camp /
   *  inquiry status). Empty when there's nothing notable. */
  detail: string;
  /** Messaging/marketing consent. inquiry `messaging_opt_in` (missing
   *  = opted in, matching the SMS layer), visit + tasco
   *  `marketing_opt_in`; camp rows have no column — sign-up is the
   *  implied consent, so they read `true` and aren't editable. */
  opt_in: boolean;
  /** Unformatted grade value for the edit sheet — `grade` may carry
   *  display suffixes (camp's "(completed)"). */
  grade_raw: string;
  /** The lead's campus-tour state, from `registration_tours`:
   *  "completed" | "scheduled" | "no_show" | "canceled" | "" (none).
   *  When a lead has several tours, the most meaningful one wins —
   *  completed beats an upcoming booking beats a no-show beats a
   *  cancellation. */
  tour_status: string;
  /** `scheduled_at` of the tour behind `tour_status`; 0 when none. */
  tour_at: number;
  /** Lifecycle bucket from the lead's own table: "" active pipeline,
   *  "not_interested" family declined (see `status_reason`),
   *  "converted" legacy hand-marked win. Only inquiry is guaranteed
   *  to have the columns; other sources read "" until they're added
   *  in Xano. */
  lead_status: string;
  /** Why the family declined — only meaningful when `lead_status`
   *  is "not_interested" (restore leaves the old value in place). */
  status_reason: string;
  /** Academic year this family is interested in — hand-assigned
   *  (never inferred from the submission date). 0 = unassigned, and
   *  `school_year_name` is "" then, so the UI shows a blank rather
   *  than a guess. */
  school_year_id: number;
  school_year_name: string;
  /** Conversion link — the `registration_families` row this lead
   *  became, stamped by the on-submit auto-matcher / re-match sweep /
   *  manual link in the triage sheet. 0 = not converted. */
  converted_family_id: number;
  converted_family_name: string;
  /** When the link was stamped; 0 when unlinked. */
  converted_at: number;
  /** Funnel stage DERIVED live from the linked family's application
   *  data (never stored — same philosophy as `deriveApplicationStatus`):
   *  "" not converted · "linked" family exists but no application row
   *  yet · "started" application in draft · "applied" submitted ·
   *  "accepted" admin approved · "enrolled" a student's registration
   *  packet is confirmed. Highest stage across every school year wins. */
  funnel_stage: LeadFunnelStage;
};

export type LeadFunnelStage =
  | ""
  | "linked"
  | "started"
  | "applied"
  | "accepted"
  | "enrolled";

export async function GET() {
  try {
    await requireAdmin();
    const [
      inquiries,
      campRows,
      waivers,
      tascoRows,
      leadNotes,
      tours,
      families,
      progressRows,
      packets,
      students,
      schoolYears,
    ] = await Promise.all([
      xano.inquiries.getAll().catch(() => []),
      xano.summerCamp.getAll().catch(() => []),
      xano.websiteWaivers.getAll().catch(() => []),
      xano.tascoSummerVisits.getAll().catch(() => []),
      xano.adminNotes.getAllLeadNotes().catch(() => [] as XanoAdminNote[]),
      xano.tours.getAll().catch(() => [] as XanoTour[]),
      // The funnel joins — family names for the Converted badge plus
      // the application/packet facts the stage derives from. Students
      // ride along because packets carry no family FK (they're per
      // student+year); the student row bridges packet → family. All
      // fail-soft: a blip degrades converted rows to a bare "Linked"
      // badge rather than dropping the leads list.
      xano.families.getAll().catch(() => []),
      xano.familyApplicationProgress.getAll(),
      xano.studentRegistration.getAll().catch(() => []),
      xano.students.getAll().catch(() => []),
      // Year names for the hand-assigned academic-year column.
      xano.schoolYears.getAll().catch(() => []),
    ]);

    // Best tour per lead. Rank: a COMPLETED tour is the fact this
    // page filters on ("who has toured"), then an upcoming booking,
    // then the negative outcomes. Ties go to the most recent tour.
    const TOUR_RANK: Record<string, number> = {
      completed: 4,
      scheduled: 3,
      no_show: 2,
      canceled: 1,
    };
    const tourByLead = new Map<string, { status: string; at: number }>();
    for (const t of tours) {
      if (!(Number(t.scheduled_at) > 0)) continue; // blank wiring rows
      const lead = tourLeadScope(t);
      if (!lead) continue;
      const key = `${lead.source}-${lead.id}`;
      const rank = TOUR_RANK[t.status] ?? 0;
      if (rank === 0) continue;
      const cur = tourByLead.get(key);
      const curRank = cur ? (TOUR_RANK[cur.status] ?? 0) : -1;
      if (rank > curRank || (rank === curRank && t.scheduled_at > cur!.at)) {
        tourByLead.set(key, { status: t.status, at: t.scheduled_at });
      }
    }
    const tourFor = (key: string) =>
      tourByLead.get(key) ?? { status: "", at: 0 };

    // Newest note per lead — the fallback for rows whose
    // `last_reach_out` column is empty (notes written before the
    // server-side bump existed). One pass over the notes table beats
    // one round-trip per row.
    const newestNoteAt = new Map<string, number>();
    for (const n of leadNotes) {
      for (const source of LEAD_NOTE_SOURCES) {
        const id = n[LEAD_NOTE_COLUMN[source]];
        if (id == null || id === 0) continue;
        const key = `${source}-${id}`;
        if ((newestNoteAt.get(key) ?? 0) < n.created_at) {
          newestNoteAt.set(key, n.created_at);
        }
      }
    }
    const reachOut = (key: string, stored: number | null | undefined): number =>
      Number(stored) || newestNoteAt.get(key) || 0;

    // Funnel stage per family, highest across every school year.
    // Derived fresh on each read (nothing stored) so a withdrawn or
    // re-opened application is reflected immediately. Archived
    // progress rows still count — the family DID apply; the funnel
    // measures conversion, not current standing.
    const STAGE_RANK: Record<LeadFunnelStage, number> = {
      "": 0,
      linked: 1,
      started: 2,
      applied: 3,
      accepted: 4,
      enrolled: 5,
    };
    const stageByFamily = new Map<number, LeadFunnelStage>();
    const raiseStage = (familyId: number, stage: LeadFunnelStage) => {
      if (!familyId) return;
      const cur = stageByFamily.get(familyId) ?? "";
      if (STAGE_RANK[stage] > STAGE_RANK[cur]) {
        stageByFamily.set(familyId, stage);
      }
    };
    for (const p of progressRows) {
      const fid = Number(p.registration_families_id) || 0;
      raiseStage(
        fid,
        p.isAccepted ? "accepted" : p.isSubmitted ? "applied" : "started"
      );
    }
    // Packets have no family FK — bridge through the student row.
    const familyByStudent = new Map(
      students.map((s) => [s.id, Number(s.registration_families_id) || 0])
    );
    for (const pkt of packets) {
      if (pkt.registrationConfirmed === true) {
        raiseStage(
          familyByStudent.get(Number(pkt.registration_students_id)) ?? 0,
          "enrolled"
        );
      }
    }
    const familyNameById = new Map(
      families.map((f) => [f.id, (f.family_name ?? "").trim()])
    );

    const yearNameById = new Map(
      schoolYears.map((y) => [y.id, (y.year_name ?? "").trim()])
    );
    // The lead's hand-assigned year FK, coerced whether Xano hands
    // back a raw id or an expanded relation object. 0 = unassigned.
    const yearIdOf = (row: { registration_school_years_id?: unknown }) => {
      const v = row.registration_school_years_id;
      if (typeof v === "number" && Number.isFinite(v)) return v;
      if (typeof v === "string") return Number(v) || 0;
      if (v && typeof v === "object") {
        const id = (v as { id?: unknown }).id;
        return typeof id === "number" ? id : Number(id) || 0;
      }
      return 0;
    };

    // Normalized lifecycle bucket — "active" and "" both mean the
    // working pipeline, so collapse them; anything else passes
    // through ("not_interested", legacy "converted").
    const leadStatus = (raw: string | null | undefined): string => {
      const s = (raw ?? "").trim();
      return s === "active" ? "" : s;
    };

    // The per-source mappers build rows without the tour or derived
    // funnel fields — those are stamped on afterward from the shared
    // maps, so four mappers don't each repeat the lookups. They DO
    // carry the raw conversion link, which is a per-source column.
    type BareRow = Omit<
      AllLeadRow,
      "tour_status" | "tour_at" | "converted_family_name" | "funnel_stage"
    >;
    const bare: BareRow[] = [
      ...inquiries.map((i): BareRow => {
        const status = (i.status ?? "").trim();
        return {
          key: `inquiry-${i.id}`,
          source: "inquiry",
          id: i.id,
          submitted_ts: i.created_at,
          student_name:
            `${i.student_first_name ?? ""} ${i.student_last_name ?? ""}`.trim(),
          grade: (i.starting_grade || i.current_grade || "").trim(),
          school: (i.previous_school ?? "").trim(),
          parent_name:
            `${i.primary_first_name ?? ""} ${i.primary_last_name ?? ""}`.trim(),
          phone: String(i.primary_phone ?? ""),
          email: (i.primary_email ?? "").trim(),
          rating: Number(i.interest_level) || 0,
          followed_up: i.isFollowedUp === true,
          last_reach_out: reachOut(`inquiry-${i.id}`, i.last_reach_out),
          detail:
            status === "converted"
              ? "Converted"
              : status === "not_interested"
                ? "Not interested"
                : "",
          opt_in: i.messaging_opt_in !== false,
          grade_raw: (i.starting_grade || i.current_grade || "").trim(),
          lead_status: status === "active" ? "" : status,
          status_reason: (i.status_reason ?? "").trim(),
          school_year_id: yearIdOf(i),
          school_year_name: yearNameById.get(yearIdOf(i)) ?? "",
          converted_family_id: leadConvertedFamilyId(i),
          converted_at: Number(i.converted_at) || 0,
        };
      }),
      ...campRows.map(
        (c): BareRow => ({
          key: `camp-${c.id}`,
          source: "camp",
          id: c.id,
          submitted_ts: c.created_at,
          student_name:
            `${c.student_first_name ?? ""} ${c.student_last_name ?? ""}`.trim(),
          // Camp records last grade COMPLETED — label it so the column
          // doesn't read as current grade.
          grade: c.last_grade_completed
            ? `${c.last_grade_completed} (completed)`
            : "",
          school: (c.current_school ?? "").trim(),
          parent_name:
            `${c.primary_parent_first_name ?? ""} ${c.primary_parent_last_name ?? ""}`.trim(),
          phone: c.primary_phone ?? "",
          email: (c.primary_email ?? "").trim(),
          rating: Number(c.interest_level) || 0,
          followed_up: c.isFollowedUp === true,
          last_reach_out: reachOut(`camp-${c.id}`, c.last_reach_out),
          detail: c.attended_camp
            ? "Attended camp"
            : c.isNotAttending
              ? "Not attending"
              : "",
          opt_in: true,
          grade_raw: (c.last_grade_completed ?? "").trim(),
          lead_status: leadStatus(c.status),
          status_reason: (c.status_reason ?? "").trim(),
          school_year_id: yearIdOf(c),
          school_year_name: yearNameById.get(yearIdOf(c)) ?? "",
          converted_family_id: leadConvertedFamilyId(c),
          converted_at: Number(c.converted_at) || 0,
        })
      ),
      ...waivers.map(
        (w): BareRow => ({
          key: `visit-${w.id}`,
          source: "visit",
          id: w.id,
          submitted_ts: w.signed_at ?? w.created_at,
          student_name: (w.student_name ?? "").trim(),
          grade: (w.student_grade ?? "").trim(),
          school: (w.student_school ?? "").trim(),
          parent_name: (w.parent_name ?? "").trim(),
          phone: w.parent_phone ?? "",
          email: (w.parent_email ?? "").trim(),
          rating: Number(w.interest_level) || 0,
          followed_up: w.isFollowedUp === true,
          last_reach_out: reachOut(`visit-${w.id}`, w.last_reach_out),
          detail: w.marketing_opt_in ? "" : "No marketing opt-in",
          opt_in: w.marketing_opt_in === true,
          grade_raw: (w.student_grade ?? "").trim(),
          lead_status: leadStatus(w.status),
          status_reason: (w.status_reason ?? "").trim(),
          school_year_id: yearIdOf(w),
          school_year_name: yearNameById.get(yearIdOf(w)) ?? "",
          converted_family_id: leadConvertedFamilyId(w),
          converted_at: Number(w.converted_at) || 0,
        })
      ),
      ...tascoRows.map(
        (t): BareRow => ({
          key: `tasco-${t.id}`,
          source: "tasco",
          id: t.id,
          submitted_ts: t.created_at,
          student_name: (t.student_name ?? "").trim(),
          grade: (t.current_grade ?? "").trim(),
          school: (t.current_school ?? "").trim(),
          parent_name: "",
          phone: t.parent_phone ?? "",
          email: (t.parent_email ?? "").trim(),
          rating: Number(t.interest_level) || 0,
          followed_up: t.isFollowedUp === true,
          last_reach_out: reachOut(`tasco-${t.id}`, t.last_reach_out),
          detail: (t.recreation_center ?? "").trim(),
          opt_in: t.marketing_opt_in === true,
          grade_raw: (t.current_grade ?? "").trim(),
          lead_status: leadStatus(t.status),
          status_reason: (t.status_reason ?? "").trim(),
          school_year_id: yearIdOf(t),
          school_year_name: yearNameById.get(yearIdOf(t)) ?? "",
          converted_family_id: leadConvertedFamilyId(t),
          converted_at: Number(t.converted_at) || 0,
        })
      ),
    ];

    const rows: AllLeadRow[] = bare
      .map((r) => {
        const tour = tourFor(r.key);
        const fid = r.converted_family_id;
        return {
          ...r,
          tour_status: tour.status,
          tour_at: tour.at,
          converted_family_name: fid
            ? familyNameById.get(fid) || `Family #${fid}`
            : "",
          // Linked but no application data at all = the family row
          // exists (or the joins blipped) — still worth showing as
          // further along than an untouched lead.
          funnel_stage: fid ? (stageByFamily.get(fid) ?? "linked") : "",
        };
      })
      .sort((a, b) => b.submitted_ts - a.submitted_ts);

    return NextResponse.json(rows);
  } catch (err) {
    return handleAdminError(err);
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";

/**
 * Admin Applications list — unified view of initial applications AND
 * re-applications for the selected school year. One row per family per
 * year per flow; rows carry a `flow_type` discriminator ("apply" |
 * "reapply") so the table can render flow-appropriate section labels +
 * route to the correct per-section editor.
 *
 * Why merge: admin wants one place to see "everyone applying for next
 * year" without bouncing between two surfaces. Both flows have the
 * same shape (family / students / financial aid / fourth) — the fourth
 * column is "Testing" for new applications and "Transportation" for
 * re-applications, plus the slugs differ.
 *
 * Joins:
 *   - `xano.familyApplicationProgress.getByYear()` → initial-app rows
 *   - `xano.reapplyFamilyProgress.getByYear()` → reapply rows
 *   - `xano.families.getAll()` + `xano.parents.getAll()` → display labels
 *   - `xano.applications.getAll()` filtered to (year) → student counts
 *
 * Joins are isolated so a single Xano hiccup doesn't 500 the whole
 * route — failures fall back to placeholder labels and zero counts
 * with the underlying error logged.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const yearIdParam = req.nextUrl.searchParams.get("yearId");
    if (!yearIdParam) {
      return NextResponse.json(
        { error: "yearId is required" },
        { status: 400 }
      );
    }
    const yearId = Number(yearIdParam);
    if (!Number.isFinite(yearId) || yearId <= 0) {
      return NextResponse.json(
        { error: "yearId must be a positive number" },
        { status: 400 }
      );
    }

    const [
      applyResult,
      reapplyResult,
      familiesResult,
      parentsResult,
      appsResult,
      studentsResult,
    ] = await Promise.allSettled([
      xano.familyApplicationProgress.getByYear(yearId),
      xano.reapplyFamilyProgress.getByYear(yearId),
      xano.families.getAll(),
      xano.parents.getAll(),
      xano.applications.getAll(),
      // Pulled here so we can surface a per-family student-names
      // string ("Maxual Thompson, Thomas Haugh") on every row.
      // The registrations list does the same thing — keeps the two
      // surfaces feeling consistent.
      xano.students.getAll(),
    ]);

    if (applyResult.status === "rejected") {
      console.error(
        "[/api/admin/applications] failed to load apply progress:",
        applyResult.reason
      );
    }
    if (reapplyResult.status === "rejected") {
      console.error(
        "[/api/admin/applications] failed to load reapply progress:",
        reapplyResult.reason
      );
    }
    if (familiesResult.status === "rejected") {
      console.error(
        "[/api/admin/applications] failed to load families list:",
        familiesResult.reason
      );
    }
    if (parentsResult.status === "rejected") {
      console.error(
        "[/api/admin/applications] failed to load parents list:",
        parentsResult.reason
      );
    }
    if (appsResult.status === "rejected") {
      console.error(
        "[/api/admin/applications] failed to load applications list:",
        appsResult.reason
      );
    }
    if (studentsResult.status === "rejected") {
      console.error(
        "[/api/admin/applications] failed to load students list:",
        studentsResult.reason
      );
    }

    const applyRows =
      applyResult.status === "fulfilled" ? applyResult.value : [];
    const reapplyRows =
      reapplyResult.status === "fulfilled" ? reapplyResult.value : [];
    const families =
      familiesResult.status === "fulfilled" ? familiesResult.value : [];
    const parents =
      parentsResult.status === "fulfilled" ? parentsResult.value : [];
    const apps = appsResult.status === "fulfilled" ? appsResult.value : [];
    const studentsAll =
      studentsResult.status === "fulfilled" ? studentsResult.value : [];
    const studentById = new Map(studentsAll.map((s) => [s.id, s]));

    const familyById = new Map(families.map((f) => [f.id, f]));

    const parentsByFamily = new Map<number, typeof parents>();
    for (const family of families) {
      const ids = xano.families.getParentIds(family);
      const matched = parents.filter((p) => ids.includes(p.id));
      matched.sort((a, b) => a.id - b.id);
      parentsByFamily.set(family.id, matched);
    }

    // Per-family active-student bucket for the requested year. One
    // application row = one student. `isActive=false` rows are
    // soft-deleted (kept for history) and excluded from admin counts.
    // Treat `undefined` as active so legacy rows still count. We
    // collect the student ids per family (rather than just counting)
    // so the API can surface a comma-joined names string per row,
    // matching the registrations list.
    const studentIdsByFamily = new Map<number, number[]>();
    for (const a of apps) {
      if (Number(a.registration_school_years_id) !== yearId) continue;
      if (a.isActive === false) continue;
      const fid = Number(a.registration_families_id);
      const sid = Number(a.registration_students_id);
      const arr = studentIdsByFamily.get(fid) ?? [];
      arr.push(sid);
      studentIdsByFamily.set(fid, arr);
    }

    function lookupLabel(familyId: number) {
      const family = familyById.get(familyId) ?? null;
      const familyParents = parentsByFamily.get(familyId) ?? [];
      const primary = familyParents[0] ?? null;
      const studentIds = studentIdsByFamily.get(familyId) ?? [];
      // Build the display name list in id order — same approach the
      // registrations route uses so re-enrolling students with two
      // packets across years sort consistently across surfaces.
      const studentNames = studentIds
        .map((sid) => {
          const s = studentById.get(sid);
          if (!s) return "";
          return `${s.first_name ?? ""} ${s.last_name ?? ""}`.trim();
        })
        .filter(Boolean);
      return {
        family_name:
          family?.family_name?.trim() || `Family #${familyId}`,
        primary_name: primary
          ? `${primary.first_name ?? ""} ${primary.last_name ?? ""}`.trim()
          : "",
        primary_email: primary?.email ?? "",
        student_count: studentIds.length,
        student_names: studentNames.join(", "),
      };
    }

    const initialRows: UnifiedAppRow[] = applyRows.map((p) => {
      const labels = lookupLabel(p.registration_families_id);
      const sectionsComplete = [
        p.family_completed,
        p.students_completed,
        p.financial_aid_completed,
        p.testing_completed,
      ].filter(Boolean).length;
      return {
        id: p.id,
        family_id: p.registration_families_id,
        year_id: p.registration_school_years_id,
        flow_type: "apply",
        ...labels,
        family_done: !!p.family_completed,
        students_done: !!p.students_completed,
        financial_aid_done: !!p.financial_aid_completed,
        fourth_done: !!p.testing_completed,
        fourth_label: "Testing",
        sections_complete: sectionsComplete,
        sections_total: 4,
        isSubmitted: !!p.isSubmitted,
        // `isAccepted` lives on the per-year progress row; the
        // family-detail Approve button flips it. Surfaced here so
        // the applications list can split accepted families into
        // their own card above Submitted. The family-progress
        // PATCH route auto-flips `isSubmitted = true` whenever
        // `isAccepted = true`, so an accepted family is always
        // also "submitted" — the page filter just prefers the
        // more-specific "accepted" bucket when both apply.
        isAccepted: !!p.isAccepted,
        submitted_at: p.submitted_at,
        last_edited: p.last_edited,
        // Surface the archive flag + reason so the page can split
        // archived rows into their own card. `is_archived` is
        // optional on legacy rows; treat missing as `false`.
        is_archived: p.is_archived === true,
        reason_for_archive: p.reason_for_archive ?? null,
      };
    });

    const reapplyOut: UnifiedAppRow[] = reapplyRows.map((p) => {
      const labels = lookupLabel(p.registration_families_id);
      const sectionsComplete = [
        p.isFamilyDetails,
        p.isStudentDetails,
        p.isScholarship,
        p.isTransportation,
      ].filter(Boolean).length;
      return {
        id: p.id,
        family_id: p.registration_families_id,
        year_id: p.registration_school_years_id,
        flow_type: "reapply",
        ...labels,
        family_done: !!p.isFamilyDetails,
        students_done: !!p.isStudentDetails,
        financial_aid_done: !!p.isScholarship,
        fourth_done: !!p.isTransportation,
        fourth_label: "Transportation",
        sections_complete: sectionsComplete,
        sections_total: 4,
        isSubmitted: !!p.isSubmitted,
        // Reapply rows don't carry an `isAccepted` column — the
        // re-application flow doesn't go through the same Approve
        // gate that initial applications do. Hardcode `false` so
        // the row stays in the standard Submitted / In Progress
        // buckets on the page.
        isAccepted: false,
        submitted_at: null,
        last_edited: p.last_edited,
        // Reapply rows don't carry an archive column today — leave
        // the field on the row so the type stays uniform across
        // both flows; admin's Archive button only writes to the
        // initial apply progress row.
        is_archived: false,
        reason_for_archive: null,
      };
    });

    const rows = [...initialRows, ...reapplyOut];

    rows.sort((a, b) => {
      if (a.isSubmitted !== b.isSubmitted) return a.isSubmitted ? -1 : 1;
      const aEdit = a.last_edited ?? a.submitted_at ?? 0;
      const bEdit = b.last_edited ?? b.submitted_at ?? 0;
      return bEdit - aEdit;
    });

    return NextResponse.json(rows);
  } catch (err) {
    return handleAdminError(err);
  }
}

/**
 * Unified row shape — initial applications and re-applications both
 * collapse into this. The 4th section pivots between Testing (apply)
 * and Transportation (reapply); section slugs are derived from
 * `flow_type` on the page side rather than baked in here.
 */
export interface UnifiedAppRow {
  id: number;
  family_id: number;
  year_id: number;
  flow_type: "apply" | "reapply";
  family_name: string;
  primary_name: string;
  primary_email: string;
  student_count: number;
  /** Comma-joined display string of every active student name on
   *  the family for the year (e.g. "Maxual Thompson, Thomas Haugh").
   *  Surfaced so the table can show the cohort without an extra
   *  lookup. Mirrors the registrations list's `student_names`. */
  student_names: string;
  family_done: boolean;
  students_done: boolean;
  financial_aid_done: boolean;
  fourth_done: boolean;
  fourth_label: "Testing" | "Transportation";
  sections_complete: number;
  sections_total: number;
  isSubmitted: boolean;
  /** True once admin has accepted this family for the year (via the
   *  Approve button on the family detail page). Used by the page
   *  to lift accepted rows out of the Submitted bucket and into a
   *  dedicated Accepted card. Reapply rows always set this to
   *  `false` — the reapply flow has no acceptance gate. */
  isAccepted: boolean;
  submitted_at: number | null;
  last_edited: number | null;
  is_archived: boolean;
  reason_for_archive: string | null;
}

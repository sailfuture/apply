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
    ] = await Promise.allSettled([
      xano.familyApplicationProgress.getByYear(yearId),
      xano.reapplyFamilyProgress.getByYear(yearId),
      xano.families.getAll(),
      xano.parents.getAll(),
      xano.applications.getAll(),
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

    const applyRows =
      applyResult.status === "fulfilled" ? applyResult.value : [];
    const reapplyRows =
      reapplyResult.status === "fulfilled" ? reapplyResult.value : [];
    const families =
      familiesResult.status === "fulfilled" ? familiesResult.value : [];
    const parents =
      parentsResult.status === "fulfilled" ? parentsResult.value : [];
    const apps = appsResult.status === "fulfilled" ? appsResult.value : [];

    const familyById = new Map(families.map((f) => [f.id, f]));

    const parentsByFamily = new Map<number, typeof parents>();
    for (const family of families) {
      const ids = xano.families.getParentIds(family);
      const matched = parents.filter((p) => ids.includes(p.id));
      matched.sort((a, b) => a.id - b.id);
      parentsByFamily.set(family.id, matched);
    }

    const appsByFamily = new Map<number, number>();
    for (const a of apps) {
      if (Number(a.registration_school_years_id) !== yearId) continue;
      const fid = Number(a.registration_families_id);
      appsByFamily.set(fid, (appsByFamily.get(fid) ?? 0) + 1);
    }

    function lookupLabel(familyId: number) {
      const family = familyById.get(familyId) ?? null;
      const familyParents = parentsByFamily.get(familyId) ?? [];
      const primary = familyParents[0] ?? null;
      return {
        family_name:
          family?.family_name?.trim() || `Family #${familyId}`,
        primary_name: primary
          ? `${primary.first_name ?? ""} ${primary.last_name ?? ""}`.trim()
          : "",
        primary_email: primary?.email ?? "",
        student_count: appsByFamily.get(familyId) ?? 0,
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
        submitted_at: p.submitted_at,
        last_edited: p.last_edited,
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
        submitted_at: null,
        last_edited: p.last_edited,
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
  family_done: boolean;
  students_done: boolean;
  financial_aid_done: boolean;
  fourth_done: boolean;
  fourth_label: "Testing" | "Transportation";
  sections_complete: number;
  sections_total: number;
  isSubmitted: boolean;
  submitted_at: number | null;
  last_edited: number | null;
}

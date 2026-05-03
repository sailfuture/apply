import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";

/**
 * Admin Applications list — one row per family per year, backed by the
 * Xano `registration_family_application_progress_by_year` query. Each
 * row carries the four section-completion booleans plus the hard-submit
 * flag, so the admin table can show per-section progress at a glance.
 *
 * Joins:
 *   - `xano.families.getAll()` → resolves `family_name` for every family
 *     (including families that don't yet appear in the enriched
 *     `_all_details` endpoint because they have no students yet).
 *   - `xano.parents.getAll()` → primary parent name + email for the
 *     row subtitle. We pick the lowest-id parent on the family as the
 *     "primary" since Xano doesn't model that explicitly.
 *   - `xano.applications.getAll()` filtered to (family, year) → student
 *     count for the year. Each app row in `registration_application` is
 *     one student in that year's application, so the row count is the
 *     student count.
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

    const [progressResult, familiesResult, parentsResult, appsResult] =
      await Promise.allSettled([
        xano.familyApplicationProgress.getByYear(yearId),
        xano.families.getAll(),
        xano.parents.getAll(),
        xano.applications.getAll(),
      ]);

    if (progressResult.status === "rejected") {
      console.error(
        "[/api/admin/applications] failed to load family progress:",
        progressResult.reason
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

    const progressRows =
      progressResult.status === "fulfilled" ? progressResult.value : [];
    const families =
      familiesResult.status === "fulfilled" ? familiesResult.value : [];
    const parents =
      parentsResult.status === "fulfilled" ? parentsResult.value : [];
    const apps = appsResult.status === "fulfilled" ? appsResult.value : [];

    const familyById = new Map(families.map((f) => [f.id, f]));

    // Group parents by family_id by reading each parent's family ID from
    // the family's `registration_parents_id` array. Parents themselves
    // don't directly carry `registration_families_id`, so we walk
    // families and look up parents by their id.
    const parentsByFamily = new Map<number, typeof parents>();
    for (const family of families) {
      const ids = xano.families.getParentIds(family);
      const matched = parents.filter((p) => ids.includes(p.id));
      // Sort by id ascending so the "primary" is deterministic — usually
      // the first-created parent is the one who signed up the family.
      matched.sort((a, b) => a.id - b.id);
      parentsByFamily.set(family.id, matched);
    }

    // App count per family for the requested year — equals the student
    // count for that year's application (one app row = one student).
    const appsByFamily = new Map<number, number>();
    for (const a of apps) {
      if (Number(a.registration_school_years_id) !== yearId) continue;
      const fid = Number(a.registration_families_id);
      appsByFamily.set(fid, (appsByFamily.get(fid) ?? 0) + 1);
    }

    const rows: AppProgressRow[] = progressRows.map((p) => {
      const family = familyById.get(p.registration_families_id) ?? null;
      const familyParents =
        parentsByFamily.get(p.registration_families_id) ?? [];
      const primary = familyParents[0] ?? null;
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
        family_name:
          family?.family_name?.trim() ||
          `Family #${p.registration_families_id}`,
        primary_name: primary
          ? `${primary.first_name ?? ""} ${primary.last_name ?? ""}`.trim()
          : "",
        primary_email: primary?.email ?? "",
        student_count: appsByFamily.get(p.registration_families_id) ?? 0,
        family_completed: !!p.family_completed,
        students_completed: !!p.students_completed,
        financial_aid_completed: !!p.financial_aid_completed,
        testing_completed: !!p.testing_completed,
        sections_complete: sectionsComplete,
        sections_total: 4,
        isSubmitted: !!p.isSubmitted,
        submitted_at: p.submitted_at,
        last_edited: p.last_edited,
      };
    });

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

export interface AppProgressRow {
  id: number;
  family_id: number;
  year_id: number;
  family_name: string;
  primary_name: string;
  primary_email: string;
  student_count: number;
  family_completed: boolean;
  students_completed: boolean;
  financial_aid_completed: boolean;
  testing_completed: boolean;
  sections_complete: number;
  sections_total: number;
  isSubmitted: boolean;
  submitted_at: number | null;
  last_edited: number | null;
}

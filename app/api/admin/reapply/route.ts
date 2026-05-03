import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";

/**
 * Admin Reapply list — one row per returning family per year, backed by
 * Xano's `reapply_family_progress_by_year` query. Each row carries the
 * four reapply section booleans (`isFamilyDetails`, `isStudentDetails`,
 * `isScholarship`, `isTransportation`) plus the hard-submit flag, with
 * the family record expanded inline so we don't need a separate join.
 *
 * Parents are joined separately (Xano endpoint doesn't expand them) so
 * each row can show the primary parent's name + email.
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

    const [progressResult, parentsResult] = await Promise.allSettled([
      xano.reapplyFamilyProgress.getByYear(yearId),
      xano.parents.getAll(),
    ]);

    if (progressResult.status === "rejected") {
      console.error(
        "[/api/admin/reapply] failed to load reapply progress:",
        progressResult.reason
      );
    }
    if (parentsResult.status === "rejected") {
      console.error(
        "[/api/admin/reapply] failed to load parents list:",
        parentsResult.reason
      );
    }

    const progressRows =
      progressResult.status === "fulfilled" ? progressResult.value : [];
    const parents =
      parentsResult.status === "fulfilled" ? parentsResult.value : [];

    const rows: ReapplyRow[] = progressRows.map((p) => {
      const family = p._registration_families ?? null;
      const parentIds = family?.registration_parents_id ?? [];
      const familyParents = parents
        .filter((parent) => parentIds.includes(parent.id))
        .sort((a, b) => a.id - b.id);
      const primary = familyParents[0] ?? null;
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
        family_name:
          family?.family_name?.trim() ||
          `Family #${p.registration_families_id}`,
        primary_name: primary
          ? `${primary.first_name ?? ""} ${primary.last_name ?? ""}`.trim()
          : "",
        primary_email: primary?.email ?? "",
        student_count: family?.registration_students_id?.length ?? 0,
        isFamilyDetails: !!p.isFamilyDetails,
        isStudentDetails: !!p.isStudentDetails,
        isScholarship: !!p.isScholarship,
        isTransportation: !!p.isTransportation,
        sections_complete: sectionsComplete,
        sections_total: 4,
        isSubmitted: !!p.isSubmitted,
        last_edited: p.last_edited,
      };
    });

    rows.sort((a, b) => {
      if (a.isSubmitted !== b.isSubmitted) return a.isSubmitted ? -1 : 1;
      const aEdit = a.last_edited ?? 0;
      const bEdit = b.last_edited ?? 0;
      return bEdit - aEdit;
    });

    return NextResponse.json(rows);
  } catch (err) {
    return handleAdminError(err);
  }
}

export interface ReapplyRow {
  id: number;
  family_id: number;
  year_id: number;
  family_name: string;
  primary_name: string;
  primary_email: string;
  student_count: number;
  isFamilyDetails: boolean;
  isStudentDetails: boolean;
  isScholarship: boolean;
  isTransportation: boolean;
  sections_complete: number;
  sections_total: number;
  isSubmitted: boolean;
  last_edited: number | null;
}

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";

/**
 * Admin Registrations list — one row per family per year. Backed by the
 * Xano `registration_student_registration_progress_by_year` query, joined
 * with the family + primary parent details from the enriched families
 * endpoint so each row carries a human-readable label. Once Xano expands
 * those fields directly we can drop the join.
 *
 * Each row carries the four post-acceptance section bools (`isTuition`,
 * `isEnrollment`, `isRegistration`, `isVolunteerHours`), the hard-submit
 * flag (`isSubmitted`), and the PandaDoc enrollment-agreement state so
 * the admin table can show progress at a glance.
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

    // Isolate failures so a Xano hiccup on the families join doesn't
    // 500 the whole table. Same pattern as `/api/admin/applications`.
    const [progressResult, familiesResult] = await Promise.allSettled([
      xano.studentRegistrationProgress.getByYear(yearId),
      xano.families.getAllDetails(),
    ]);

    if (progressResult.status === "rejected") {
      console.error(
        "[/api/admin/registrations] failed to load registration progress:",
        progressResult.reason
      );
    }
    if (familiesResult.status === "rejected") {
      console.error(
        "[/api/admin/registrations] failed to load families join:",
        familiesResult.reason
      );
    }

    const progressRows =
      progressResult.status === "fulfilled" ? progressResult.value : [];
    const families =
      familiesResult.status === "fulfilled" ? familiesResult.value : [];

    const familyById = new Map(families.map((f) => [f.id, f]));

    const rows: RegProgressRow[] = progressRows.map((p) => {
      const family = familyById.get(p.registration_families_id) ?? null;
      const primary = family?.registration_parents_id?.[0] ?? null;
      const sectionsComplete = [
        p.isTuition,
        p.isEnrollment,
        p.isRegistration,
        p.isVolunteerHours,
      ].filter(Boolean).length;
      return {
        id: p.id,
        family_id: p.registration_families_id,
        year_id: p.registration_school_years_id,
        family_name:
          family?.family_name || `Family #${p.registration_families_id}`,
        primary_name: primary
          ? `${primary.first_name ?? ""} ${primary.last_name ?? ""}`.trim()
          : "",
        primary_email: primary?.email ?? "",
        student_count: family
          ? new Set(
              family.registration_students_id
                .map((a) => Number(a.registration_students_id))
                .filter((id) => Number.isFinite(id) && id > 0)
            ).size
          : 0,
        isTuition: !!p.isTuition,
        isEnrollment: !!p.isEnrollment,
        isRegistration: !!p.isRegistration,
        isVolunteerHours: !!p.isVolunteerHours,
        sections_complete: sectionsComplete,
        sections_total: 4,
        isSubmitted: !!p.isSubmitted,
        submitted_date: p.submitted_date,
        last_edited: p.last_edited,
        enrollment_agreement_status: p.enrollment_agreement_status ?? "",
        is_enrollment_agreement_signed: !!p.is_enrollment_agreement_signed,
      };
    });

    rows.sort((a, b) => {
      if (a.isSubmitted !== b.isSubmitted) return a.isSubmitted ? -1 : 1;
      const aEdit = a.last_edited ?? a.submitted_date ?? 0;
      const bEdit = b.last_edited ?? b.submitted_date ?? 0;
      return bEdit - aEdit;
    });

    return NextResponse.json(rows);
  } catch (err) {
    return handleAdminError(err);
  }
}

export interface RegProgressRow {
  id: number;
  family_id: number;
  year_id: number;
  family_name: string;
  primary_name: string;
  primary_email: string;
  student_count: number;
  isTuition: boolean;
  isEnrollment: boolean;
  isRegistration: boolean;
  isVolunteerHours: boolean;
  sections_complete: number;
  sections_total: number;
  isSubmitted: boolean;
  submitted_date: number | null;
  last_edited: number | null;
  enrollment_agreement_status: string;
  is_enrollment_agreement_signed: boolean;
}

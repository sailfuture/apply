import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";

/**
 * Admin Registrations list — one row per **student who has been
 * confirmed to be starting** in the requested academic year.
 *
 * "Confirmed to be starting" === per-student application row with
 * `isAccepted=true` for the year. We pivot off of
 * `registration_application` (already one row per student per year)
 * rather than the family-level progress row, so a family with three
 * students where only two are accepted shows two registration rows.
 *
 * Joins:
 *   - `xano.applications.getAll()` filtered to (year, isAccepted=true)
 *   - `xano.students.getAll()` for student names + DOB
 *   - `xano.families.getAll()` for the family label
 *   - `xano.parents.getAll()` for the primary parent's name + email
 *   - `xano.studentRegistrationProgress.getByYear(year)` for the
 *     family-level packet booleans (tuition / enrollment agreement /
 *     registration packet / volunteer hours). These are still per-family
 *     because that's how Xano models them today; if you split them
 *     per-student later, the row shape doesn't change.
 *
 * Each join is wrapped in `Promise.allSettled` so a single Xano hiccup
 * doesn't 500 the whole route.
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
      appsResult,
      studentsResult,
      familiesResult,
      parentsResult,
      progressResult,
    ] = await Promise.allSettled([
      xano.applications.getAll(),
      xano.students.getAll(),
      xano.families.getAll(),
      xano.parents.getAll(),
      xano.studentRegistrationProgress.getByYear(yearId),
    ]);

    if (appsResult.status === "rejected") {
      console.error(
        "[/api/admin/registrations] failed to load applications:",
        appsResult.reason
      );
    }
    if (studentsResult.status === "rejected") {
      console.error(
        "[/api/admin/registrations] failed to load students:",
        studentsResult.reason
      );
    }
    if (familiesResult.status === "rejected") {
      console.error(
        "[/api/admin/registrations] failed to load families:",
        familiesResult.reason
      );
    }
    if (parentsResult.status === "rejected") {
      console.error(
        "[/api/admin/registrations] failed to load parents:",
        parentsResult.reason
      );
    }
    if (progressResult.status === "rejected") {
      console.error(
        "[/api/admin/registrations] failed to load registration progress:",
        progressResult.reason
      );
    }

    const apps =
      appsResult.status === "fulfilled" ? appsResult.value : [];
    const students =
      studentsResult.status === "fulfilled" ? studentsResult.value : [];
    const families =
      familiesResult.status === "fulfilled" ? familiesResult.value : [];
    const parents =
      parentsResult.status === "fulfilled" ? parentsResult.value : [];
    const progressRows =
      progressResult.status === "fulfilled" ? progressResult.value : [];

    const studentById = new Map(students.map((s) => [s.id, s]));
    const familyById = new Map(families.map((f) => [f.id, f]));

    // Primary parent per family — lowest id wins, mirroring how the
    // Applications endpoint picks one for display.
    const primaryByFamily = new Map<number, (typeof parents)[number] | null>();
    for (const f of families) {
      const ids = xano.families.getParentIds(f);
      const matched = parents
        .filter((p) => ids.includes(p.id))
        .sort((a, b) => a.id - b.id);
      primaryByFamily.set(f.id, matched[0] ?? null);
    }

    // Family-level registration progress is keyed by family for the year
    // — used for the four packet booleans on each student row.
    const progressByFamily = new Map(
      progressRows.map((p) => [p.registration_families_id, p])
    );

    const acceptedApps = apps.filter(
      (a) =>
        Number(a.registration_school_years_id) === yearId &&
        (a as { isAccepted?: boolean }).isAccepted === true
    );

    const rows: RegistrationStudentRow[] = acceptedApps.map((app) => {
      const studentId = Number(app.registration_students_id);
      const familyId = Number(app.registration_families_id);
      const student = studentById.get(studentId) ?? null;
      const family = familyById.get(familyId) ?? null;
      const primary = primaryByFamily.get(familyId) ?? null;
      const progress = progressByFamily.get(familyId) ?? null;
      const sectionsComplete = progress
        ? [
            progress.isTuition,
            progress.isEnrollment,
            progress.isRegistration,
            progress.isVolunteerHours,
          ].filter(Boolean).length
        : 0;
      return {
        id: app.id,
        application_id: app.id,
        student_id: studentId,
        family_id: familyId,
        year_id: yearId,
        student_first_name: student?.first_name ?? "",
        student_last_name: student?.last_name ?? "",
        student_full_name: student
          ? `${student.first_name ?? ""} ${student.last_name ?? ""}`.trim()
          : `Student #${studentId}`,
        student_dob: student?.date_of_birth ?? "",
        student_grade: app.current_grade ?? "",
        family_name:
          family?.family_name?.trim() || `Family #${familyId}`,
        primary_name: primary
          ? `${primary.first_name ?? ""} ${primary.last_name ?? ""}`.trim()
          : "",
        primary_email: primary?.email ?? "",
        // Family-level packet booleans (we'll move these per-student
        // later if Xano grows that schema).
        isTuition: !!progress?.isTuition,
        isEnrollment: !!progress?.isEnrollment,
        isRegistration: !!progress?.isRegistration,
        isVolunteerHours: !!progress?.isVolunteerHours,
        sections_complete: sectionsComplete,
        sections_total: 4,
        registration_submitted: !!progress?.isSubmitted,
        registration_submitted_date: progress?.submitted_date ?? null,
        last_edited: progress?.last_edited ?? null,
        enrollment_agreement_status:
          progress?.enrollment_agreement_status ?? "",
        is_enrollment_agreement_signed:
          !!progress?.is_enrollment_agreement_signed,
      };
    });

    rows.sort((a, b) => {
      // Submitted-first within accepted students, then most recently
      // touched, then alphabetical by student last name.
      if (a.registration_submitted !== b.registration_submitted) {
        return a.registration_submitted ? -1 : 1;
      }
      const aEdit = a.last_edited ?? a.registration_submitted_date ?? 0;
      const bEdit = b.last_edited ?? b.registration_submitted_date ?? 0;
      if (aEdit !== bEdit) return bEdit - aEdit;
      return (a.student_last_name ?? "").localeCompare(
        b.student_last_name ?? ""
      );
    });

    return NextResponse.json(rows);
  } catch (err) {
    return handleAdminError(err);
  }
}

export interface RegistrationStudentRow {
  /** Stable row id — matches `application_id` so DataTable's row key is
   *  unique even before we lift `student_id` into the URL. */
  id: number;
  application_id: number;
  student_id: number;
  family_id: number;
  year_id: number;
  student_first_name: string;
  student_last_name: string;
  student_full_name: string;
  student_dob: string;
  student_grade: string;
  family_name: string;
  primary_name: string;
  primary_email: string;
  isTuition: boolean;
  isEnrollment: boolean;
  isRegistration: boolean;
  isVolunteerHours: boolean;
  sections_complete: number;
  sections_total: number;
  registration_submitted: boolean;
  registration_submitted_date: number | null;
  last_edited: number | null;
  enrollment_agreement_status: string;
  is_enrollment_agreement_signed: boolean;
}

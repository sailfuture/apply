import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";

/**
 * Admin Registrations list — one row per **student who has been
 * confirmed to be starting** in the requested academic year.
 *
 * "Confirmed to be starting" === the family's per-year
 * `registration_family_application_progress.isAccepted` is true.
 * Acceptance is owned at the family level (the Approve button on the
 * Scholarship Determination card flips the family-progress row, not
 * the per-student application rows), so we filter applications by
 * family membership in the accepted set rather than the per-student
 * `isAccepted` flag.
 *
 * Per-student `isAccepted` is still honored as a fallback — legacy
 * rows that pre-date the family-level approval flow may still carry
 * it, and we don't want to silently hide them.
 *
 * Pivoting off `registration_application` (one row per student per
 * year) keeps the row shape per-student: a family with three
 * students where only two are active shows two registration rows.
 *
 * Joins:
 *   - `xano.applications.getAll()` for the year's per-student rows
 *   - `xano.familyApplicationProgress.getByYear(year)` to find which
 *     families have been accepted
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
      familyProgressResult,
    ] = await Promise.allSettled([
      xano.applications.getAll(),
      xano.students.getAll(),
      xano.families.getAll(),
      xano.parents.getAll(),
      xano.studentRegistrationProgress.getByYear(yearId),
      xano.familyApplicationProgress.getByYear(yearId),
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
    if (familyProgressResult.status === "rejected") {
      console.error(
        "[/api/admin/registrations] failed to load family application progress:",
        familyProgressResult.reason
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
    const familyProgressRows =
      familyProgressResult.status === "fulfilled"
        ? familyProgressResult.value
        : [];

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

    // Archived registrations are hidden from the active queues. The
    // Archive button on the registration detail page flips
    // `isArchived` on the family's per-year
    // `registration_student_registration_progress` row — the same row
    // these packet booleans come from — but this route never read it,
    // so an archived family kept sitting in In Progress / Not Started
    // with no way to clear it. (Verified on 2026-2027: Fluellen
    // (Kenneth), Murray (Maleah) and Hohlfeld were all archived and
    // still listed.)
    const archivedFamilyIds = new Set(
      progressRows
        .filter((p) => p.isArchived === true)
        .map((p) => Number(p.registration_families_id))
    );

    // Set of family ids whose per-year application progress row says
    // accepted. The Approve flow on the Scholarship Determination card
    // patches `isAccepted=true` on this row, NOT on the per-student
    // application rows — so this is the authoritative source for
    // "is this family approved to start?" Without this set, accepted
    // families would never appear under Registrations because the
    // legacy per-student `isAccepted` filter never gets flipped.
    const acceptedFamilyIds = new Set(
      familyProgressRows
        .filter((p) => p.isAccepted === true)
        .map((p) => p.registration_families_id)
    );

    // Show students whose family is accepted for the year (or, as a
    // fallback, whose per-student application row has the legacy
    // `isAccepted=true` flag — preserves visibility for any rows
    // approved before the family-level flow). `isActive=false` is a
    // soft delete (parent removed the student from the year) — keep
    // historical, hide from admin pipeline. `undefined` isActive
    // counts as active so legacy rows still appear.
    const acceptedApps = apps.filter((a) => {
      if (Number(a.registration_school_years_id) !== yearId) return false;
      if ((a as { isActive?: boolean }).isActive === false) return false;
      if (archivedFamilyIds.has(Number(a.registration_families_id)))
        return false;
      const familyAccepted = acceptedFamilyIds.has(
        Number(a.registration_families_id)
      );
      const legacyStudentAccepted =
        (a as { isAccepted?: boolean }).isAccepted === true;
      return familyAccepted || legacyStudentAccepted;
    });

    // A document counts as "submitted" when its upload slot has at
    // least one file. Xano hands back multi-file slots as arrays but
    // legacy/empty slots can arrive as bare objects — mirror the
    // tolerant coercion the Documents-to-Review block uses.
    const hasFiles = (v: unknown): boolean => {
      if (!v) return false;
      if (Array.isArray(v)) return v.length > 0;
      if (typeof v === "object") return Object.keys(v).length > 0;
      return false;
    };

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
        // Family-level registration-confirmation latch. Drives the
        // "Completed" bucket on the Registrations list — once admin
        // clicks Confirm Family Registration, the row lifts out of
        // the Submitted / In Progress / Not Started queues and
        // lands in Completed.
        is_registration_confirmed:
          progress?.isRegistrationConfirmed === true,
        last_edited: progress?.last_edited ?? null,
        enrollment_agreement_status:
          progress?.enrollment_agreement_status ?? "",
        is_enrollment_agreement_signed:
          !!progress?.is_enrollment_agreement_signed,
        // Per-student required-document states — submitted (parent
        // uploaded at least one file into the slot) and approved
        // (admin flipped the doc-confirm on the student detail
        // route). Drives the Documents dots column on the list.
        doc_immunization_submitted: hasFiles(student?.immunization_forms),
        doc_immunization_approved:
          student?.immunization_admin_confirm === true,
        doc_birth_certificate_submitted: hasFiles(student?.birth_certificate),
        doc_birth_certificate_approved:
          student?.birth_certificate_admin_confirm === true,
        doc_school_health_form_submitted: hasFiles(
          student?.school_health_form
        ),
        doc_school_health_form_approved:
          student?.school_health_form_admin_confirm === true,
        doc_transcripts_submitted: hasFiles(student?.transcripts),
        doc_transcripts_approved: student?.transcripts_admin_confirm === true,
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
  /** Family-level registration-confirmation latch. True once admin
   *  has clicked Confirm Family Registration on the registration
   *  detail page. Drives the Completed bucket on the list. */
  is_registration_confirmed: boolean;
  last_edited: number | null;
  enrollment_agreement_status: string;
  is_enrollment_agreement_signed: boolean;
  /** Required-document states for this student — submitted = a file
   *  exists in the upload slot; approved = admin confirmed it (the
   *  doc-confirm pairs on `/api/admin/students/[id]`). */
  doc_immunization_submitted: boolean;
  doc_immunization_approved: boolean;
  doc_birth_certificate_submitted: boolean;
  doc_birth_certificate_approved: boolean;
  doc_school_health_form_submitted: boolean;
  doc_school_health_form_approved: boolean;
  doc_transcripts_submitted: boolean;
  doc_transcripts_approved: boolean;
}

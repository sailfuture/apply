import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import type {
  XanoApplication,
  XanoFamily,
  XanoParent,
  XanoStudent,
  XanoStudentRegistration,
  XanoSchoolYear,
} from "@/lib/xano";

/**
 * Admin GET — single enrolled student's detail view.
 *
 * URL: `/api/admin/enrolled/[id]?yearId=X`
 *   `[id]` is the student id (matches what the enrolled list row
 *   click sends). `yearId` is required because a student can have
 *   packets across multiple years for re-enrollment, and the page
 *   needs to scope to the right year's packet.
 *
 * Returns the per-student packet + the student bio + the per-year
 * application row + the family + primary parent (for context).
 * Read-only on this surface; admin can flip the packet's
 * `registrationConfirmed` from here using the existing per-student
 * PATCH endpoint.
 *
 * Authorization: requires admin. The student detail page is admin-
 * only — parents see this data through their own dashboard.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const { id: idParam } = await params;
    const studentId = Number(idParam);
    if (!Number.isFinite(studentId) || studentId <= 0) {
      return NextResponse.json(
        { error: "Invalid student id" },
        { status: 400 }
      );
    }

    const yearIdParam = req.nextUrl.searchParams.get("yearId");
    const yearId = Number(yearIdParam);
    if (!Number.isFinite(yearId) || yearId <= 0) {
      return NextResponse.json(
        { error: "yearId is required" },
        { status: 400 }
      );
    }

    // Pull student + their year-scoped packet + apps + families +
    // school year all in parallel. `studentRegistration.getByStudentAndYear`
    // is the year-scoped variant that handles re-enrolling students
    // who have packets across multiple years.
    const [
      studentResult,
      packetResult,
      appsResult,
      familiesResult,
      parentsResult,
      yearResult,
    ] = await Promise.allSettled([
      xano.students.getById(studentId),
      xano.studentRegistration.getByStudentAndYear(studentId, yearId),
      xano.applications.getAll(),
      xano.families.getAll(),
      xano.parents.getAll(),
      xano.schoolYears.getById(yearId),
    ]);
    // Emergency contacts come from a per-family endpoint; fetched
    // after we know `familyId` below.

    if (studentResult.status === "rejected") {
      console.error(
        "[/api/admin/enrolled/[id]] student fetch failed:",
        studentResult.reason
      );
      return NextResponse.json(
        { error: "Student not found" },
        { status: 404 }
      );
    }

    const student = studentResult.value;
    const packet =
      packetResult.status === "fulfilled" ? packetResult.value : null;
    const apps =
      appsResult.status === "fulfilled" ? appsResult.value : [];
    const families =
      familiesResult.status === "fulfilled" ? familiesResult.value : [];
    const parents =
      parentsResult.status === "fulfilled" ? parentsResult.value : [];
    const schoolYear =
      yearResult.status === "fulfilled" ? yearResult.value : null;

    // Find this student's app for the year — drives `current_grade`
    // and the family + parent joins below.
    const app = apps.find(
      (a) =>
        Number(a.registration_students_id) === studentId &&
        Number(a.registration_school_years_id) === yearId
    );

    // Family + every parent on the family (sorted lowest-id-first
    // so the "primary" parent — typically the row created first —
    // lands at index 0). The page renders all parents in a family-
    // info card, not just the primary, so admin sees the whole
    // contact roster at a glance.
    const familyId = app ? Number(app.registration_families_id) : null;
    const family =
      familyId != null
        ? families.find((f) => f.id === familyId) ?? null
        : null;
    const parentIds = family ? xano.families.getParentIds(family) : [];
    const familyParents =
      parentIds.length > 0
        ? parents
            .filter((p) => parentIds.includes(p.id))
            .sort((a, b) => a.id - b.id)
        : [];
    const primary = familyParents[0] ?? null;

    // Emergency contacts — fetched here (not in the parallel block
    // above) because the lookup is family-scoped and we don't know
    // the familyId until the app/family join lands. Best-effort:
    // an empty list on error so the page renders without the
    // emergency-contacts card.
    const emergencyContacts = familyId
      ? await xano.emergencyContacts
          .getByFamilyId(familyId)
          .catch(() => [])
      : [];

    return NextResponse.json({
      student: shapeStudent(student),
      app: app ? shapeApp(app) : null,
      packet: packet ? shapePacket(packet) : null,
      family: family
        ? {
            id: family.id,
            family_name: family.family_name ?? "",
          }
        : null,
      primary: primary ? shapeParent(primary) : null,
      parents: familyParents.map(shapeParent),
      emergency_contacts: emergencyContacts,
      school_year: schoolYear
        ? {
            id: schoolYear.id,
            year_name: schoolYear.year_name ?? "",
          }
        : null,
    } satisfies AdminEnrolledStudentResponse);
  } catch (err) {
    return handleAdminError(err);
  }
}

function shapeStudent(s: XanoStudent) {
  return {
    id: s.id,
    first_name: s.first_name ?? "",
    last_name: s.last_name ?? "",
    date_of_birth: s.date_of_birth ?? "",
    gender: s.gender ?? "",
    ethnicity: s.ethnicity ?? "",
    photo: s.photo ?? null,
    /** Last time any admin or parent wrote to this student row.
     *  Surfaced on the enrolled-detail page header so admin can see
     *  data staleness at a glance ("Last edited 3 days ago"). */
    last_edited_time: s.last_edited_time ?? null,
    /** Evergreen document arrays — these live on the student row
     *  (not the per-year packet) so they survive re-enrollment. The
     *  parent flow writes here via `/api/students/[id]`; the admin
     *  enrolled detail page renders the lists from this surface.
     *
     *  Each entry is Xano's file metadata blob:
     *  `{ name, path, url?, mime, size, meta }`. We pass them
     *  through as `unknown[]` rather than a tighter type because
     *  Xano sometimes returns extra keys (`type`, `access`,
     *  `tmpl`, …) we don't care about — the UI's renderer is
     *  defensive about shape. */
    birth_certificate: normalizeFileArray(s.birth_certificate),
    school_health_form: normalizeFileArray(s.school_health_form),
    transcripts: normalizeFileArray(s.transcripts),
    iep: normalizeFileArray(s.iep),
    ssn_card: normalizeFileArray(s.ssn_card),
    immunization_forms: normalizeFileArray(s.immunization_forms),
    passport: normalizeFileArray(s.passport),
    student_state_id: normalizeFileArray(s.student_state_id),
    /** Unenrollment audit. Lives on the student row (not the
     *  per-year packet) so the audit follows the student across
     *  any re-enrollment attempts in future years. The Unenroll
     *  modal on the detail page captures all four together;
     *  re-enrolling clears all four together. */
    isArchived: s.isArchived === true,
    unenrollment_reason: s.unenrollment_reason ?? "",
    unenrollment_date: s.unenrollment_date ?? null,
    unenrollment_notes: s.unenrollment_notes ?? "",
    /** Admin-only initial-screening NWEA scores + dates. Canonical
     *  copy lives on the student row (not the per-year application)
     *  since RIT scores follow the student across re-enrollment.
     *  Surfaced here so the enrolled detail page's Testing card
     *  reads the same source the apply-flow `TestingBlock` writes.
     *  Application row also carries these columns but they're being
     *  phased out — student row is the source of truth. */
    initial_screening_nwea_math: s.initial_screening_nwea_math ?? null,
    initial_screening_nwea_reading:
      s.initial_screening_nwea_reading ?? null,
    initial_screening_nwea_math_date:
      s.initial_screening_nwea_math_date ?? null,
    initial_screening_nwea_reading_date:
      s.initial_screening_nwea_reading_date ?? null,
    /** Per-document admin-confirm audit for the four required
     *  documents (immunization / birth certificate / school
     *  health / transcripts). Bool + audit timestamp + audit
     *  admin name. Surfaced here so the Documents to Review
     *  table on the enrolled detail page can render the
     *  same audit captions ("Confirmed by Mr. Thompson · 4d")
     *  the family registration detail page renders. */
    document_confirms: {
      birth_certificate: {
        confirmed: s.birth_certificate_admin_confirm === true,
        confirmed_time: s.birth_certificate_admin_confirm_time ?? null,
        confirmed_admin: s.birth_certificate_admin_confirm_admin ?? "",
      },
      school_health_form: {
        confirmed: s.school_health_form_admin_confirm === true,
        confirmed_time: s.school_health_form_admin_confirm_time ?? null,
        confirmed_admin: s.school_health_form_admin_confirm_admin ?? "",
      },
      transcripts: {
        confirmed: s.transcripts_admin_confirm === true,
        confirmed_time: s.transcripts_admin_confirm_time ?? null,
        confirmed_admin: s.transcripts_admin_confirm_admin ?? "",
      },
      immunization_forms: {
        confirmed: s.immunization_admin_confirm === true,
        confirmed_time: s.immunization_admin_confirm_time ?? null,
        confirmed_admin: s.immunization_admin_confirm_admin ?? "",
      },
    },
  };
}

/**
 * Coerce Xano's file column into an array of file blobs. Xano
 * historically wavered between `[]`, `null`, and `{}` for empty
 * file columns — the live schema uses `[]`, but we tolerate the
 * old shapes so a partial migration doesn't crash the page. Any
 * non-array value (including a single object) is normalized to
 * `[]` and a warning is logged so we can spot stragglers.
 */
function normalizeFileArray(raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw)) {
    return raw.filter(
      (entry): entry is Record<string, unknown> =>
        typeof entry === "object" && entry !== null
    );
  }
  return [];
}

function shapeApp(a: XanoApplication) {
  return {
    id: a.id,
    current_grade: a.current_grade ?? "",
    last_grade_completed: a.last_grade_completed ?? "",
    current_previous_school: a.current_previous_school ?? "",
    sufs_type: a.sufs_type ?? "",
    sufs_status: a.sufs_status ?? "",
    is_bus_transportation: a.is_bus_transportation === true,
    bus_stop: a.bus_stop ?? "",
    nwea_testing_complete: a.nwea_testing_complete === true,
    nwea_testing_scheduled: a.nwea_testing_scheduled === true,
    initial_screening_nwea_math: a.initial_screening_nwea_math ?? null,
    initial_screening_nwea_reading: a.initial_screening_nwea_reading ?? null,
    initial_screening_nwea_math_date:
      a.initial_screening_nwea_math_date ?? null,
    initial_screening_nwea_reading_date:
      a.initial_screening_nwea_reading_date ?? null,
  };
}

function shapePacket(p: XanoStudentRegistration) {
  return {
    id: p.id,
    registrationConfirmed: p.registrationConfirmed === true,
    /** Audit pair on `registrationConfirmed` — surfaced on the page so
     *  admin sees "Confirmed by Mr. Thompson · Oct 28" next to the
     *  badge. */
    registration_confirmed_admin_time:
      p.registration_confirmed_admin_time ?? null,
    registration_confirmed_admin_name:
      p.is_registration_admin_confirm_admin ?? "",
    /** Last write to the packet row. Surfaced alongside the student's
     *  `last_edited_time` in the page header so admin can spot stale
     *  packet data (parent edited bio recently but never updated the
     *  packet, etc.). */
    last_edited_time: p.last_edited_time ?? p.last_updated ?? null,
    shirt_size: p.shirt_size ?? "",
    pant_size: p.pant_size ?? "",
    swim_level: p.swim_level ?? "",
    allergies: p.allergies ?? "",
    iep_description: p.iep_description ?? "",
    dietary_restrictions: p.dietary_restrictions ?? "",
    prescription_medications: p.prescription_medications ?? "",
    health_conditions: p.health_conditions ?? "",
    vision_impairments: p.vision_impairments ?? "",
    hearing_impairments: p.hearing_impairments ?? "",
    is_student_on_medicaid: p.is_student_on_medicaid === true,
    medicaid_number: p.medicaid_number ?? 0,
    medicaid_provider: p.medicaid_provider ?? "",
    carry_epi_pen: p.carry_epi_pen === true,
    epipen_explainer: p.epipen_explainer ?? "",
    permission_for_acetaminophen: p.permission_for_acetaminophen ?? "",
    additional_health_information: p.additional_health_information ?? "",
    interested_in_counseling_services:
      p.interested_in_counseling_services ?? "",
    other_adults_approved_for_pickup:
      p.other_adults_approved_for_pickup ?? "",
    prohibited_adults: p.prohibited_adults ?? "",
    // File metadata — shape matches Xano's `{ path, url, mime, size }`.
    birth_certificate: p.birth_certificate ?? null,
    school_health_form: p.school_health_form ?? null,
    transcripts: p.transcripts ?? null,
    iep: p.iep ?? null,
    ssn_card: p.ssn_card ?? null,
    immunization_forms: p.immunization_forms ?? null,
    passport: p.passport ?? null,
    immunization_form: p.immunization_form ?? null,
    student_state_id: p.student_state_id ?? null,
    liability_waiver_pandadoc_id: p.liability_waiver_pandadoc_id ?? "",
    liability_waiver_status: p.liability_waiver_status ?? "",
    liability_waiver_sent_at: p.liability_waiver_sent_at ?? null,
    liability_waiver_pdf_url: p.liability_waiver_pdf_url ?? "",
  };
}

function shapeParent(p: XanoParent) {
  return {
    id: p.id,
    first_name: p.first_name ?? "",
    last_name: p.last_name ?? "",
    email: p.email ?? "",
    phone: p.phone ?? "",
    relationship: p.relationship ?? "",
  };
}

/**
 * Response shape returned by `GET /api/admin/enrolled/[id]`. Narrow
 * on purpose — only fields the student detail page needs are
 * surfaced. If a future admin surface needs a wider slice (e.g.
 * the full medical history form), extend the relevant `shape*`
 * helper above and update this type alongside.
 */
export interface AdminEnrolledStudentResponse {
  student: ReturnType<typeof shapeStudent>;
  app: ReturnType<typeof shapeApp> | null;
  packet: ReturnType<typeof shapePacket> | null;
  family: { id: number; family_name: string } | null;
  /** Lowest-id parent — kept on the response for the page header
   *  subtitle that's been there since the page was first built. */
  primary: ReturnType<typeof shapeParent> | null;
  /** Every parent on the family, lowest-id first. Surfaced so the
   *  Family Information card on the detail page can render the
   *  full contact roster rather than just the primary. */
  parents: Array<ReturnType<typeof shapeParent>>;
  /** Family-evergreen emergency contacts. Not student- or year-
   *  scoped — every family has a single set that any of their
   *  students' detail pages can render. */
  emergency_contacts: import("@/lib/xano").XanoEmergencyContact[];
  school_year: { id: number; year_name: string } | null;
}

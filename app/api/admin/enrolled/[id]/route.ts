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

    // Family + primary parent — same lowest-id-wins rule the other
    // admin endpoints use so the displayed contact is consistent
    // across surfaces.
    const familyId = app ? Number(app.registration_families_id) : null;
    const family =
      familyId != null
        ? families.find((f) => f.id === familyId) ?? null
        : null;
    const parentIds = family ? xano.families.getParentIds(family) : [];
    const primary =
      parentIds.length > 0
        ? parents
            .filter((p) => parentIds.includes(p.id))
            .sort((a, b) => a.id - b.id)[0] ?? null
        : null;

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
  };
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
  primary: ReturnType<typeof shapeParent> | null;
  school_year: { id: number; year_name: string } | null;
}

import { getFamilyAuth } from "@/lib/family-auth";
import { NextRequest, NextResponse } from "next/server";
import { xano } from "@/lib/xano";

/**
 * Add a new student to an already-enrolled (non-residential) family's
 * year — a sibling joining mid-year. Backs the enrolled-family
 * dashboard's "Add Student" button.
 *
 * Creates the student + ONE marked application (`is_midyear_addition`)
 * so the parent can work through that student's application (details,
 * Financial Aid, NWEA) at `/dashboard/add-student/[applicationId]` and
 * submit it for admissions review — WITHOUT touching the family's
 * already-accepted, already-enrolled progress rows. Unlike the
 * residential flow (`/api/residential-students`) nothing is
 * auto-accepted and the student is NOT marked enrolled: admin accepts
 * this one student, the parent completes registration + tuition, and
 * the packet confirm is what enrolls them.
 *
 * Isolation (see `lib/midyear-additions.ts`):
 *   - The application is NOT appended to the family's
 *     `registration_family_application_progress` row; its
 *     isSubmitted / isAccepted latches stay as they are.
 *   - The family-level rollups skip the marked application until its
 *     packet is confirmed, so the family keeps its enrolled dashboard.
 *
 * Body: { first_name, last_name, date_of_birth?, gender?, ethnicity?, yearId }
 * Returns: { student, application }
 */
export async function POST(req: NextRequest) {
  const session = await getFamilyAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { familyId } = session;
  if (!familyId) {
    return NextResponse.json(
      { error: "You must create a family first" },
      { status: 400 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const first_name =
    typeof body?.first_name === "string" ? body.first_name.trim() : "";
  const last_name =
    typeof body?.last_name === "string" ? body.last_name.trim() : "";
  const date_of_birth =
    typeof body?.date_of_birth === "string" && body.date_of_birth
      ? body.date_of_birth
      : null;
  const gender = typeof body?.gender === "string" ? body.gender : "";
  const ethnicity = typeof body?.ethnicity === "string" ? body.ethnicity : "";
  const yearId = Number(body?.yearId);

  if (!first_name || !last_name) {
    return NextResponse.json(
      { error: "first_name and last_name are required" },
      { status: 400 }
    );
  }
  if (!Number.isFinite(yearId) || yearId <= 0) {
    return NextResponse.json({ error: "yearId is required" }, { status: 400 });
  }

  const family = await xano.families.getById(familyId);
  // Residential families add placements through their own flow (no
  // review, no tuition) — keep the two from crossing.
  if (family.is_residential === true) {
    return NextResponse.json(
      { error: "Residential families add students through Create New Registration." },
      { status: 400 }
    );
  }

  // Only a family admin already accepted for this year can add a
  // student mid-year; anyone still applying adds students on the
  // apply flow's Students step instead.
  const progress = await xano.familyApplicationProgress.getByFamilyAndYear(
    familyId,
    yearId
  );
  if (progress?.isAccepted !== true) {
    return NextResponse.json(
      {
        error:
          "Your family isn't enrolled for this school year yet — add students on your application instead.",
      },
      { status: 409 }
    );
  }

  const draftStatus =
    (await xano.applicationStatuses.findByName("Draft")) ??
    (await xano.applicationStatuses.findByName("Application Draft"));
  if (!draftStatus) {
    return NextResponse.json(
      {
        error:
          "Application status 'Draft' or 'Application Draft' not found. Please seed statuses in Xano.",
      },
      { status: 500 }
    );
  }

  // 1. Create the student + link to the family.
  const student = await xano.students.create({
    first_name,
    last_name,
    date_of_birth,
    gender,
    ethnicity,
    photo: null,
    registration_families_id: familyId,
    registration_school_years_id: [yearId],
    isArchived: false,
    isAccepted: false,
    registration_student_registration_id: [],
    birth_certificate: [],
    school_health_form: [],
    transcripts: [],
    immunization_forms: [],
    passport: [],
    student_state_id: [],
    iep: [],
    ssn_card: [],
    discipline: [],
    student_phone: "",
  });

  const existingStudentIds = xano.families.getStudentIds(family);
  if (!existingStudentIds.includes(student.id)) {
    await xano.families.update(familyId, {
      registration_students_id: [...existingStudentIds, student.id],
    });
  }

  // 2. Open the marked application for the year — the standard
  //    `/api/applications` POST shape plus the mid-year marker.
  const application = await xano.applications.create({
    registration_students_id: student.id,
    registration_families_id: familyId,
    registration_application_status_id: draftStatus.id,
    registration_school_years_id: yearId,
    registration_parents_id: 0,
    type: "New Enrollment",
    is_midyear_addition: true,
    addition_financial_aid_completed: false,
    addition_submitted_at: 0,
    current_previous_school: "",
    describe_student_opportunities_for_growth: "",
    describe_student_strengths: "",
    sufs_type: "",
    sufs_status: "",
    sufs_award_id: 0,
    is_bus_transportation: false,
    bus_stop: "",
    test_scores: null,
    nwea_testing_complete: false,
    nwea_testing_scheduled: false,
    last_grade_completed: "",
    current_grade: "",
    isActive: true,
    opportunity_scholarship_award_amount: null,
    enrollment_agreement_pandadoc_id: "",
    enrollment_agreement_status: "",
    enrollment_agreement_sent_at: null,
    enrollment_agreement_pdf_url: "",
  });

  // No email yet — staff hear about the student when the parent
  // submits the application, not while it's still a draft.
  return NextResponse.json({ student, application }, { status: 201 });
}

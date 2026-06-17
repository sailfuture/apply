import { auth, currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { xano } from "@/lib/xano";

/**
 * Create a brand-new student for a residential / foster family and open
 * a fresh application for the given school year, mid-cycle.
 *
 * Residential families (`registration_families.is_residential = true`)
 * take foster placements that enroll and unenroll throughout the year.
 * This endpoint backs the "Create New Registration" affordance on the
 * enrolled-family dashboard: it spins up the student + a marked
 * application so the parent can walk the new student through the normal
 * application → admin-accept → registration pipeline WITHOUT disturbing
 * the family's already-submitted, already-enrolled state for the year.
 *
 * Isolation choices vs. the standard `/api/applications` POST:
 *   - The application is flagged `is_residential_addition = true` so the
 *     family-level "is everyone enrolled?" rollups can ignore it until
 *     this student is individually confirmed. Otherwise a fresh,
 *     unconfirmed packet would bounce the family out of their enrolled
 *     dashboard (those rollups require EVERY packet confirmed).
 *   - We deliberately do NOT append the new app to the family's
 *     `registration_family_application_progress` row — that row tracks
 *     the family's original cohort for the year and its `isSubmitted` /
 *     `isAccepted` latches must stay untouched. Admin reviews + accepts
 *     this student per-application via `/api/admin/applications/[id]`.
 *
 * Body: { first_name, last_name, date_of_birth?, gender?, ethnicity?, yearId }
 * Returns: { student, application }
 */
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const familyId = user.publicMetadata.registration_families_id as
    | number
    | undefined;
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

  // Defense-in-depth: only residential families may use this flow. The
  // dashboard gates the button on `is_residential`, but enforce it here
  // too so a non-residential family can't POST directly.
  const family = await xano.families.getById(familyId);
  if (family.is_residential !== true) {
    return NextResponse.json(
      { error: "This family is not enabled for mid-year registrations." },
      { status: 403 }
    );
  }

  // Draft status — same lookup the standard application-create uses.
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

  // 2. Open the marked application for the year. Mirrors the standard
  //    `/api/applications` POST shape, plus the residential marker and a
  //    "New Enrollment" type.
  const application = await xano.applications.create({
    registration_students_id: student.id,
    registration_families_id: familyId,
    registration_application_status_id: draftStatus.id,
    registration_school_years_id: yearId,
    registration_parents_id: 0,
    type: "New Enrollment",
    is_residential_addition: true,
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
    isSubmitted: false,
    isOffered: false,
    isAccepted: false,
    isActive: true,
    opportunity_scholarship_award_amount: null,
    enrollment_agreement_pandadoc_id: "",
    enrollment_agreement_status: "",
    enrollment_agreement_sent_at: null,
    enrollment_agreement_pdf_url: "",
  });

  return NextResponse.json({ student, application }, { status: 201 });
}

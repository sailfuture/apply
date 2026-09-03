import { getFamilyAuth } from "@/lib/family-auth";
import { NextRequest, NextResponse } from "next/server";
import { xano } from "@/lib/xano";
import { sendEmail } from "@/lib/emails/send";
import { residentialStudentAdded } from "@/lib/emails/templates";
import { parseResidentialHouse } from "@/lib/residential";

/**
 * Create a brand-new student for a residential / foster family and open
 * a fresh application for the given school year, mid-cycle.
 *
 * Residential families (`registration_families.is_residential = true`)
 * take foster placements that enroll and unenroll throughout the year.
 * This endpoint backs the "Create New Registration" affordance on the
 * enrolled-family dashboard: it spins up the student + a marked
 * application so the parent can complete the student's details and go
 * straight into a registration packet (no admissions-review queue — see
 * `/api/residential-students/[applicationId]`) WITHOUT disturbing the
 * family's already-submitted, already-enrolled state for the year.
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
 *     `isAccepted` latches must stay untouched. The application is
 *     auto-accepted at submit; admin's per-student gate is confirming
 *     the completed packet (`registrationConfirmed`).
 *
 * Body: { first_name, last_name, date_of_birth?, gender?, ethnicity?,
 *         residential_house?, yearId }
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
  // Which residential home the placement lives in, chosen by the adult
  // adding them. Narrowed to a known house rather than stored raw: a
  // typo'd house silently splits every roster that groups on it. An
  // unrecognized value is treated as unset (staff assign it later on
  // the student's Placement card) rather than failing the create —
  // losing the student record over a bad string would be worse.
  const residential_house = parseResidentialHouse(body?.residential_house);
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
    residential_house: residential_house ?? "",
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

  // Xano's create endpoint writes only the inputs its own schema
  // declares, and `residential_house` was added to the table well after
  // that endpoint was built — so the value above may have been dropped
  // on the floor. Follow up with the same PATCH the admin Placement
  // card uses, but only when the create didn't already take it, so the
  // common path stays one request. Best-effort: the student and their
  // application matter more than the home, which staff can still set
  // from the Placement card.
  let studentRow = student;
  if (
    residential_house &&
    (student.residential_house ?? "").trim() !== residential_house
  ) {
    try {
      studentRow = await xano.students.update(student.id, {
        residential_house,
      });
    } catch (err) {
      console.error(
        `[/api/residential-students] could not set residential_house on student ${student.id}:`,
        err
      );
    }
  }

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
    isActive: true,
    opportunity_scholarship_award_amount: null,
    enrollment_agreement_pandadoc_id: "",
    enrollment_agreement_status: "",
    enrollment_agreement_sent_at: null,
    enrollment_agreement_pdf_url: "",
  });

  // 3. Notify staff. Foster placements arrive mid-year with no
  //    admissions queue to surface them, so without this the new
  //    student sits unnoticed until someone opens the roster.
  //    Best-effort: the student and application are already created,
  //    and a mail failure must not fail the request or the parent
  //    would retry and create a duplicate student.
  try {
    const schoolYear = await xano.schoolYears
      .getById(yearId)
      .catch(() => null);
    const appBase = (
      process.env.NEXT_PUBLIC_APP_URL ?? "https://apply.sailfutureacademy.org"
    ).replace(/\/$/, "");
    await sendEmail({
      to: [
        process.env.RESIDENTIAL_ALERTS_EMAIL ?? "admissions@sailfuture.org",
      ],
      // Explicit CC rather than the dean+admissions default: this one
      // is already addressed TO admissions, so the default list would
      // deliver them a duplicate copy.
      cc: ["dean@sailfuture.org"],
      content: residentialStudentAdded({
        student_name: `${first_name} ${last_name}`.trim(),
        student_dob: date_of_birth,
        family_name: family.family_name?.trim() || `Family #${familyId}`,
        // Picked by the adult adding the student. Still nullable —
        // a request that omitted it (or sent an unknown house) lands
        // here as "Not assigned yet" for staff to resolve.
        residential_house:
          residential_house ?? studentRow.residential_house?.trim() ?? null,
        year_name: schoolYear?.year_name?.trim() || `Year ${yearId}`,
        student_url: `${appBase}/admin/enrolled/${student.id}?yearId=${yearId}`,
      }),
      tag: "residential-student-added",
      familyId,
      yearId,
    });
  } catch (err) {
    console.error(
      `[/api/residential-students] staff notification failed for student ${student.id}:`,
      err
    );
  }

  return NextResponse.json(
    { student: studentRow, application },
    { status: 201 }
  );
}

import { auth, currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { xano } from "@/lib/xano";

export async function GET(req: NextRequest) {
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
    return NextResponse.json([], { status: 200 });
  }

  const studentId = req.nextUrl.searchParams.get("studentId");
  const apps = await xano.applications.getByFamilyId(familyId);

  if (studentId) {
    const filtered = apps.filter(
      (a) => a.registration_students_id === Number(studentId)
    );
    return NextResponse.json(filtered, { status: 200 });
  }

  return NextResponse.json(apps, { status: 200 });
}

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

  const { registration_students_id, registration_school_years_id } =
    await req.json();

  if (!registration_students_id || !registration_school_years_id) {
    return NextResponse.json(
      { error: "student and school year are required" },
      { status: 400 }
    );
  }

  const existing = await xano.applications.getByStudentAndYear(
    registration_students_id,
    registration_school_years_id
  );
  if (existing) {
    return NextResponse.json(existing, { status: 200 });
  }

  const draftStatus =
    (await xano.applicationStatuses.findByName("Draft")) ??
    (await xano.applicationStatuses.findByName("Application Draft"));
  if (!draftStatus) {
    return NextResponse.json(
      { error: "Application status 'Draft' or 'Application Draft' not found. Please seed statuses in Xano." },
      { status: 500 }
    );
  }

  const application = await xano.applications.create({
    registration_students_id,
    registration_families_id: familyId,
    registration_application_status_id: draftStatus.id,
    registration_school_years_id,
    registration_parents_id: 0,
    type: "",
    liability_waiver_pandadoc_id: null,
    liability_waiver_status: null,
    liability_waiver_sent_at: null,
    enrollment_agreement_pandadoc_id: null,
    enrollment_agreement_status: null,
    enrollment_agreement_sent_at: null,
    liability_waiver_pdf_url: null,
    enrollment_agreement_pdf_url: null,
    sufs_award_id: 0,
    is_bus_transportation: false,
    bus_stop: "",
    current_previous_school: "",
    describe_student_strengths: "",
    describe_student_opportunities_for_growth: "",
    last_grade_completed: "",
    current_grade: "",
    nwea_testing_complete: false,
    test_scores: null,
  });

  try {
    const student = await xano.students.getById(registration_students_id);
    const yearIds = student.registration_school_years_id ?? [];
    if (!yearIds.includes(registration_school_years_id)) {
      await xano.students.update(registration_students_id, {
        registration_school_years_id: [...yearIds, registration_school_years_id],
      });
    }
  } catch (err) {
    console.error("Failed to update student school year list:", err);
  }

  return NextResponse.json(application, { status: 201 });
}

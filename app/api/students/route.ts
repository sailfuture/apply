import { getFamilyAuth } from "@/lib/family-auth";
import { NextRequest, NextResponse } from "next/server";
import { xano } from "@/lib/xano";

export async function GET() {
  const session = await getFamilyAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { familyId } = session;

  if (!familyId) {
    return NextResponse.json([], { status: 200 });
  }

  let students;
  try {
    students = await xano.students.getByFamilyId(familyId);
  } catch (err) {
    // 503 (not an unhandled 500) so SWR's error-retry treats it as
    // transient and recovers without a hard reload.
    console.error(`Student lookup failed for family ${familyId}:`, err);
    return NextResponse.json(
      { error: "Student lookup failed, please retry" },
      { status: 503 }
    );
  }
  // Strip large photo data from list response to reduce payload size.
  // Keep only the URL if photo is a Xano file object, otherwise null.
  const trimmed = students.map((s) => {
    let photo: string | { url: string } | null = null;
    if (s.photo && typeof s.photo === "object" && (s.photo as { url?: string }).url) {
      photo = { url: (s.photo as { url: string }).url };
    } else if (typeof s.photo === "string" && s.photo.startsWith("http")) {
      photo = s.photo;
    }
    // Drop base64 photo strings — too large for list responses
    return { ...s, photo };
  });
  return NextResponse.json(trimmed, { status: 200 });
}

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

  const { first_name, last_name, date_of_birth, gender, ethnicity, student_phone } =
    await req.json();

  if (!first_name || !last_name) {
    return NextResponse.json(
      { error: "first_name and last_name are required" },
      { status: 400 }
    );
  }

  const student = await xano.students.create({
    first_name,
    last_name,
    date_of_birth: date_of_birth || null,
    gender: gender || "",
    ethnicity: ethnicity || "",
    student_phone: student_phone || "",
    photo: null,
    registration_families_id: familyId,
    registration_school_years_id: [],
    isArchived: false,
    isAccepted: false,
    // Packet ID list — appended to by /api/student-registration when a new
    // registration_student_registration row is created for this student.
    registration_student_registration_id: [],
    // Document arrays — start empty; parents populate them on /registration.
    birth_certificate: [],
    school_health_form: [],
    transcripts: [],
    immunization_forms: [],
    passport: [],
    student_state_id: [],
    iep: [],
    ssn_card: [],
    discipline: [],
  });

  const family = await xano.families.getById(familyId);
  const existingStudentIds = xano.families.getStudentIds(family);
  await xano.families.update(familyId, {
    registration_students_id: [...existingStudentIds, student.id],
  });

  return NextResponse.json(student, { status: 201 });
}

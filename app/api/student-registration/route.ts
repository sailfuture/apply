import { auth, currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { xano } from "@/lib/xano";

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const familyId = user.publicMetadata.registration_families_id as number | undefined;
  if (!familyId) return NextResponse.json([], { status: 200 });

  const url = new URL(req.url);
  const studentId = url.searchParams.get("studentId");

  if (studentId) {
    const reg = await xano.studentRegistration.getByStudentId(Number(studentId));
    return NextResponse.json(reg, { status: 200 });
  }

  // Return all registrations for students in this family
  const students = await xano.students.getByFamilyId(familyId);
  const registrations = await Promise.all(
    students.map((s) => xano.studentRegistration.getByStudentId(s.id))
  );

  return NextResponse.json(
    registrations.filter(Boolean),
    { status: 200 }
  );
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const familyId = user.publicMetadata.registration_families_id as number | undefined;
  if (!familyId) return NextResponse.json({ error: "No family found" }, { status: 400 });

  const body = await req.json();

  // Verify the student belongs to this family
  const students = await xano.students.getByFamilyId(familyId);
  const studentIds = students.map((s) => s.id);
  if (!studentIds.includes(body.registration_students_id)) {
    return NextResponse.json({ error: "Student not found in family" }, { status: 403 });
  }

  const registration = await xano.studentRegistration.create({
    registration_students_id: body.registration_students_id,
    shirt_size: body.shirt_size ?? "",
    pant_size: body.pant_size ?? "",
    swim_level: body.swim_level ?? "",
    birth_certificate: body.birth_certificate ?? {},
    school_health_form: body.school_health_form ?? {},
    transcripts: body.transcripts ?? {},
    iep: body.iep ?? {},
    ssn_card: body.ssn_card ?? {},
    immunization_forms: body.immunization_forms ?? {},
    passport: body.passport ?? {},
    immunization_form: body.immunization_form ?? {},
    student_state_id: body.student_state_id ?? {},
    allergies: body.allergies ?? "",
    iep_description: body.iep_description ?? "",
    dietary_restrictions: body.dietary_restrictions ?? "",
    prescription_medications: body.prescription_medications ?? "",
    health_conditions: body.health_conditions ?? "",
    vision_impairments: body.vision_impairments ?? "",
    hearing_impairments: body.hearing_impairments ?? "",
    is_student_on_medicaid: body.is_student_on_medicaid ?? false,
    medicaid_number: body.medicaid_number ?? 0,
    medicaid_provider: body.medicaid_provider ?? "",
    carry_epi_pen: body.carry_epi_pen ?? false,
    epipen_explainer: body.epipen_explainer ?? "",
    permission_for_acetaminophen: body.permission_for_acetaminophen ?? "",
    additional_health_information: body.additional_health_information ?? "",
    interested_in_counseling_services: body.interested_in_counseling_services ?? "",
    other_adults_approved_for_pickup: body.other_adults_approved_for_pickup ?? "",
    prohibited_adults: body.prohibited_adults ?? "",
    liability_waiver_pandadoc_id: body.liability_waiver_pandadoc_id ?? "",
    liability_waiver_status: body.liability_waiver_status ?? "",
    liability_wavier_sent_at: body.liability_wavier_sent_at ?? null,
    liability_waiver_pdf_url: body.liability_waiver_pdf_url ?? "",
  });

  return NextResponse.json(registration, { status: 201 });
}

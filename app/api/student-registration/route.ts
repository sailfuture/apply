import { getFamilyAuth } from "@/lib/family-auth";
import { NextRequest, NextResponse } from "next/server";
import { xano } from "@/lib/xano";
import { redactAdminSufs } from "@/lib/student-registration-redact";

export async function GET(req: NextRequest) {
  const session = await getFamilyAuth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { familyId } = session;
  if (!familyId) return NextResponse.json([], { status: 200 });

  const url = new URL(req.url);
  const studentId = url.searchParams.get("studentId");
  const yearIdParam = url.searchParams.get("yearId");

  if (studentId) {
    const reg = await xano.studentRegistration.getByStudentId(Number(studentId));
    return NextResponse.json(redactAdminSufs(reg), { status: 200 });
  }

  const students = await xano.students.getByFamilyId(familyId);

  if (yearIdParam) {
    // Return every packet in this family for the requested year. Used by
    // the pending-confirmation view to check whether every student has
    // been admin-confirmed yet.
    const yearId = Number(yearIdParam);
    if (!Number.isFinite(yearId)) {
      return NextResponse.json({ error: "yearId must be a number" }, { status: 400 });
    }
    const packets = await Promise.all(
      students.map((s) => xano.studentRegistration.getByStudentId(s.id))
    );
    return NextResponse.json(
      packets
        .filter(
          (p): p is NonNullable<typeof p> =>
            !!p && Number(p.registration_school_years_id) === yearId
        )
        .map(redactAdminSufs),
      { status: 200 }
    );
  }

  // Return all registrations for students in this family (legacy callers).
  const registrations = await Promise.all(
    students.map((s) => xano.studentRegistration.getByStudentId(s.id))
  );

  return NextResponse.json(
    registrations.filter(Boolean).map(redactAdminSufs),
    { status: 200 }
  );
}

export async function POST(req: NextRequest) {
  const session = await getFamilyAuth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { familyId } = session;
  if (!familyId) return NextResponse.json({ error: "No family found" }, { status: 400 });

  const body = await req.json();

  // Verify the student belongs to this family
  const students = await xano.students.getByFamilyId(familyId);
  const studentIds = students.map((s) => s.id);
  if (!studentIds.includes(body.registration_students_id)) {
    return NextResponse.json({ error: "Student not found in family" }, { status: 403 });
  }

  // Year + type are required — the packet is scoped per (student, year), and
  // `registration_type_id` drives which enrollment/waiver templates and form
  // variants are used this cycle.
  const schoolYearId = Number(body.registration_school_years_id);
  const typeId = Number(body.registration_type_id);
  if (!Number.isFinite(schoolYearId) || schoolYearId <= 0) {
    return NextResponse.json(
      { error: "registration_school_years_id is required" },
      { status: 400 }
    );
  }
  if (!Number.isFinite(typeId) || typeId <= 0) {
    return NextResponse.json(
      { error: "registration_type_id is required" },
      { status: 400 }
    );
  }

  // Xano types medicaid_number as a number; coerce empty strings to 0
  // otherwise Xano rejects the whole payload and the client swallows the 4xx.
  const medicaidNumber = Number(body.medicaid_number);

  // Pull the current student so we can append the newly-created packet
  // ID onto its `registration_student_registration_id` array below.
  const studentRow = students.find((s) => s.id === body.registration_students_id);

  const registration = await xano.studentRegistration.create({
    registration_students_id: body.registration_students_id,
    registration_school_years_id: schoolYearId,
    registration_type_id: typeId,
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
    medicaid_number: Number.isFinite(medicaidNumber) ? medicaidNumber : 0,
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
    liability_waiver_sent_at: body.liability_waiver_sent_at ?? null,
    liability_waiver_pdf_url: body.liability_waiver_pdf_url ?? "",
    // Admin confirms each student once they've reviewed the packet. Starts
    // false on every new packet.
    registrationConfirmed: false,
  });

  // Append the new packet ID to the student's
  // `registration_student_registration_id` array so a student who
  // re-enrolls in later years accumulates a list of packet IDs across
  // all years. Failures here are logged but don't block the packet
  // response — the row itself is saved.
  if (studentRow) {
    const existingPacketIds: number[] = Array.isArray(
      (studentRow as unknown as { registration_student_registration_id?: number[] })
        .registration_student_registration_id
    )
      ? ((studentRow as unknown as { registration_student_registration_id: number[] })
          .registration_student_registration_id)
      : [];
    if (!existingPacketIds.includes(registration.id)) {
      try {
        await xano.students.update(body.registration_students_id, {
          registration_student_registration_id: [
            ...existingPacketIds,
            registration.id,
          ],
        });
      } catch (err) {
        console.error(
          `Failed to append packet ${registration.id} to student ${body.registration_students_id}:`,
          err
        );
      }
    }
  }

  // Xano's create echoes the full row (SUFS columns at their defaults)
  // — redact for symmetry with the GET/PATCH responses so no parent
  // path ever carries the admin-only fields.
  return NextResponse.json(redactAdminSufs(registration), { status: 201 });
}

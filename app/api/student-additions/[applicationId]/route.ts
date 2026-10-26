import { getFamilyAuth } from "@/lib/family-auth";
import { NextRequest, NextResponse } from "next/server";
import {
  xano,
  type XanoApplication,
  type XanoStudentRegistration,
} from "@/lib/xano";
import { sendEmail } from "@/lib/emails/send";
import { studentAdditionSubmitted } from "@/lib/emails/templates";
import {
  sendAdditionReceivedEmail,
  sendAdditionRegistrationReceivedEmail,
} from "@/lib/emails/triggers";
import {
  additionAgreementSigned,
  additionRegistrationSubmitted,
  additionTuitionSigned,
  additionWaiverSigned,
} from "@/lib/midyear-additions";

/**
 * Step transitions for a mid-year sibling addition (see
 * `/api/student-additions`). The parent's field saves still go through
 * the standard `/api/applications/[id]` PATCH allowlist; this route
 * owns only the addition's own state columns, so they never join that
 * general allowlist:
 *
 *   { financialAidCompleted: boolean }
 *     Marks this student's Financial Aid step done / reopened. Lives on
 *     the application row — the family-level `financial_aid_completed`
 *     flag is deliberately untouched, since flipping it clears the
 *     admin verifies for the whole (already-enrolled) family.
 *
 *   { submit: true }
 *     Submits the student for admissions review: stamps
 *     `addition_submitted_at`, emails the parents ("we received your
 *     application") and admissions. Idempotent — a second submit
 *     returns ok without re-sending.
 *
 * Scoped tightly: the application must belong to the authenticated
 * parent's family AND carry `is_midyear_addition`.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ applicationId: string }> }
) {
  const session = await getFamilyAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const familyId = session.familyId ?? 0;
  if (!familyId) {
    return NextResponse.json({ error: "No family found" }, { status: 400 });
  }

  const { applicationId } = await params;
  const appId = Number(applicationId);
  if (!Number.isFinite(appId) || appId <= 0) {
    return NextResponse.json(
      { error: "Invalid application id" },
      { status: 400 }
    );
  }

  const familyApps = await xano.applications.getByFamilyId(familyId);
  const app = familyApps.find((a) => a.id === appId);
  if (!app) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (app.is_midyear_addition !== true) {
    return NextResponse.json(
      { error: "Not a mid-year addition" },
      { status: 400 }
    );
  }
  const submittedAt = app.addition_submitted_at ?? 0;

  const body = await req.json().catch(() => ({}));

  if (typeof body?.financialAidCompleted === "boolean") {
    if (submittedAt > 0) {
      return NextResponse.json(
        { error: "This application was already submitted." },
        { status: 409 }
      );
    }
    const updated = await xano.applications.update(appId, {
      addition_financial_aid_completed: body.financialAidCompleted,
    });
    return NextResponse.json(updated, { status: 200 });
  }

  // ── Registration stage (after admissions accepted the student) ──────
  if (body?.tuitionSignature || body?.submitRegistration === true) {
    return registrationStep(app, familyId, body);
  }

  if (body?.submit !== true) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }
  if (submittedAt > 0) {
    return NextResponse.json(app, { status: 200 });
  }

  // Server-side completeness check — the page gates the button on the
  // same rules, this closes the direct-POST gap.
  const filled = (v: unknown) => typeof v === "string" && v.trim().length > 0;
  const missing: string[] = [];
  if (!filled(app.current_previous_school)) missing.push("current / previous school");
  if (!filled(app.last_grade_completed)) missing.push("current grade");
  if (!filled(app.current_grade)) missing.push("incoming grade");
  if (!filled(app.describe_student_strengths)) missing.push("strengths");
  if (!filled(app.describe_student_opportunities_for_growth)) {
    missing.push("opportunities for growth");
  }
  if (app.is_bus_transportation && !filled(app.bus_stop)) missing.push("bus stop");
  if (app.addition_financial_aid_completed !== true) missing.push("financial aid");
  if (!(app.nwea_testing_scheduled || app.nwea_testing_complete)) {
    missing.push("NWEA testing");
  }
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Please complete: ${missing.join(", ")}.` },
      { status: 400 }
    );
  }

  const updated = await xano.applications.update(appId, {
    addition_submitted_at: Date.now(),
  });

  // Notifications are best-effort: the submit already landed, and a
  // mail failure must not make the parent retry.
  const studentId = Number(app.registration_students_id);
  const yearId = Number(app.registration_school_years_id);
  try {
    const [student, family, schoolYear] = await Promise.all([
      xano.students.getById(studentId),
      xano.families.getById(familyId),
      xano.schoolYears.getById(yearId).catch(() => null),
    ]);
    const appBase = (
      process.env.NEXT_PUBLIC_APP_URL ?? "https://apply.sailfutureacademy.org"
    ).replace(/\/$/, "");
    await Promise.all([
      sendAdditionReceivedEmail(familyId, yearId, student.first_name ?? ""),
      sendEmail({
        to: [process.env.ADMISSIONS_ALERTS_EMAIL ?? "admissions@sailfuture.org"],
        // Explicit CC rather than the dean+admissions default: this one
        // is already addressed TO admissions.
        cc: ["dean@sailfuture.org"],
        content: studentAdditionSubmitted({
          student_name:
            `${student.first_name ?? ""} ${student.last_name ?? ""}`.trim(),
          student_dob: student.date_of_birth ?? null,
          incoming_grade: app.current_grade ?? "",
          family_name: family.family_name?.trim() || `Family #${familyId}`,
          year_name: schoolYear?.year_name?.trim() || `Year ${yearId}`,
          family_url: `${appBase}/admin/families/${familyId}?yearId=${yearId}`,
        }),
        tag: "student-addition-submitted",
        familyId,
        yearId,
      }),
    ]);
  } catch (err) {
    console.error(
      `[/api/student-additions/${appId}] submit notifications failed:`,
      err
    );
  }

  return NextResponse.json(updated, { status: 200 });
}

/**
 * The accepted sibling's registration, all on their packet (it exists
 * once admissions accepts — never created here):
 *
 *   { tuitionSignature: { signature: string, name: string } }
 *     Signs this student's tuition + scholarship amounts. `signature` is
 *     the uploaded signature image's metadata (JSON), like the family's
 *     `signature_data`. Once signed it stays signed.
 *
 *   { submitRegistration: true }
 *     The packet form saved and the parent submits: requires the tuition
 *     signature, the student's enrollment agreement and liability waiver
 *     (both PandaDoc-completed) and the packet's required answers.
 *     Stamps `addition_registration_submitted_at` and emails the parents
 *     + admissions, who confirm the packet on the Registrations page.
 */
async function registrationStep(
  app: XanoApplication,
  familyId: number,
  body: {
    tuitionSignature?: { signature?: unknown; name?: unknown };
    submitRegistration?: boolean;
  }
) {
  const studentId = Number(app.registration_students_id);
  const yearId = Number(app.registration_school_years_id);
  const packet = await xano.studentRegistration.getByStudentAndYear(
    studentId,
    yearId
  );
  if (!packet) {
    return NextResponse.json(
      { error: "This student's registration opens once admissions accepts them." },
      { status: 409 }
    );
  }
  if (packet.registrationConfirmed === true) {
    return NextResponse.json(
      { error: "This student's registration is already confirmed." },
      { status: 409 }
    );
  }

  if (body.tuitionSignature) {
    if (additionTuitionSigned(packet)) {
      return NextResponse.json({ ok: true, alreadySigned: true }, { status: 200 });
    }
    const signature =
      typeof body.tuitionSignature.signature === "string"
        ? body.tuitionSignature.signature.trim()
        : "";
    const name =
      typeof body.tuitionSignature.name === "string"
        ? body.tuitionSignature.name.trim().slice(0, 200)
        : "";
    if (!signature || !name) {
      return NextResponse.json(
        { error: "Please sign and type your full name." },
        { status: 400 }
      );
    }
    if (app.confirmed_scholarship !== true) {
      return NextResponse.json(
        { error: "This student's tuition isn't final yet. Please check back soon." },
        { status: 409 }
      );
    }
    await xano.studentRegistration.update(packet.id, {
      addition_tuition_signature: signature,
      addition_tuition_signed_name: name,
      addition_tuition_signed_at: Date.now(),
    });
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  // submitRegistration
  if (additionRegistrationSubmitted(packet)) {
    return NextResponse.json({ ok: true, alreadySubmitted: true }, { status: 200 });
  }
  const missing: string[] = [];
  if (!additionTuitionSigned(packet)) missing.push("tuition signature");
  if (!additionAgreementSigned(packet)) missing.push("enrollment agreement");
  if (!additionWaiverSigned(packet)) missing.push("liability waiver");
  const packetFields: (keyof XanoStudentRegistration)[] = [
    "shirt_size",
    "pant_size",
    "swim_level",
    "allergies",
    "dietary_restrictions",
    "prescription_medications",
    "health_conditions",
    "permission_for_acetaminophen",
    "other_adults_approved_for_pickup",
    "prohibited_adults",
  ];
  if (packetFields.some((f) => !String(packet[f] ?? "").trim())) {
    missing.push("registration packet");
  }
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Please complete: ${missing.join(", ")}.` },
      { status: 400 }
    );
  }
  await xano.studentRegistration.update(packet.id, {
    addition_registration_submitted_at: Date.now(),
  });

  try {
    const [student, family, schoolYear] = await Promise.all([
      xano.students.getById(studentId),
      xano.families.getById(familyId),
      xano.schoolYears.getById(yearId).catch(() => null),
    ]);
    const appBase = (
      process.env.NEXT_PUBLIC_APP_URL ?? "https://apply.sailfutureacademy.org"
    ).replace(/\/$/, "");
    await Promise.all([
      sendAdditionRegistrationReceivedEmail(
        familyId,
        yearId,
        student.first_name ?? ""
      ),
      sendEmail({
        to: [process.env.ADMISSIONS_ALERTS_EMAIL ?? "admissions@sailfuture.org"],
        cc: ["dean@sailfuture.org"],
        content: studentAdditionSubmitted({
          stage: "registration",
          student_name:
            `${student.first_name ?? ""} ${student.last_name ?? ""}`.trim(),
          student_dob: student.date_of_birth ?? null,
          incoming_grade: app.current_grade ?? "",
          family_name: family.family_name?.trim() || `Family #${familyId}`,
          year_name: schoolYear?.year_name?.trim() || `Year ${yearId}`,
          family_url: `${appBase}/admin/registrations/${familyId}?yearId=${yearId}`,
        }),
        tag: "student-addition-registration-submitted",
        familyId,
        yearId,
      }),
    ]);
  } catch (err) {
    console.error(
      `[/api/student-additions/${app.id}] registration notifications failed:`,
      err
    );
  }
  return NextResponse.json({ ok: true }, { status: 200 });
}

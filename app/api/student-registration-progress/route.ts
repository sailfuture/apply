import { getFamilyAuth } from "@/lib/family-auth";
import { NextRequest, NextResponse } from "next/server";
import { xano } from "@/lib/xano";
import type { XanoStudentRegistrationProgress } from "@/lib/xano";
import { sendRegistrationReceivedEmail } from "@/lib/emails/triggers";
import { sendRegistrationReceivedSms } from "@/lib/sms/triggers";

/**
 * Read-or-create the registration progress row for the current Clerk user's
 * family + a school year. Creating on read guarantees every family always has
 * a row to PATCH against, so the client can send single-field updates without
 * caring whether the row exists yet.
 *
 * Family-level by design — a single row covers the whole household's
 * post-acceptance registration (tuition, enrollment signing, and the
 * registration packet step). Per-student state like waiver/agreement PandaDoc
 * status lives on `registration_application` rows.
 */
async function resolveProgress(familyId: number, yearId: number) {
  // Default the registration_type_id to whatever the family application
  // progress row already carries, so a family admin-classified as
  // "New Enrollment" on the application side keeps the same label here.
  const appProgress = await xano.familyApplicationProgress.getByFamilyAndYear(
    familyId,
    yearId
  );
  const registration_type_id = appProgress?.registration_type_id ?? 1;
  return xano.studentRegistrationProgress.resolve(
    familyId,
    yearId,
    registration_type_id
  );
}

export async function GET(req: NextRequest) {
  const session = await getFamilyAuth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { familyId } = session;
  if (!familyId) return NextResponse.json(null, { status: 200 });

  const yearIdParam = req.nextUrl.searchParams.get("yearId");
  if (!yearIdParam) {
    return NextResponse.json({ error: "yearId is required" }, { status: 400 });
  }
  const yearId = Number(yearIdParam);
  if (!Number.isFinite(yearId)) {
    return NextResponse.json({ error: "yearId must be a number" }, { status: 400 });
  }

  const row = await resolveProgress(familyId, yearId);
  return NextResponse.json(row, { status: 200 });
}

export async function PATCH(req: NextRequest) {
  const session = await getFamilyAuth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { familyId } = session;
  if (!familyId) return NextResponse.json({ error: "No family" }, { status: 400 });

  const yearIdParam = req.nextUrl.searchParams.get("yearId");
  if (!yearIdParam) {
    return NextResponse.json({ error: "yearId is required" }, { status: 400 });
  }
  const yearId = Number(yearIdParam);
  if (!Number.isFinite(yearId)) {
    return NextResponse.json({ error: "yearId must be a number" }, { status: 400 });
  }

  const body = await req.json();

  // Only whitelisted fields can be written from the client. family / year / id
  // must not be mutable.
  const allowed: Array<keyof XanoStudentRegistrationProgress> = [
    "isTuition",
    "isEnrollment",
    "isRegistration",
    "isVolunteerHours",
    "tuition_scholarship_signature",
    "signature_data_volunteer",
    "volunteer_signature_data",
    "name_volunteer",
    "enrollment_agreement_pandadoc_id",
    "enrollment_agreement_status",
    "enrollment_agreement_sent",
    "enrollment_agreement_pdf_url",
    "is_enrollment_agreement_signed",
    "signature_data",
    "name",
    "submitted_date",
    "isSubmitted",
    "registration_type_id",
  ];
  const patch: Record<string, unknown> = { last_edited: Date.now() };
  for (const key of allowed) {
    if (key in body) patch[key] = body[key];
  }

  // Auto-unconfirm cascade (Approach B): when the parent flips a
  // section's parent-completion bool, clear the matching admin
  // verify pair atomically. Admin verification represents "I've
  // reviewed the current state of this section" — if the parent
  // just unlocked + edited the section, the prior admin review is
  // stale and shouldn't survive.
  //
  // Registration packet has both a per-student rollup
  // (`registrationConfirmed`) and a family-level "I've reviewed
  // the whole packet section" pin (`is_registration_admin_confirm`).
  // The cascade clears the family-level pin so re-opening the
  // packet section invalidates the admin's section-level verify;
  // per-student `registrationConfirmed` flags stay as-is (those
  // are tracked separately on each student's packet row).
  const VERIFY_CASCADE: Array<{
    completedKey: string;
    confirmKey: string;
    timeKey: string;
    adminKey: string;
  }> = [
    {
      completedKey: "isTuition",
      confirmKey: "tuition_admin_confirm",
      timeKey: "tuition_admin_confirm_time",
      adminKey: "tuition_admin_confirm_admin",
    },
    {
      completedKey: "isEnrollment",
      confirmKey: "enrollment_admin_confirm",
      timeKey: "enrollment_admin_confirm_time",
      adminKey: "enrollment_admin_confirm_admin",
    },
    {
      completedKey: "isVolunteerHours",
      confirmKey: "volunteer_admin_confirm",
      timeKey: "volunteer_admin_confirm_time",
      adminKey: "volunteer_admin_confirm_admin",
    },
    {
      completedKey: "isRegistration",
      confirmKey: "is_registration_admin_confirm",
      timeKey: "is_registration_admin_confirm_time",
      adminKey: "registration_admin_confirmed_admin",
    },
  ];
  for (const pair of VERIFY_CASCADE) {
    if (pair.completedKey in patch) {
      patch[pair.confirmKey] = false;
      patch[pair.timeKey] = null;
      patch[pair.adminKey] = "";
    }
  }

  const row = await resolveProgress(familyId, yearId);

  // Derive `submitted_date`: once all four section bools are true, stamp
  // the current time if not already stamped. One-way latch — we don't clear
  // it if a bool later flips back. This keeps the post-enrollment dashboard
  // sticky across unlock/re-lock cycles.
  const next = { ...row, ...patch };
  const justSubmitted =
    next.isTuition === true &&
    next.isEnrollment === true &&
    next.isRegistration === true &&
    next.isVolunteerHours === true &&
    (!row.submitted_date || row.submitted_date === null);
  if (justSubmitted) {
    patch.submitted_date = Date.now();
  }

  const updated = await xano.studentRegistrationProgress.update(row.id, patch);

  // Email 3: parent just completed the registration packet. Fires
  // on the same one-way latch that stamps `submitted_date` above —
  // first PATCH that lands all four section bools true wins. Re-
  // PATCHes after submission are no-ops because `submitted_date` is
  // already populated, so the guard above is false. Best-effort
  // send: a failed email doesn't fail the parent's submission.
  if (justSubmitted) {
    sendRegistrationReceivedEmail(familyId, yearId).catch((err) => {
      console.error(
        `[/api/student-registration-progress] sendRegistrationReceivedEmail failed for family=${familyId} year=${yearId}:`,
        err
      );
    });
    sendRegistrationReceivedSms(familyId, yearId).catch((err) => {
      console.error(
        `[/api/student-registration-progress] sendRegistrationReceivedSms failed for family=${familyId} year=${yearId}:`,
        err
      );
    });
  }

  return NextResponse.json(updated, { status: 200 });
}

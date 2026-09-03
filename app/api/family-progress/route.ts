import { getFamilyAuth } from "@/lib/family-auth";
import { NextRequest, NextResponse } from "next/server";
import { xano } from "@/lib/xano";
import { sendApplicationReceivedEmail } from "@/lib/emails/triggers";
import { sendApplicationReceivedSms } from "@/lib/sms/triggers";
import { matchLeadsToFamilies } from "@/lib/lead-conversion";

/**
 * Read-or-create the progress row for the current Clerk user's family + a
 * school year. Creating on read guarantees every family always has a row to
 * PATCH against, so the client can send single-field updates without worrying
 * about whether the row exists yet.
 */
async function resolveProgress(familyId: number, yearId: number) {
  const existing = await xano.familyApplicationProgress.getByFamilyAndYear(
    familyId,
    yearId
  );
  if (existing) return existing;

  // First time this family+year is touched — default to "New Application" type.
  // Admin can reclassify later. Fallback to type_id=1 if the lookup can't find
  // a matching row (happens if types table is empty in a fresh environment).
  const newApplicationType = await xano.registrationTypes.findByName("New Application");
  const registration_type_id = newApplicationType?.id ?? 1;

  return xano.familyApplicationProgress.create({
    registration_families_id: familyId,
    registration_school_years_id: yearId,
    family_completed: false,
    students_completed: false,
    financial_aid_completed: false,
    testing_completed: false,
    last_edited: Date.now(),
    submitted_at: null,
    isSubmitted: false,
    isAccepted: false,
    registration_type_id,
  });
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

  // Only allow whitelisted fields. Don't let the client overwrite the family /
  // year / id on this row.
  const allowed: Array<keyof import("@/lib/xano").XanoFamilyApplicationProgress> = [
    "family_completed",
    "students_completed",
    "financial_aid_completed",
    "testing_completed",
    "submitted_at",
    "isSubmitted",
    "registration_type_id",
  ];
  const patch: Record<string, unknown> = { last_edited: Date.now() };
  for (const key of allowed) {
    if (key in body) patch[key] = body[key];
  }

  // Auto-unconfirm cascade (Approach B): when the parent flips a
  // section's `*_completed`, clear the matching admin section-
  // confirm pair. Admin confirmation represents "I've reviewed the
  // current state of this section" — if the parent has unlocked +
  // edited that section's data (which flips `*_completed=false`),
  // the prior admin review is stale and shouldn't survive.
  //
  // Cleared atomically alongside the parent's PATCH so a partial
  // update can't leave a section confirmed against changed data.
  // Testing has no `testing_admin_confirm_admin` column on Xano;
  // its `adminKey` is null and gets skipped below.
  //
  // The Financial Aid + Scholarship Determination cascade also
  // clears `scholarship_admin_complete` (the admin-only
  // Scholarship Determination verify) because the determination is
  // derived from the household's financial-aid inputs — if the
  // parent re-opens FinAid, the scholarship admin has worked off
  // stale numbers and needs to redo the determination too. Note
  // the audit timestamp column is `scholarship_complete_admin_time`
  // (not `scholarship_admin_complete_time`) — the Xano schema's
  // word order diverges from the bool's order. See the matching
  // note on `XanoFamilyApplicationProgress`.
  const SECTION_CASCADE: Array<{
    completedKey: string;
    confirmKey: string;
    timeKey: string;
    adminKey: string | null;
  }> = [
    {
      completedKey: "family_completed",
      confirmKey: "family_admin_confirm",
      timeKey: "family_admin_confirm_time",
      adminKey: "family_admin_confirm_admin",
    },
    {
      completedKey: "students_completed",
      confirmKey: "students_admin_confirm",
      timeKey: "students_admin_confirm_time",
      adminKey: "students_admin_confirm_admin",
    },
    {
      completedKey: "testing_completed",
      confirmKey: "testing_admin_confirm",
      timeKey: "testing_admin_confirm_time",
      adminKey: null,
    },
    {
      completedKey: "financial_aid_completed",
      confirmKey: "financial_aid_admin_confirm",
      timeKey: "financial_aid_admin_confirm_time",
      adminKey: "financial_aid_admin_confirm_admin",
    },
  ];
  for (const pair of SECTION_CASCADE) {
    if (pair.completedKey in patch) {
      patch[pair.confirmKey] = false;
      patch[pair.timeKey] = null;
      if (pair.adminKey) {
        patch[pair.adminKey] = "";
      }
    }
  }

  // Re-opening Financial Aid also invalidates the Scholarship
  // Determination — the determination is computed from the
  // household income / contributing members / SNAP signals the
  // parent just unlocked, so the admin's prior verify is stale.
  // Handled separately from `SECTION_CASCADE` above because the
  // scholarship row uses a divergent column name
  // (`scholarship_complete_admin_time`, not
  // `scholarship_admin_complete_time`).
  if ("financial_aid_completed" in patch) {
    patch.scholarship_admin_complete = false;
    patch.scholarship_complete_admin_time = null;
    patch.scholarship_admin_complete_admin = "";
  }

  const row = await resolveProgress(familyId, yearId);
  const updated = await xano.familyApplicationProgress.update(row.id, patch);

  // Email 1: parent flipped `isSubmitted` from false → true. Send
  // the "we received your application" confirmation. We compare
  // against the pre-patch row so re-submissions (admin un-locks,
  // parent re-submits) or no-op PATCHes don't fire duplicates.
  // Best-effort: a failed Resend send doesn't fail the PATCH the
  // parent just made.
  if (patch.isSubmitted === true && row.isSubmitted !== true) {
    sendApplicationReceivedEmail(familyId, yearId).catch((err) => {
      console.error(
        `[/api/family-progress] sendApplicationReceivedEmail failed for family=${familyId} year=${yearId}:`,
        err
      );
    });
    sendApplicationReceivedSms(familyId, yearId).catch((err) => {
      console.error(
        `[/api/family-progress] sendApplicationReceivedSms failed for family=${familyId} year=${yearId}:`,
        err
      );
    });
    // Link any recruitment leads (inquiry / camp / waiver / TASCO)
    // whose email or phone matches this family's parents — the
    // moment a lead "converts" is exactly this submit. Best-effort
    // like the sends above: a match failure never fails the submit.
    matchLeadsToFamilies({ familyId }).catch((err) => {
      console.error(
        `[/api/family-progress] lead auto-match failed for family=${familyId}:`,
        err
      );
    });
  }

  return NextResponse.json(updated, { status: 200 });
}

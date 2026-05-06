import { auth, currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { xano } from "@/lib/xano";

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
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const familyId = user.publicMetadata.registration_families_id as number | undefined;
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
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const familyId = user.publicMetadata.registration_families_id as number | undefined;
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
  // FinAid is intentionally absent since there's no
  // `financial_aid_admin_confirm` column — the Scholarship
  // Determination card has its own per-student confirmation flow.
  // Testing has no `testing_admin_confirm_admin` column on Xano
  // either; its `adminKey` is null and gets skipped below.
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

  const row = await resolveProgress(familyId, yearId);
  const updated = await xano.familyApplicationProgress.update(row.id, patch);
  return NextResponse.json(updated, { status: 200 });
}

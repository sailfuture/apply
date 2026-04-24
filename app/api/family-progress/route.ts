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

  const row = await resolveProgress(familyId, yearId);
  const updated = await xano.familyApplicationProgress.update(row.id, patch);
  return NextResponse.json(updated, { status: 200 });
}

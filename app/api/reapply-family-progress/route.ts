import { auth, currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { xano } from "@/lib/xano";
import type { XanoReapplyFamilyProgress } from "@/lib/xano";

/**
 * Reads (and creates on first access) the per-family per-year re-application
 * progress row. Mirrors the pattern used by the other progress routes so the
 * client can issue single-field PATCHes without worrying about row existence.
 */
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

  const row = await xano.reapplyFamilyProgress.resolve(familyId, yearId);
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

  const allowed: Array<keyof XanoReapplyFamilyProgress> = [
    "isFamilyDetails",
    "isStudentDetails",
    "isScholarship",
    "isTransportation",
    "isSubmitted",
  ];
  const patch: Record<string, unknown> = { last_edited: Date.now() };
  for (const key of allowed) {
    if (key in body) patch[key] = body[key];
  }

  const row = await xano.reapplyFamilyProgress.resolve(familyId, yearId);
  const updated = await xano.reapplyFamilyProgress.update(row.id, patch);
  return NextResponse.json(updated, { status: 200 });
}

import { auth, currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { xano } from "@/lib/xano";

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await currentUser();
  const familyId = (user?.publicMetadata as { familyId?: number })?.familyId;
  if (!familyId) {
    return NextResponse.json(null);
  }

  const { searchParams } = new URL(req.url);
  const yearId = Number(searchParams.get("yearId"));
  if (!yearId) {
    return NextResponse.json({ error: "yearId required" }, { status: 400 });
  }

  const payment = await xano.familyPayments.getByFamilyAndYear(familyId, yearId);
  return NextResponse.json(payment);
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await currentUser();
  const familyId = (user?.publicMetadata as { familyId?: number })?.familyId;
  if (!familyId) {
    return NextResponse.json({ error: "No family found" }, { status: 400 });
  }

  const body = await req.json();
  const yearId = body.registration_school_years_id;

  if (!yearId || !body.tuition_reviewed_by) {
    return NextResponse.json({ error: "yearId and tuition_reviewed_by required" }, { status: 400 });
  }

  // Check if one already exists
  const existing = await xano.familyPayments.getByFamilyAndYear(familyId, yearId);
  if (existing) {
    // Update existing
    const updated = await xano.familyPayments.update(existing.id, {
      tuition_reviewed: true,
      tuition_reviewed_at: Date.now(),
      tuition_reviewed_by: body.tuition_reviewed_by,
    });
    return NextResponse.json(updated);
  }

  // Create new
  const payment = await xano.familyPayments.create({
    registration_families_id: familyId,
    registration_school_years_id: yearId,
    tuition_reviewed: true,
    tuition_reviewed_at: Date.now(),
    tuition_reviewed_by: body.tuition_reviewed_by,
  });

  return NextResponse.json(payment);
}

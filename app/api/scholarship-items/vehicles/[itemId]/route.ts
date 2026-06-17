import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { xano } from "@/lib/xano";
import { denyScholarshipMutation } from "@/lib/scholarship-access";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ itemId: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { itemId } = await params;
  const id = Number(itemId);
  // Ownership guard — admin or owning family only (prevents IDOR).
  const item = await xano.scholarshipVehicles.getById(id);
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const denied = await denyScholarshipMutation(
    item.registration_opportunity_scholarship_id
  );
  if (denied) return denied;

  const body = await req.json();
  const updated = await xano.scholarshipVehicles.update(id, body);
  return NextResponse.json(updated);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ itemId: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { itemId } = await params;
  const id = Number(itemId);
  const item = await xano.scholarshipVehicles.getById(id);
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const denied = await denyScholarshipMutation(
    item.registration_opportunity_scholarship_id
  );
  if (denied) return denied;

  await xano.scholarshipVehicles.delete(id);
  return NextResponse.json({ success: true });
}

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { xano } from "@/lib/xano";
import {
  denyScholarshipAccess,
  pickAllowedFields,
} from "@/lib/scholarship-access";
import type { XanoScholarshipVehicle } from "@/lib/xano";

// Fields the parent Financial Aid page is allowed to PATCH — everything
// but the parent-scholarship foreign key, which would re-point the row
// at another family's application.
const PARENT_FIELD_ALLOWLIST = [
  "type",
  "car_make",
  "car_model",
  "car_year",
  "total_value",
  "remaining_debt",
] as const satisfies ReadonlyArray<keyof XanoScholarshipVehicle>;

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
  const denied = await denyScholarshipAccess(
    item.registration_opportunity_scholarship_id
  );
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const patch = pickAllowedFields(body, PARENT_FIELD_ALLOWLIST);
  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: "No editable fields in body" },
      { status: 400 }
    );
  }
  const updated = await xano.scholarshipVehicles.update(id, patch);
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
  const denied = await denyScholarshipAccess(
    item.registration_opportunity_scholarship_id
  );
  if (denied) return denied;

  await xano.scholarshipVehicles.delete(id);
  return NextResponse.json({ success: true });
}

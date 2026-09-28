import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { xano } from "@/lib/xano";
import {
  denyScholarshipAccess,
  pickAllowedFields,
} from "@/lib/scholarship-access";
import type { XanoScholarshipBenefit } from "@/lib/xano";

// Fields the parent Financial Aid page is allowed to PATCH. The admin
// verification trail (`benefit_is_confirmed` + its audit stamps) and the
// parent-scholarship foreign key are writable only through
// `/api/admin/scholarship-benefits`.
const PARENT_FIELD_ALLOWLIST = [
  "type",
  "amount_monthly",
  "benefit_documentation",
] as const satisfies ReadonlyArray<keyof XanoScholarshipBenefit>;

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ itemId: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { itemId } = await params;
  const id = Number(itemId);
  // Ownership guard — admin or owning family only (prevents IDOR).
  const item = await xano.scholarshipBenefits.getById(id);
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
  const updated = await xano.scholarshipBenefits.update(id, patch);
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
  const item = await xano.scholarshipBenefits.getById(id);
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const denied = await denyScholarshipAccess(
    item.registration_opportunity_scholarship_id
  );
  if (denied) return denied;

  await xano.scholarshipBenefits.delete(id);
  return NextResponse.json({ success: true });
}

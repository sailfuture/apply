import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { xano } from "@/lib/xano";
import {
  denyScholarshipAccess,
  pickAllowedFields,
} from "@/lib/scholarship-access";
import type { XanoScholarshipContributingMember } from "@/lib/xano";

// Fields the parent Financial Aid page is allowed to PATCH. The
// per-document confirm flags (`w2_confirm`, `paystub_N_confirm`), their
// audit stamps, `is_verified`, and the parent-scholarship foreign key
// are writable only through `/api/admin/contributing-members/[id]`.
const PARENT_FIELD_ALLOWLIST = [
  "first_name",
  "last_name",
  "address_1",
  "address_2",
  "city",
  "state",
  "zipcode",
  "estimated_annual_income",
  "isW2",
  "isPayStubs",
  "w2",
  "paystub_1",
  "paystub_2",
  "paystub_3",
  "paystub_4",
] as const satisfies ReadonlyArray<keyof XanoScholarshipContributingMember>;

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ itemId: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { itemId } = await params;
  const id = Number(itemId);
  // Ownership guard: resolve the row's parent scholarship and confirm the
  // caller is an admin or the owning family before mutating (prevents IDOR
  // via a guessed item id).
  const item = await xano.scholarshipContributingMembers.getById(id);
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
  const updated = await xano.scholarshipContributingMembers.update(id, patch);
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
  const item = await xano.scholarshipContributingMembers.getById(id);
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const denied = await denyScholarshipAccess(
    item.registration_opportunity_scholarship_id
  );
  if (denied) return denied;

  await xano.scholarshipContributingMembers.delete(id);
  return NextResponse.json({ success: true });
}

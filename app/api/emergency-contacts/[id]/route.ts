import { getFamilyAuth } from "@/lib/family-auth";
import { NextRequest, NextResponse } from "next/server";
import { xano } from "@/lib/xano";
import {
  denyEmergencyContactAccess,
  stripReadonlyFields,
} from "@/lib/family-access";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getFamilyAuth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { familyId } = session;
  if (!familyId) return NextResponse.json({ error: "No family found" }, { status: 400 });

  const { id } = await params;

  // The contact id comes from the URL — it must be one of the caller's
  // own family's contacts. See lib/family-access.ts.
  const denied = await denyEmergencyContactAccess(id, familyId);
  if (denied) return denied;

  // Never let a save move the contact to another family.
  const body = stripReadonlyFields(await req.json());
  const updated = await xano.emergencyContacts.update(Number(id), body);

  return NextResponse.json(updated, { status: 200 });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getFamilyAuth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { familyId } = session;
  if (!familyId) return NextResponse.json({ error: "No family found" }, { status: 400 });

  const { id } = await params;

  const denied = await denyEmergencyContactAccess(id, familyId);
  if (denied) return denied;

  await xano.emergencyContacts.delete(Number(id));

  return NextResponse.json({ success: true }, { status: 200 });
}

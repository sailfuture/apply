import { getFamilyAuth } from "@/lib/family-auth";
import { NextRequest, NextResponse } from "next/server";
import { xano } from "@/lib/xano";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getFamilyAuth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { familyId } = session;
  if (!familyId) return NextResponse.json({ error: "No family found" }, { status: 400 });

  const { id } = await params;
  const body = await req.json();
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
  await xano.emergencyContacts.delete(Number(id));

  return NextResponse.json({ success: true }, { status: 200 });
}

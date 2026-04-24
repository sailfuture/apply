import { auth, currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { xano } from "@/lib/xano";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const familyId = user.publicMetadata.registration_families_id as number | undefined;
  if (!familyId) return NextResponse.json({ error: "No family found" }, { status: 400 });

  const { id } = await params;
  const body = await req.json();

  // Xano types medicaid_number as a number; coerce empty strings to 0 before
  // forwarding, otherwise Xano rejects the whole PATCH.
  if ("medicaid_number" in body) {
    const n = Number(body.medicaid_number);
    body.medicaid_number = Number.isFinite(n) ? n : 0;
  }

  const updated = await xano.studentRegistration.update(Number(id), body);

  return NextResponse.json(updated, { status: 200 });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const familyId = user.publicMetadata.registration_families_id as number | undefined;
  if (!familyId) return NextResponse.json({ error: "No family found" }, { status: 400 });

  const { id } = await params;
  await xano.studentRegistration.delete(Number(id));

  return NextResponse.json({ ok: true }, { status: 200 });
}

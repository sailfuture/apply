import { auth, currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { xano } from "@/lib/xano";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const familyId = user.publicMetadata.registration_families_id as number | undefined;
  if (!familyId) return NextResponse.json([], { status: 200 });

  const contacts = await xano.emergencyContacts.getByFamilyId(familyId);
  return NextResponse.json(contacts, { status: 200 });
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const familyId = user.publicMetadata.registration_families_id as number | undefined;
  if (!familyId) return NextResponse.json({ error: "No family found" }, { status: 400 });

  const body = await req.json();
  const contact = await xano.emergencyContacts.create({
    registration_families_id: familyId,
    first_name: body.first_name ?? "",
    last_name: body.last_name ?? "",
    email: body.email ?? "",
    phone: body.phone ?? "",
    relationship: body.relationship ?? "",
    address_line_1: body.address_line_1 ?? "",
    address_line_2: body.address_line_2 ?? "",
    city: body.city ?? "",
    state: body.state ?? "",
    zipcode: body.zipcode ?? "",
  });

  return NextResponse.json(contact, { status: 201 });
}

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { xano } from "@/lib/xano";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const members = await xano.scholarshipContributingMembers.getByScholarshipId(Number(id));
  return NextResponse.json(members);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();

  const member = await xano.scholarshipContributingMembers.create({
    registration_opportunity_scholarship_id: Number(id),
    first_name: body.first_name ?? "",
    last_name: body.last_name ?? "",
    address_1: body.address_1 ?? "",
    address_2: body.address_2 ?? "",
    city: body.city ?? "",
    state: body.state ?? "",
    zipcode: body.zipcode ?? "",
    estimated_annual_income: body.estimated_annual_income ?? 0,
    isW2: body.isW2 ?? false,
    isPayStubs: body.isPayStubs ?? false,
    // Each verification slot is now a multi-file array. Default to []
    // on create so the new member shows up with editable empty uploads
    // instead of nullable single-object fields.
    w2: [],
    paystub_1: [],
    paystub_2: [],
    paystub_3: [],
    paystub_4: [],
  });

  return NextResponse.json(member, { status: 201 });
}

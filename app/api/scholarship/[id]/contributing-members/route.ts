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
    address: body.address ?? "",
    address_1: body.address_1 ?? "",
    address_2: body.address_2 ?? "",
    city: body.city ?? "",
    state: body.state ?? "",
    zipcode: body.zipcode ?? "",
    estimated_annual_income: body.estimated_annual_income ?? 0,
    income_verification_type: body.income_verification_type ?? "",
    is_w2: body.is_w2 ?? false,
    is_pay_stubs: body.is_pay_stubs ?? false,
    w2: null,
    paystub_1: null,
    paystub_2: null,
    paystub_3: null,
    paystub_4: null,
  });

  return NextResponse.json(member, { status: 201 });
}

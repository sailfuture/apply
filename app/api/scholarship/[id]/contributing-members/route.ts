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
    w2: null,
    paystub_1: null,
    paystub_2: null,
    paystub_3: null,
    paystub_4: null,
  });

  return NextResponse.json(member, { status: 201 });
}

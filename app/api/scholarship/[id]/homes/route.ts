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
  const homes = await xano.scholarshipHomes.getByScholarshipId(Number(id));
  return NextResponse.json(homes);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();

  const home = await xano.scholarshipHomes.create({
    registration_opportunity_scholarship_id: Number(id),
    type: body.type ?? "",
    address: body.address ?? "",
    address_1: body.address_1 ?? "",
    address_2: body.address_2 ?? "",
    city: body.city ?? "",
    state: body.state ?? "",
    zipcode: body.zipcode ?? "",
    total_value: body.total_value ?? 0,
    outstanding_debt: body.outstanding_debt ?? 0,
  });

  return NextResponse.json(home, { status: 201 });
}

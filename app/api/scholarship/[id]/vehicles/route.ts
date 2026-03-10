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
  const vehicles = await xano.scholarshipVehicles.getByScholarshipId(Number(id));
  return NextResponse.json(vehicles);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();

  const vehicle = await xano.scholarshipVehicles.create({
    registration_opportunity_scholarship_id: Number(id),
    type: body.type ?? "",
    car_make: body.car_make ?? "",
    car_model: body.car_model ?? "",
    car_year: body.car_year ?? "",
    total_value: body.total_value ?? 0,
    remaining_debt: body.remaining_debt ?? 0,
  });

  return NextResponse.json(vehicle, { status: 201 });
}

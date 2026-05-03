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
  const benefits = await xano.scholarshipBenefits.getByScholarshipId(Number(id));
  return NextResponse.json(benefits);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();

  // Default `benefit_documentation` to an empty array on create so the
  // page can render the multi-file upload immediately without first
  // having to PATCH a missing field into the column.
  const benefit = await xano.scholarshipBenefits.create({
    registration_opportunity_scholarship_id: Number(id),
    type: body.type ?? "",
    amount_monthly: body.amount_monthly ?? 0,
    benefit_documentation: Array.isArray(body.benefit_documentation)
      ? body.benefit_documentation
      : [],
  });

  return NextResponse.json(benefit, { status: 201 });
}

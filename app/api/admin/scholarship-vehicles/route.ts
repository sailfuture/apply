import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";

/**
 * Admin vehicles list + create for a scholarship. Same shape as the
 * homes route — GET ?scholarshipId=X lists the family's declared
 * vehicles, POST { scholarshipId } creates a blank row admin fills in
 * on the family's behalf. Mirrors the parent-side
 * `/api/scholarship/[id]/vehicles` but admin-auth'd.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const scholarshipId = Number(
      req.nextUrl.searchParams.get("scholarshipId")
    );
    if (!Number.isFinite(scholarshipId) || scholarshipId <= 0) {
      return NextResponse.json(
        { error: "scholarshipId is required" },
        { status: 400 }
      );
    }
    const vehicles = await xano.scholarshipVehicles.getByScholarshipId(
      scholarshipId
    );
    return NextResponse.json(vehicles);
  } catch (err) {
    return handleAdminError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = await req.json();
    const scholarshipId = Number(body.scholarshipId);
    if (!Number.isFinite(scholarshipId) || scholarshipId <= 0) {
      return NextResponse.json(
        { error: "scholarshipId is required" },
        { status: 400 }
      );
    }
    const vehicle = await xano.scholarshipVehicles.create({
      registration_opportunity_scholarship_id: scholarshipId,
      type: body.type ?? "",
      car_make: body.car_make ?? "",
      car_model: body.car_model ?? "",
      car_year: body.car_year ?? "",
      total_value: body.total_value ?? 0,
      remaining_debt: body.remaining_debt ?? 0,
    });
    return NextResponse.json(vehicle, { status: 201 });
  } catch (err) {
    return handleAdminError(err);
  }
}

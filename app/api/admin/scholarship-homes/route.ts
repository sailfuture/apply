import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";

/**
 * Admin homes list + create for a scholarship.
 *
 *   - GET  ?scholarshipId=X — the family's declared homes for that
 *     scholarship row (client-side filtered in the Xano helper).
 *   - POST { scholarshipId } — creates a blank home row admin then
 *     fills in on the family's behalf (paper-application transcription
 *     or a mid-cycle correction).
 *
 * Mirrors the parent-side `/api/scholarship/[id]/homes` but admin-auth'd
 * (no family Clerk session). The parent flow owns the same table; this
 * is the staff-facing door into it.
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
    const homes = await xano.scholarshipHomes.getByScholarshipId(scholarshipId);
    return NextResponse.json(homes);
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
    const home = await xano.scholarshipHomes.create({
      registration_opportunity_scholarship_id: scholarshipId,
      type: body.type ?? "",
      address_1: body.address_1 ?? "",
      address_2: body.address_2 ?? "",
      city: body.city ?? "",
      state: body.state ?? "",
      zipcode: body.zipcode ?? "",
      total_value: body.total_value ?? 0,
      outstanding_debt: body.outstanding_debt ?? 0,
    });
    return NextResponse.json(home, { status: 201 });
  } catch (err) {
    return handleAdminError(err);
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";

/**
 * Admin GET — single scholarship + every child row Xano pre-joins on
 * its `/registration_opportunity_scholarship/{id}` endpoint, returned
 * in one payload:
 *
 *   {
 *     scholarship,            // XanoScholarship
 *     homes,                  // XanoScholarshipHome[]
 *     vehicles,               // XanoScholarshipVehicle[]
 *     contributing_members,   // XanoScholarshipContributingMember[]
 *     benefits                // XanoScholarshipBenefit[]
 *   }
 *
 * Used by the admin Financial Aid section so the page makes ONE
 * request instead of stitching together the scholarship row, homes,
 * vehicles, contributing members, and benefits as separate filtered
 * fetches. Xano's auto-generated child-list endpoints don't honor
 * arbitrary FK predicates — relying on this composite endpoint
 * removes a whole class of "did we remember to filter?" bugs.
 *
 * Required query param: `?id=X` (the scholarship row id).
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const idParam = req.nextUrl.searchParams.get("id");
    const scholarshipId = Number(idParam);
    if (!Number.isFinite(scholarshipId) || scholarshipId <= 0) {
      return NextResponse.json(
        { error: "id is required" },
        { status: 400 }
      );
    }
    const payload = await xano.scholarship.getByIdWithChildren(
      scholarshipId
    );
    return NextResponse.json(payload);
  } catch (err) {
    return handleAdminError(err);
  }
}

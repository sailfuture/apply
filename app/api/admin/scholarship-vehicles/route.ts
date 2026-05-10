import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";

/**
 * Admin GET — list every vehicle row tied to a scholarship. Used by
 * the Financial Aid section to surface the family's declared owned
 * vehicles (type, make/model/year, total value, remaining debt) so
 * admin can scan the asset picture without opening the parent flow.
 *
 * Required query param: `?scholarshipId=X`. Filters happen
 * client-side inside `getByScholarshipId` because Xano's
 * auto-generated GET doesn't honor arbitrary FK predicates.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const scholarshipIdParam = req.nextUrl.searchParams.get("scholarshipId");
    const scholarshipId = Number(scholarshipIdParam);
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

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";

/**
 * Admin GET — list every home row tied to a scholarship. Used by the
 * Financial Aid section to surface declared purchased properties
 * (type, address, total value, outstanding debt) alongside the rest
 * of the asset picture.
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
    const homes = await xano.scholarshipHomes.getByScholarshipId(
      scholarshipId
    );
    return NextResponse.json(homes);
  } catch (err) {
    return handleAdminError(err);
  }
}

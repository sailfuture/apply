import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";

/**
 * Admin GET — list every benefit row tied to a scholarship. Used by
 * the Scholarship Determination card to surface government-benefit
 * award letters / approval notices alongside the contributing-member
 * income docs and the SNAP / unemployment uploads.
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
    const benefits = await xano.scholarshipBenefits.getByScholarshipId(
      scholarshipId
    );
    return NextResponse.json(benefits);
  } catch (err) {
    return handleAdminError(err);
  }
}

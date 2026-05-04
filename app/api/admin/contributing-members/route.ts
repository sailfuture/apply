import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";

/**
 * Admin contributing-members list. Returns every member row tied to a
 * given scholarship so the admin Financial Aid view can show all
 * contributors (including their W-2 / pay stub uploads), not just the
 * first one Xano happens to expand on `admin_family_application`.
 *
 * Required query param: `?scholarshipId=X`. The endpoint verifies admin
 * before passing through to Xano; member rows include file metadata
 * arrays that admin needs for the verification workflow.
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
    const members =
      await xano.scholarshipContributingMembers.getByScholarshipId(
        scholarshipId
      );
    return NextResponse.json(members);
  } catch (err) {
    return handleAdminError(err);
  }
}

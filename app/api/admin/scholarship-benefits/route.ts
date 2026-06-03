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

/**
 * Create a blank benefit row scoped to a scholarship. Admin fills in
 * type + monthly amount via the per-row PATCH and uploads the award
 * letter from the Documents to Review block. Mirrors the parent-side
 * POST (`/api/scholarship/[id]/benefits`) — same blank defaults,
 * documentation defaults to an empty array — but admin-auth'd and
 * scoped by `scholarshipId` in the body.
 */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = await req.json().catch(() => ({}));
    const scholarshipId = Number(body.scholarshipId);
    if (!Number.isFinite(scholarshipId) || scholarshipId <= 0) {
      return NextResponse.json(
        { error: "scholarshipId is required" },
        { status: 400 }
      );
    }
    const benefit = await xano.scholarshipBenefits.create({
      registration_opportunity_scholarship_id: scholarshipId,
      type: body.type ?? "",
      amount_monthly: body.amount_monthly ?? 0,
      benefit_documentation: Array.isArray(body.benefit_documentation)
        ? body.benefit_documentation
        : [],
    });
    return NextResponse.json(benefit, { status: 201 });
  } catch (err) {
    return handleAdminError(err);
  }
}

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

/**
 * Create a blank contributing-member row scoped to a scholarship.
 * Admin fills it in afterward via the per-row PATCH. Mirrors the
 * parent-side POST (`/api/scholarship/[id]/contributing-members`) —
 * same blank defaults, file slots default to empty arrays — but
 * admin-auth'd and scoped by `scholarshipId` in the body rather than
 * a route param.
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
    const member = await xano.scholarshipContributingMembers.create({
      registration_opportunity_scholarship_id: scholarshipId,
      first_name: body.first_name ?? "",
      last_name: body.last_name ?? "",
      address_1: body.address_1 ?? "",
      address_2: body.address_2 ?? "",
      city: body.city ?? "",
      state: body.state ?? "",
      zipcode: body.zipcode ?? "",
      estimated_annual_income: body.estimated_annual_income ?? 0,
      isW2: body.isW2 ?? false,
      isPayStubs: body.isPayStubs ?? false,
      w2: [],
      paystub_1: [],
      paystub_2: [],
      paystub_3: [],
      paystub_4: [],
    });
    return NextResponse.json(member, { status: 201 });
  } catch (err) {
    return handleAdminError(err);
  }
}

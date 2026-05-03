import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";

/**
 * Admin family-applications detail. Single fetch that powers the family
 * detail page's per-student application + scholarship breakdown for a
 * specific school year.
 *
 * Required query params:
 *   - `familyId`
 *   - `yearId`
 *
 * Returns the raw Xano shape: `{ application[], scholarship[], family,
 * school_year }`. Student names aren't included by the Xano endpoint —
 * the page joins them in client-side from the existing students cache.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const familyIdParam = req.nextUrl.searchParams.get("familyId");
    const yearIdParam = req.nextUrl.searchParams.get("yearId");

    const familyId = Number(familyIdParam);
    const yearId = Number(yearIdParam);
    if (!Number.isFinite(familyId) || familyId <= 0) {
      return NextResponse.json(
        { error: "familyId is required" },
        { status: 400 }
      );
    }
    if (!Number.isFinite(yearId) || yearId <= 0) {
      return NextResponse.json(
        { error: "yearId is required" },
        { status: 400 }
      );
    }

    const detail = await xano.applications.getAdminFamilyDetail(familyId, yearId);
    if (!detail) {
      return NextResponse.json(
        { error: "Family detail not found" },
        { status: 404 }
      );
    }
    return NextResponse.json(detail);
  } catch (err) {
    return handleAdminError(err);
  }
}

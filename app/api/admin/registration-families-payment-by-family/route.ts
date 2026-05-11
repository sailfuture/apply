import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";

/**
 * Admin proxy for Xano's
 * `registration_families_payment_by_family` query (api group
 * `2GcBXyoA`). Returns the family-payment row for the
 * (family, year) tuple — `monthly_tuition_payment`,
 * `annual_fee_total`, `transportation_total`, `sufs_total`,
 * signature + enrollment-agreement metadata.
 *
 * Backs the Tuition card on the registration detail page so the
 * snapshot rendered there reads directly from the row admin
 * approved (rather than the legacy copies that live on the
 * registration-progress row). Same row the apply-flow Acceptance
 * card writes when admin clicks Accept Family.
 *
 * Required query params:
 *   - `familyId`
 *   - `yearId`
 *
 * Returns the row or `null` (200) when no payment row has been
 * snapshotted yet (pre-acceptance families).
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const familyId = Number(req.nextUrl.searchParams.get("familyId"));
    const yearId = Number(req.nextUrl.searchParams.get("yearId"));
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
    const row = await xano.familyPayments.getByFamilyAndYearOnAdminGroup(
      familyId,
      yearId
    );
    return NextResponse.json(row);
  } catch (err) {
    return handleAdminError(err);
  }
}

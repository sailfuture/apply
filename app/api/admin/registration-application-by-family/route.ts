import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";

/**
 * Admin proxy for Xano's `registration_application_by_family` query
 * (api group `2GcBXyoA`). Returns the family's active applications
 * for the year, each row pre-joined with the student row, the family
 * row, the school-year row, and (when present) the opportunity-
 * scholarship row.
 *
 * Distinct from `/api/admin/family-applications`:
 *   - That route hits the `admin_family_application` composite query
 *     which returns `{ application[], scholarship[], family,
 *     school_year }` as separate top-level keys. The page detail
 *     view reads from that shape.
 *   - This route returns a flat `XanoApplicationByFamily[]` — one
 *     row per app, with the joined rows hanging off addon keys.
 *     The acceptance-summary PDF uses this shape because it lets a
 *     single fetch hydrate every label the report needs (student
 *     names, family name, school-year amounts) without stitching
 *     separate fetches together client-side.
 *
 * Required query params:
 *   - `familyId`
 *   - `yearId`
 *
 * `isActive=false` rows are filtered out by the underlying Xano
 * query already; no extra filter needed here.
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
    const rows = await xano.applications.getActiveByFamilyAndYearWithDetails(
      familyId,
      yearId
    );
    return NextResponse.json(rows);
  } catch (err) {
    return handleAdminError(err);
  }
}

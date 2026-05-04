import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";

/**
 * Admin endpoints for the per-year "high net assets" sliding scale.
 * Backs `registration_school_year_net_assets_bracket` in Xano —
 * a 1D list of asset brackets.
 *
 * Field names mirror the Xano columns directly:
 *   - `net_asset_min` / `net_asset_max` — asset bracket bounds
 *   - `percentage_of_total_tuition` — decimal 0–100 of base tuition
 *     the family pays for that bracket
 *
 * Once a family clears the net-assets threshold, household size
 * doesn't factor in, so this table has no household axis (unlike the
 * regular tuition matrix on `registration_school_year_award_brackets`).
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const yearIdParam = req.nextUrl.searchParams.get("yearId");
    const yearId = Number(yearIdParam);
    if (!Number.isFinite(yearId) || yearId <= 0) {
      return NextResponse.json(
        { error: "yearId is required" },
        { status: 400 }
      );
    }
    const rows = await xano.schoolYearNetAssetsBrackets.getByYear(yearId);
    return NextResponse.json(rows);
  } catch (err) {
    return handleAdminError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = await req.json();
    const yearId = Number(body?.registration_school_years_id);

    // `net_asset_min` is required and finite. `net_asset_max` is
    // optional; null/empty/undefined → unbounded "and up" row.
    const netAssetMinRaw = body?.net_asset_min;
    const netAssetMin =
      netAssetMinRaw === null || netAssetMinRaw === undefined || netAssetMinRaw === ""
        ? null
        : Number(netAssetMinRaw);
    const netAssetMaxRaw = body?.net_asset_max;
    const netAssetMax =
      netAssetMaxRaw === null || netAssetMaxRaw === undefined || netAssetMaxRaw === ""
        ? null
        : Number(netAssetMaxRaw);
    const percentage = Number(body?.percentage_of_total_tuition);

    if (!Number.isFinite(yearId) || yearId <= 0) {
      return NextResponse.json(
        { error: "registration_school_years_id is required" },
        { status: 400 }
      );
    }
    if (netAssetMax !== null && !Number.isFinite(netAssetMax)) {
      return NextResponse.json(
        { error: "net_asset_max must be a number or null" },
        { status: 400 }
      );
    }

    const created = await xano.schoolYearNetAssetsBrackets.create({
      registration_school_years_id: yearId,
      net_asset_min: Number.isFinite(netAssetMin as number)
        ? (netAssetMin as number)
        : 0,
      net_asset_max: netAssetMax,
      percentage_of_total_tuition: Number.isFinite(percentage)
        ? percentage
        : 0,
    });
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    return handleAdminError(err);
  }
}

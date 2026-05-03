import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";

/**
 * Admin endpoints for the per-year "high net assets" matrix. Backs
 * `registration_school_year_net_assets_bracket` in Xano. Same shape as
 * the regular tuition matrix (household_size × income_bracket), but
 * each cell stores a **percentage** of total tuition (0–100) rather
 * than a dollar amount.
 *
 * One row per cell so single-cell PATCH stays cheap.
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
    const householdSize = Number(body?.household_size);
    const incomeMin = Number(body?.income_min);
    const incomeMaxRaw = body?.income_max;
    const incomeMax =
      incomeMaxRaw === null || incomeMaxRaw === undefined || incomeMaxRaw === ""
        ? null
        : Number(incomeMaxRaw);
    const tuitionPercentage = Number(body?.tuition_percentage);

    if (!Number.isFinite(yearId) || yearId <= 0) {
      return NextResponse.json(
        { error: "registration_school_years_id is required" },
        { status: 400 }
      );
    }
    if (!Number.isFinite(householdSize) || householdSize <= 0) {
      return NextResponse.json(
        { error: "household_size must be a positive integer" },
        { status: 400 }
      );
    }
    if (!Number.isFinite(incomeMin)) {
      return NextResponse.json(
        { error: "income_min is required" },
        { status: 400 }
      );
    }
    if (incomeMax !== null && !Number.isFinite(incomeMax)) {
      return NextResponse.json(
        { error: "income_max must be a number or null" },
        { status: 400 }
      );
    }

    const created = await xano.schoolYearNetAssetsBrackets.create({
      registration_school_years_id: yearId,
      household_size: householdSize,
      income_min: incomeMin,
      income_max: incomeMax,
      tuition_percentage: Number.isFinite(tuitionPercentage)
        ? tuitionPercentage
        : 0,
    });
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    return handleAdminError(err);
  }
}

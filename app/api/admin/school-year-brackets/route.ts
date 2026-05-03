import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";

/**
 * Admin scholarship award matrix endpoints. The matrix lives at
 * `registration_school_year_award_brackets` in Xano — one row per cell
 * at (household_size × income_bracket). The school-year detail page
 * pulls the whole matrix on mount via GET, edits cells via PATCH on
 * `[id]`, and inserts new rows/columns via POST.
 *
 * Why one row per cell instead of a JSON blob: makes single-cell PATCH
 * cheap, lets us add brackets/sizes without rewriting everything, and
 * gives us a clean place to record the per-cell `created_at` so an
 * admin can see when a tier last shifted.
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
    const rows = await xano.schoolYearAwardBrackets.getByYear(yearId);
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
    const awardAmount = Number(body?.award_amount);

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

    const created = await xano.schoolYearAwardBrackets.create({
      registration_school_years_id: yearId,
      household_size: householdSize,
      income_min: incomeMin,
      income_max: incomeMax,
      award_amount: Number.isFinite(awardAmount) ? awardAmount : 0,
    });
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    return handleAdminError(err);
  }
}

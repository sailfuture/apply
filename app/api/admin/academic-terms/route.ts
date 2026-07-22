import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";

/**
 * Create an academic term for a school year.
 *
 *   POST { term_name, registration_school_years_id,
 *          start_date?, end_date?, isActive? }
 *
 * Dates are "YYYY-MM-DD" (anything else stores as null).
 */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 }
      );
    }

    const yearId = Number(body.registration_school_years_id);
    if (!Number.isFinite(yearId) || yearId <= 0) {
      return NextResponse.json(
        { error: "registration_school_years_id is required" },
        { status: 400 }
      );
    }
    const name =
      typeof body.term_name === "string" ? body.term_name.trim() : "";
    if (!name) {
      return NextResponse.json(
        { error: "Term name is required" },
        { status: 400 }
      );
    }
    const startDate = coerceDate(body.start_date);
    const endDate = coerceDate(body.end_date);
    if (startDate && endDate && endDate < startDate) {
      return NextResponse.json(
        { error: "End date can't be before the start date" },
        { status: 400 }
      );
    }

    const created = await xano.academicTerms.create({
      term_name: name,
      start_date: startDate,
      end_date: endDate,
      registration_school_years_id: yearId,
      isActive: body.isActive === true,
    });
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    return handleAdminError(err);
  }
}

/** "YYYY-MM-DD" pass-through, null for anything else. */
function coerceDate(v: unknown): string | null {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

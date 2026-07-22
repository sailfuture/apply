import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";

/**
 * Create an academic season for a school year.
 *
 *   POST { name, registration_school_years_id,
 *          registration_academic_terms_id? }
 *
 * Seasons have no dates of their own — their range comes from the
 * linked term (0 = not linked).
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
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      return NextResponse.json(
        { error: "Season name is required" },
        { status: 400 }
      );
    }

    const created = await xano.academicSeasons.create({
      name,
      registration_school_years_id: yearId,
      registration_academic_terms_id: coerceFk(
        body.registration_academic_terms_id
      ),
    });
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    return handleAdminError(err);
  }
}

/** Positive FK id, else 0 ("not linked" — Xano int inputs reject null). */
function coerceFk(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

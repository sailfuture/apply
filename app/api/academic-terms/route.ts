import { getFamilyAuth } from "@/lib/family-auth";
import { NextRequest, NextResponse } from "next/server";
import { xano } from "@/lib/xano";

/**
 * Active academic terms for one school year, sorted by start date
 * (undated last) — the options for the apply flow's "Starting term"
 * question. Same data for every family.
 *
 *   GET /api/academic-terms?yearId=Y → XanoAcademicTerm[]
 */
export async function GET(req: NextRequest) {
  const session = await getFamilyAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const yearId = Number(req.nextUrl.searchParams.get("yearId"));
  if (!Number.isFinite(yearId) || yearId <= 0) {
    return NextResponse.json({ error: "yearId is required" }, { status: 400 });
  }
  try {
    const terms = await xano.academicTerms.getByYear(yearId);
    return NextResponse.json(
      terms
        .filter((t) => t.isActive !== false)
        .sort(
          (a, b) =>
            (a.start_date ?? "9999").localeCompare(b.start_date ?? "9999") ||
            a.term_name.localeCompare(b.term_name)
        )
    );
  } catch (err) {
    console.error("[/api/academic-terms] failed:", err);
    return NextResponse.json([], { status: 200 });
  }
}

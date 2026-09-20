import { getFamilyAuth } from "@/lib/family-auth";
import { NextRequest, NextResponse } from "next/server";
import { xano } from "@/lib/xano";

/**
 * Volunteer-hour entries for the signed-in parent's family.
 *
 *   GET /api/volunteer-hours?yearId=Y → XanoVolunteerHours[]
 *
 * Year-scoped because the Xano query behind it is: it filters on
 * family AND school year, and a request missing either input comes
 * back empty with a 200. The volunteer-hours page only ever renders
 * one year at a time anyway, so it asks for that year by name rather
 * than pulling every year and bucketing client-side.
 *
 * Entries are admin-created on the staff side; this route is read-only.
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

  const { familyId } = session;
  if (!familyId) {
    return NextResponse.json([], { status: 200 });
  }

  const rows = await xano.volunteerHours.getByFamily(familyId, yearId);
  return NextResponse.json(rows, { status: 200 });
}

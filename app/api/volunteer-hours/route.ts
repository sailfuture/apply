import { getFamilyAuth } from "@/lib/family-auth";
import { NextResponse } from "next/server";
import { xano } from "@/lib/xano";

/**
 * Volunteer-hour entries for the signed-in parent's family.
 *
 * Returns every entry across every school year — the caller (parent
 * dashboard / volunteer-hours detail page) filters and totals
 * client-side so a single fetch can serve both the dashboard summary
 * card and the year-scoped history table.
 *
 * Entries are admin-created on the staff side; this route is read-only.
 */
export async function GET() {
  const session = await getFamilyAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { familyId } = session;
  if (!familyId) {
    return NextResponse.json([], { status: 200 });
  }

  const rows = await xano.volunteerHours.getByFamily(familyId);
  return NextResponse.json(rows, { status: 200 });
}

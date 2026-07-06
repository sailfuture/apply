import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { NextResponse } from "next/server";
import { xano } from "@/lib/xano";

/** Admin list of summer-camp registrations. Read-only for now — the
 *  page groups rows by the `isNotAttending` archive flag and shows
 *  full student detail in a sheet; there are no admin write actions
 *  on this surface yet. */
export async function GET() {
  try {
    await requireAdmin();
    const rows = await xano.summerCamp.getAll();
    return NextResponse.json(rows);
  } catch (err) {
    return handleAdminError(err);
  }
}

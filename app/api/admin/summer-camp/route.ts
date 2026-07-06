import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { NextResponse } from "next/server";
import { xano } from "@/lib/xano";

/** Admin list of summer-camp registrations. The page groups rows by
 *  the `isNotAttending` archive flag and shows full student detail in
 *  a sheet; the only write action is the attendance toggle on the
 *  sibling `[id]` PATCH route. */
export async function GET() {
  try {
    await requireAdmin();
    const rows = await xano.summerCamp.getAll();
    return NextResponse.json(rows);
  } catch (err) {
    return handleAdminError(err);
  }
}

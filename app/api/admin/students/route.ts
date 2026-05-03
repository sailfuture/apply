import { NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";

/**
 * Admin students roster. Returns every student in the system unfiltered;
 * the page does the searching/sorting client-side via the `DataTable`
 * component. Keeps the route simple — if the table grows past a few
 * thousand rows we'll add pagination + server-side search.
 */
export async function GET() {
  try {
    await requireAdmin();
    const res = await fetch(
      `${process.env.XANO_API_BASE_URL}/registration_students`,
      { cache: "no-store" }
    );
    if (!res.ok) return NextResponse.json([], { status: 200 });
    const students = await res.json();
    return NextResponse.json(students);
  } catch (err) {
    return handleAdminError(err);
  }
}

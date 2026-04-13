import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { NextRequest, NextResponse } from "next/server";
import { xano } from "@/lib/xano";

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();

    const { searchParams } = new URL(req.url);
    const yearId = searchParams.get("yearId");

    // Fetch all applications
    const res = await fetch(
      `${process.env.XANO_API_BASE_URL}/registration_application`,
      { cache: "no-store" }
    );
    if (!res.ok) {
      return NextResponse.json([], { status: 200 });
    }

    let applications = await res.json();

    // Filter by year if provided
    if (yearId) {
      applications = applications.filter(
        (a: { registration_school_years_id: number }) =>
          Number(a.registration_school_years_id) === Number(yearId)
      );
    }

    return NextResponse.json(applications);
  } catch (err) {
    return handleAdminError(err);
  }
}

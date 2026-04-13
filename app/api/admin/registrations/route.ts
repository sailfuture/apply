import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    await requireAdmin();

    const res = await fetch(
      `${process.env.XANO_API_BASE_URL}/registration_student_registration`,
      { cache: "no-store" }
    );
    if (!res.ok) {
      return NextResponse.json([], { status: 200 });
    }

    const registrations = await res.json();
    return NextResponse.json(registrations);
  } catch (err) {
    return handleAdminError(err);
  }
}

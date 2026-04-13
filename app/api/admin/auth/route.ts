import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const { admin } = await requireAdmin();
    return NextResponse.json(admin);
  } catch (err) {
    return handleAdminError(err);
  }
}

import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { NextResponse } from "next/server";
import { xano } from "@/lib/xano";

export async function GET() {
  try {
    await requireAdmin();
    const inquiries = await xano.inquiries.getAll();
    return NextResponse.json(inquiries);
  } catch (err) {
    return handleAdminError(err);
  }
}

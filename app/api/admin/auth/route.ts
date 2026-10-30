import { withServerTiming } from "@/lib/server-timing";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { NextResponse } from "next/server";

async function handleGET() {
  try {
    const { admin } = await requireAdmin();
    return NextResponse.json(admin);
  } catch (err) {
    return handleAdminError(err);
  }
}

export const GET = withServerTiming(handleGET);

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import type { XanoScholarshipVehicle } from "@/lib/xano";

/**
 * Admin-only PATCH + DELETE for a single vehicle row. Like homes, the
 * vehicle table has no verification/audit columns — PATCH is a plain
 * whitelisted pass-through and DELETE removes the row. Admin edits
 * these on the family's behalf from the family-detail page.
 */
const ALLOWED: Array<keyof XanoScholarshipVehicle> = [
  "type",
  "car_make",
  "car_model",
  "car_year",
  "total_value",
  "remaining_debt",
];

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const { id: idParam } = await params;
    const id = Number(idParam);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    const body = await req.json();
    const patch: Record<string, unknown> = {};
    for (const key of ALLOWED) {
      if (key in body) patch[key as string] = body[key];
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json(
        { error: "No allowed fields in body" },
        { status: 400 }
      );
    }
    const updated = await xano.scholarshipVehicles.update(id, patch);
    return NextResponse.json(updated);
  } catch (err) {
    return handleAdminError(err);
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const { id: idParam } = await params;
    const id = Number(idParam);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    await xano.scholarshipVehicles.delete(id);
    return NextResponse.json({ success: true });
  } catch (err) {
    return handleAdminError(err);
  }
}

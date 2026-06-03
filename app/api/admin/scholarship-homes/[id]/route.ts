import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import type { XanoScholarshipHome } from "@/lib/xano";

/**
 * Admin-only PATCH + DELETE for a single home row. The home table
 * carries no verification/audit columns, so PATCH is a plain
 * whitelisted pass-through of the declared values and DELETE removes
 * the row outright. Admin edits these on the family's behalf from the
 * Financial Aid section of the family-detail page.
 */
const ALLOWED: Array<keyof XanoScholarshipHome> = [
  "type",
  "address_1",
  "address_2",
  "city",
  "state",
  "zipcode",
  "total_value",
  "outstanding_debt",
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
    const updated = await xano.scholarshipHomes.update(id, patch);
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
    await xano.scholarshipHomes.delete(id);
    return NextResponse.json({ success: true });
  } catch (err) {
    return handleAdminError(err);
  }
}

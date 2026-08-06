import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { parseLaptopBody } from "@/lib/laptops";
import { xano } from "@/lib/xano";

/** Admin PATCH / DELETE for one laptop assignment. Clearable text
 *  fields write the " " sentinel (Xano edits drop empty strings). */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const { id: idParam } = await params;
    const id = Number(idParam);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: "Invalid laptop id" }, { status: 400 });
    }
    const body = await req.json().catch(() => null);
    const parsed = parseLaptopBody(body, { requireCore: false });
    if ("error" in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    if (Object.keys(parsed).length === 0) {
      return NextResponse.json(
        { error: "No editable fields in body" },
        { status: 400 }
      );
    }
    if (parsed.asset_tag === "") parsed.asset_tag = " ";
    if (parsed.notes === "") parsed.notes = " ";
    if (parsed.assigned_date === "") delete parsed.assigned_date;
    const updated = await xano.studentLaptops.update(id, parsed);
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
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: "Invalid laptop id" }, { status: 400 });
    }
    await xano.studentLaptops.delete(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleAdminError(err);
  }
}

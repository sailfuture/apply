import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { parseStoreItemBody } from "@/lib/store";
import { xano } from "@/lib/xano";

/** Admin PATCH / DELETE for one store item. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const { id: idParam } = await params;
    const id = Number(idParam);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: "Invalid item id" }, { status: 400 });
    }
    const body = await req.json().catch(() => null);
    const parsed = parseStoreItemBody(body, { requireAll: false });
    if ("error" in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    if (Object.keys(parsed).length === 0) {
      return NextResponse.json(
        { error: "No editable fields in body" },
        { status: 400 }
      );
    }
    // Xano edits drop empty-string inputs — write the " " sentinel
    // when clearing the description so the clear actually lands.
    if (parsed.description === "") parsed.description = " ";
    const updated = await xano.storeItems.update(id, parsed);
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
      return NextResponse.json({ error: "Invalid item id" }, { status: 400 });
    }
    await xano.storeItems.delete(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleAdminError(err);
  }
}

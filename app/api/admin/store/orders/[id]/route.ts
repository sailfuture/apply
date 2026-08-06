import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";

/**
 * Admin PATCH for one store order — the `distributed` hand-out latch
 * only. Flipping it stamps `distributed_at` + `distributed_by`
 * (0 / " " sentinels on undo — Xano edits drop null and empty-string
 * inputs). Everything else on the row is a Stripe mirror and stays
 * read-only.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { admin } = await requireAdmin();
    const { id: idParam } = await params;
    const id = Number(idParam);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: "Invalid order id" }, { status: 400 });
    }
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || !("distributed" in body)) {
      return NextResponse.json(
        { error: "distributed is required" },
        { status: 400 }
      );
    }
    const distributed = (body as { distributed: unknown }).distributed === true;
    const updated = await xano.storeOrders.update(id, {
      distributed,
      distributed_at: distributed ? Date.now() : 0,
      distributed_by: distributed ? admin.name : " ",
    });
    return NextResponse.json(updated);
  } catch (err) {
    return handleAdminError(err);
  }
}

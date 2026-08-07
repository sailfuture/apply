import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";

/**
 * Admin PATCH for one store order — two editable things only:
 *
 *   - `distributed`: the hand-out latch. Flipping it stamps
 *     `distributed_at` + `distributed_by` (0 / " " sentinels on undo
 *     — Xano edits drop null and empty-string inputs).
 *   - `registration_families_id`: manual re-attribution for when the
 *     automatic nets (portal reference, purchaser-email match) put
 *     an order on the wrong family. 0 = unattributed.
 *
 * Everything else on the row is a Stripe mirror and stays read-only.
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
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const patch: Record<string, unknown> = {};
    if ("distributed" in body) {
      const distributed =
        (body as { distributed: unknown }).distributed === true;
      patch.distributed = distributed;
      patch.distributed_at = distributed ? Date.now() : 0;
      patch.distributed_by = distributed ? admin.name : " ";
    }
    if ("registration_families_id" in body) {
      const fid = Number(
        (body as { registration_families_id: unknown })
          .registration_families_id
      );
      if (!Number.isFinite(fid) || fid < 0) {
        return NextResponse.json(
          { error: "registration_families_id must be a family id or 0" },
          { status: 400 }
        );
      }
      patch.registration_families_id = fid;
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json(
        { error: "No editable fields in body" },
        { status: 400 }
      );
    }

    const updated = await xano.storeOrders.update(id, patch);
    return NextResponse.json(updated);
  } catch (err) {
    return handleAdminError(err);
  }
}

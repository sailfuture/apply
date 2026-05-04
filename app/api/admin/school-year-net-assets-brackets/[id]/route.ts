import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";

/**
 * Single-row PATCH / DELETE for the per-year "high net assets"
 * sliding scale. Each row is an asset bracket whose
 * `percentage_of_total_tuition` is the share of base tuition the
 * family pays.
 *
 * Field names align with the Xano columns:
 *   - `net_asset_min`
 *   - `net_asset_max` (nullable)
 *   - `percentage_of_total_tuition` (decimal 0–100)
 */
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
    if ("net_asset_min" in body) {
      const raw = body.net_asset_min;
      if (raw === null || raw === "" || raw === undefined) {
        patch.net_asset_min = null;
      } else {
        const n = Number(raw);
        if (Number.isFinite(n)) patch.net_asset_min = n;
      }
    }
    if ("net_asset_max" in body) {
      const raw = body.net_asset_max;
      if (raw === null || raw === "" || raw === undefined) {
        patch.net_asset_max = null;
      } else {
        const n = Number(raw);
        if (Number.isFinite(n)) patch.net_asset_max = n;
      }
    }
    if ("percentage_of_total_tuition" in body) {
      const n = Number(body.percentage_of_total_tuition);
      patch.percentage_of_total_tuition = Number.isFinite(n) ? n : 0;
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json(
        { error: "No editable fields in body" },
        { status: 400 }
      );
    }
    const updated = await xano.schoolYearNetAssetsBrackets.update(id, patch);
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
    await xano.schoolYearNetAssetsBrackets.delete(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleAdminError(err);
  }
}

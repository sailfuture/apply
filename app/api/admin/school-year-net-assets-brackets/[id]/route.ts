import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";

/**
 * Single-cell PATCH / DELETE for the per-year "high net assets"
 * percentage matrix. Cell values are 0–100 percentages of total
 * tuition.
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
    if ("household_size" in body) {
      const n = Number(body.household_size);
      if (Number.isFinite(n)) patch.household_size = n;
    }
    if ("income_min" in body) {
      const n = Number(body.income_min);
      if (Number.isFinite(n)) patch.income_min = n;
    }
    if ("income_max" in body) {
      const raw = body.income_max;
      if (raw === null || raw === "" || raw === undefined) {
        patch.income_max = null;
      } else {
        const n = Number(raw);
        if (Number.isFinite(n)) patch.income_max = n;
      }
    }
    if ("tuition_percentage" in body) {
      const n = Number(body.tuition_percentage);
      patch.tuition_percentage = Number.isFinite(n) ? n : 0;
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

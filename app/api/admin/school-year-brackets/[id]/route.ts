import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";

/**
 * Single-cell PATCH / DELETE for the per-year tuition-payment matrix.
 * Used by the school-year detail page when an admin commits a cell
 * edit (PATCH) or removes a household-size row / income-bracket column
 * (DELETE — caller batches these per axis).
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
    // Canonical cell value is `tuition_percentage`. Accept legacy
    // names (`tuition_payment`, `award_amount`) too so a stale browser
    // tab doesn't 400 during the rename window.
    if ("tuition_percentage" in body) {
      const n = Number(body.tuition_percentage);
      patch.tuition_percentage = Number.isFinite(n) ? n : 0;
    } else if ("tuition_payment" in body) {
      const n = Number(body.tuition_payment);
      patch.tuition_percentage = Number.isFinite(n) ? n : 0;
    } else if ("award_amount" in body) {
      const n = Number(body.award_amount);
      patch.tuition_percentage = Number.isFinite(n) ? n : 0;
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json(
        { error: "No editable fields in body" },
        { status: 400 }
      );
    }
    const updated = await xano.schoolYearAwardBrackets.update(id, patch);
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
    await xano.schoolYearAwardBrackets.delete(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleAdminError(err);
  }
}

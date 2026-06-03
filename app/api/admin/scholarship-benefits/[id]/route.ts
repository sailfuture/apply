import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import type { XanoScholarshipBenefit } from "@/lib/xano";

/**
 * Admin-only PATCH + DELETE for a single benefit row.
 *
 * Writable columns:
 *   - `benefit_is_confirmed` — documents-review confirmation toggle.
 *     Flips when admin marks the benefit's documentation reviewed and
 *     correct. Audit columns `benefit_confirm_time` and
 *     `benefit_confirm_admin` are server-stamped automatically;
 *     clients can't hand-write them.
 *   - `type` + `amount_monthly` — the declared benefit, edited on the
 *     family's behalf from the Government Benefits editor on the
 *     family-detail page.
 *   - `benefit_documentation` — multi-file array; admin uploads award
 *     letters / approval notices on behalf of the family from the
 *     Documents to Review block. Plain pass-through (the client builds
 *     the next array and PATCHes the whole slot).
 *
 * DELETE removes the benefit row outright.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { admin } = await requireAdmin();
    const { id: idParam } = await params;
    const id = Number(idParam);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const body = await req.json();

    const allowed: Array<keyof XanoScholarshipBenefit> = [
      "benefit_is_confirmed",
      "type",
      "amount_monthly",
      "benefit_documentation",
    ];
    const patch: Record<string, unknown> = {};
    for (const key of allowed) {
      if (key in body) patch[key as string] = body[key];
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json(
        { error: "No allowed fields in body" },
        { status: 400 }
      );
    }

    if ("benefit_is_confirmed" in patch) {
      const next = patch.benefit_is_confirmed === true;
      patch.benefit_confirm_time = next ? Date.now() : null;
      patch.benefit_confirm_admin = next
        ? adminTeacherIdAsNumber(admin.teacherId)
        : 0;
    }

    const updated = await xano.scholarshipBenefits.update(id, patch);
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
    await xano.scholarshipBenefits.delete(id);
    return NextResponse.json({ success: true });
  } catch (err) {
    return handleAdminError(err);
  }
}

/** Same coercion the contributing-members route uses — keeps the
 *  audit-id semantics consistent across both confirmation surfaces. */
function adminTeacherIdAsNumber(raw: string | undefined): number {
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

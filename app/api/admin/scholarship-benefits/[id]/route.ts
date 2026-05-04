import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import type { XanoScholarshipBenefit } from "@/lib/xano";

/**
 * Admin-only PATCH for a single benefit row.
 *
 * Writable column is the verification flag only — the parent-side
 * scholarship form owns everything else (type, monthly amount,
 * documentation files). Admin's only write surface here is the
 * documents-review confirmation toggle:
 *
 *   - `benefit_is_confirmed` — flips when admin marks the benefit's
 *     documentation reviewed and correct. Audit columns
 *     `benefit_confirm_time` and `benefit_confirm_admin` are
 *     server-stamped automatically; clients can't hand-write them.
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

    const allowed: Array<keyof XanoScholarshipBenefit> = ["benefit_is_confirmed"];
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

/** Same coercion the contributing-members route uses — keeps the
 *  audit-id semantics consistent across both confirmation surfaces. */
function adminTeacherIdAsNumber(raw: string | undefined): number {
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

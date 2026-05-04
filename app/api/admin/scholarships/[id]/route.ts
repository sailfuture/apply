import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import type { XanoScholarship } from "@/lib/xano";

/**
 * Admin-only PATCH for the per-year `registration_opportunity_scholarship`
 * row. Tightly scoped to the document-confirmation columns the admin
 * Scholarship Determination card writes — admin doesn't edit the
 * parent's submitted financial data through this surface; that
 * happens via the parent flow only.
 *
 * Writable columns (the booleans):
 *   - `is_snap_confirmed` — admin reviewed the SNAP award letter.
 *     Audit columns `snap_confirm_time` + `snap_confirm_admin` are
 *     auto-stamped here.
 *   - `is_unemployment_confirm` — admin reviewed the unemployment /
 *     termination letter (the no-contributing-member path).
 *     Audit columns `unemployment_confirm_time` +
 *     `unemployment_confirm_admin` are auto-stamped here.
 *
 * Audit pairing matches the contributing-members + benefits routes:
 * confirming stamps `Date.now()` + the admin's teacher id;
 * un-confirming clears them back to null / 0. Clients shouldn't
 * (and can't) hand-write the timestamp / admin columns.
 */

const CONFIRM_PAIRS = [
  {
    confirmKey: "is_snap_confirmed",
    timeKey: "snap_confirm_time",
    adminKey: "snap_confirm_admin",
  },
  {
    confirmKey: "is_unemployment_confirm",
    timeKey: "unemployment_confirm_time",
    adminKey: "unemployment_confirm_admin",
  },
] as const;

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

    const allowed: Array<keyof XanoScholarship> = [
      "is_snap_confirmed",
      "is_unemployment_confirm",
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

    const adminTeacherId = adminTeacherIdAsNumber(admin.teacherId);
    const now = Date.now();
    for (const pair of CONFIRM_PAIRS) {
      if (pair.confirmKey in patch) {
        const next = patch[pair.confirmKey] === true;
        patch[pair.timeKey] = next ? now : null;
        patch[pair.adminKey] = next ? adminTeacherId : 0;
      }
    }

    const updated = await xano.scholarship.update(id, patch);
    return NextResponse.json(updated);
  } catch (err) {
    return handleAdminError(err);
  }
}

/** Same coercion the contributing-members + benefits routes use —
 *  keeps audit-id semantics consistent across every confirmation
 *  surface that stamps `*_confirm_admin`. */
function adminTeacherIdAsNumber(raw: string | undefined): number {
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

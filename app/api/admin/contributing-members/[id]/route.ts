import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import type { XanoScholarshipContributingMember } from "@/lib/xano";

/**
 * Admin-only PATCH for a single contributing member row.
 *
 * Writable columns are scoped to the verification workflow only — the
 * parent edits everything else through the parent-side scholarship
 * form, so admin write access stays narrowly scoped:
 *
 *   - `w2_confirm` + `paystub_1_confirm` … `paystub_4_confirm` —
 *     per-file admin acknowledgements ("I reviewed this upload and
 *     it's correct").
 *   - `is_verified` — overall verification flag the Approve gate
 *     reads. The UI gates this on all relevant per-file confirms
 *     being true, but we accept it on its own here so future
 *     surfaces (e.g. a bulk-verify action) can flip it directly.
 *
 * Audit-trail stamping. Each `*_confirm` boolean is paired with two
 * audit columns on Xano (`*_confirm_time`, `*_admin_confirm`). The
 * route stamps both whenever the matching boolean is being written,
 * so the audit trail can't drift away from the actual confirmation
 * state — clients shouldn't (and can't) hand-write the timestamps
 * or admin id columns. Confirming stamps `Date.now()` + the admin's
 * teacher id; un-confirming clears them back to null / 0.
 */

const CONFIRM_PAIRS = [
  {
    confirmKey: "w2_confirm",
    timeKey: "w2_confirm_time",
    adminKey: "w2_admin_confirm",
  },
  {
    confirmKey: "paystub_1_confirm",
    timeKey: "paystub_1_confirm_time",
    adminKey: "paystub_1_admin_confirm",
  },
  {
    confirmKey: "paystub_2_confirm",
    timeKey: "paystub_2_confirm_time",
    adminKey: "paystub_2_admin_confirm",
  },
  {
    confirmKey: "paystub_3_confirm",
    timeKey: "paystub_3_confirm_time",
    adminKey: "paystub_3_admin_confirm",
  },
  {
    confirmKey: "paystub_4_confirm",
    timeKey: "paystub_4_confirm_time",
    adminKey: "paystub_4_admin_confirm",
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

    const allowed: Array<keyof XanoScholarshipContributingMember> = [
      "is_verified",
      "w2_confirm",
      "paystub_1_confirm",
      "paystub_2_confirm",
      "paystub_3_confirm",
      "paystub_4_confirm",
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

    // Stamp the matching audit columns alongside each `*_confirm`
    // boolean. Numeric fallback to 0 when the admin has no
    // teacherId on file (e.g. email-only admins) — the column type
    // is int, so 0 is the "unknown admin" sentinel. The display
    // surface treats 0 as "an admin" without a name.
    const adminTeacherId = adminTeacherIdAsNumber(admin.teacherId);
    const now = Date.now();
    for (const pair of CONFIRM_PAIRS) {
      if (pair.confirmKey in patch) {
        const next = patch[pair.confirmKey] === true;
        patch[pair.timeKey] = next ? now : null;
        patch[pair.adminKey] = next ? adminTeacherId : 0;
      }
    }

    const updated = await xano.scholarshipContributingMembers.update(
      id,
      patch
    );
    return NextResponse.json(updated);
  } catch (err) {
    return handleAdminError(err);
  }
}

/** `teacherId` arrives as a string from the admin cache — Xano's
 *  audit columns are int. Coerce, with 0 as the "unknown" sentinel
 *  for admins without a numeric teacher row. */
function adminTeacherIdAsNumber(raw: string | undefined): number {
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

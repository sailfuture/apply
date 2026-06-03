import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import type { XanoScholarshipContributingMember } from "@/lib/xano";

/**
 * Admin-only PATCH + DELETE for a single contributing member row.
 *
 * Writable columns fall into three groups:
 *
 *   1. Verification workflow:
 *      - `w2_confirm` + `paystub_1_confirm` … `paystub_4_confirm` —
 *        per-file admin acknowledgements ("I reviewed this upload and
 *        it's correct").
 *      - `is_verified` — overall verification flag the Approve gate
 *        reads. The UI gates this on all relevant per-file confirms
 *        being true, but we accept it on its own here so future
 *        surfaces (e.g. a bulk-verify action) can flip it directly.
 *   2. File slots (`w2`, `paystub_1` … `paystub_4`) — admin uploads
 *      on the family's behalf from the Documents to Review block.
 *   3. Declared bio / income (name, address, estimated income, W-2 vs
 *      pay-stub method) — admin edits these from the Contributing
 *      Members editor on the family-detail page. Plain pass-through;
 *      no audit stamping.
 *
 * DELETE removes the member row outright (admin removing a member
 * entered in error or on a now-corrected path).
 *
 * Audit-trail stamping. Each `*_confirm` boolean is paired with two
 * audit columns on Xano (`*_confirm_time`, `*_admin_confirm`). The
 * route stamps both whenever the matching boolean is being written,
 * so the audit trail can't drift away from the actual confirmation
 * state — clients shouldn't (and can't) hand-write the timestamp
 * or admin-name columns. Confirming stamps `Date.now()` + the
 * admin's display name; un-confirming clears them back to null /
 * empty string. (The `*_admin_confirm` columns were originally
 * typed `int` for teacher id but switched to `text` on Xano so the
 * UI can render the name directly without a separate lookup.)
 */

const CONFIRM_PAIRS = [
  {
    // W-2's audit timestamp column is named `w2_confirmation`, NOT
    // `w2_confirm_time` like the paystubs use. The Xano schema
    // diverged from the paystub convention on this one column;
    // PATCHing `w2_confirm_time` here would surface as an unknown
    // column and Xano rejects the whole request — so `w2_confirm`
    // never flips either. See `XanoScholarshipContributingMember`
    // for the matching note.
    confirmKey: "w2_confirm",
    timeKey: "w2_confirmation",
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
      // File-array columns. Admin can append/replace files on-behalf-of
      // the family from the Documents to Review block's "+" button.
      // Each is a multi-file array (`Record<string, unknown>[]`) so the
      // client builds the next array (existing + new uploads) and
      // PATCHes the whole slot in one round-trip.
      "w2",
      "paystub_1",
      "paystub_2",
      "paystub_3",
      "paystub_4",
      // ── Declared bio / income — admin edits on the family's behalf
      //    from the Contributing Members editor. Plain pass-through,
      //    no audit columns. `isW2` / `isPayStubs` are the mutually-
      //    exclusive documentation-method toggles (the client sets
      //    one true + the other false). ──
      "first_name",
      "last_name",
      "address_1",
      "address_2",
      "city",
      "state",
      "zipcode",
      "estimated_annual_income",
      "isW2",
      "isPayStubs",
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
    // boolean. The admin-name string falls back to "" when admin
    // has no name on file — UI treats empty as "an admin" without
    // a name. Confirming records the admin's display name straight
    // onto Xano so the rendered "Confirmed by Hunter Thompson"
    // caption doesn't need a teacher-id → name lookup.
    const adminName = admin?.name ?? "";
    const now = Date.now();
    for (const pair of CONFIRM_PAIRS) {
      if (pair.confirmKey in patch) {
        const next = patch[pair.confirmKey] === true;
        patch[pair.timeKey] = next ? now : null;
        patch[pair.adminKey] = next ? adminName : "";
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
    await xano.scholarshipContributingMembers.delete(id);
    return NextResponse.json({ success: true });
  } catch (err) {
    return handleAdminError(err);
  }
}

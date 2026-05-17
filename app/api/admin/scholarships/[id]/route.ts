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
      // Scholarship path flags — admin can flip the family between
      // the three lifecycle states (full Opportunity Scholarship
      // application, SNAP pre-qualification, opted out) on behalf
      // of the parent. The three flags are mutually exclusive in
      // practice; the path-selector cascade below normalizes that
      // when admin sets any of them.
      "isOpportunityScholarship",
      "isSNAPBenefits",
      "isNotParticipating",
      // Document slots — admin can upload paperwork on behalf of the
      // family (SNAP award letter, unemployment / termination
      // letter). The columns hold Xano file metadata arrays; the
      // upload route returns the file metadata which the client
      // splices into the existing array before PATCHing.
      "snap_benefits",
      "unemployment_letter",
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

    // Path-flag mutual-exclusion cascade. When admin flips one of
    // the three path flags to `true`, clear the other two in the
    // same patch so the row can never carry conflicting signals
    // (e.g. both `isSNAPBenefits` and `isOpportunityScholarship`
    // true at once). Flipping a flag back to `false` doesn't
    // cascade — leaves the other two as-is so admin can
    // explicitly clear the path.
    const PATH_KEYS = [
      "isOpportunityScholarship",
      "isSNAPBenefits",
      "isNotParticipating",
    ] as const;
    for (const key of PATH_KEYS) {
      if (patch[key] === true) {
        for (const other of PATH_KEYS) {
          if (other !== key) patch[other] = false;
        }
        break;
      }
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

    // SNAP-confirm cascade — backup safeguard. Once admin confirms
    // SNAP benefits, the Opportunity Scholarship auto-rebates the
    // family's tuition + transport, so any stale
    // `opportunity_scholarship_award_amount` value sitting on the
    // application rows would be misleading (admin would see a dollar
    // figure on a row whose tuition is now $0). We clear those
    // amounts to `null` on every active application for this family
    // / year so the rows reflect the post-confirm reality.
    //
    // Best-effort: failures here are logged but don't roll back the
    // confirmation itself — the scholarship row's `is_snap_confirmed`
    // flip is the source of truth, and the cascade can be retried by
    // un-confirming + re-confirming if it fails. Un-confirm doesn't
    // restore the prior amounts (admin re-enters them manually if
    // needed).
    if (
      "is_snap_confirmed" in patch &&
      patch.is_snap_confirmed === true
    ) {
      try {
        const familyId = updated.registration_families_id;
        const yearId = updated.registration_school_years_id;
        const apps = await xano.applications.getByFamilyId(familyId);
        const yearApps = apps.filter(
          (a) =>
            Number(a.registration_school_years_id) === yearId &&
            (a as { isActive?: boolean }).isActive !== false
        );
        await Promise.allSettled(
          yearApps.map((app) =>
            xano.applications.update(app.id, {
              opportunity_scholarship_award_amount: null,
            })
          )
        );
      } catch (err) {
        console.error(
          "[/api/admin/scholarships/[id]] SNAP cascade failed:",
          err
        );
      }
    }

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

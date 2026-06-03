import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import type { XanoScholarship } from "@/lib/xano";

/**
 * Admin-only PATCH for the per-year `registration_opportunity_scholarship`
 * row. Covers two groups of columns:
 *
 *   1. Document-confirmation + path flags the admin Scholarship
 *      Determination card writes (the booleans below).
 *   2. The family's scalar financial figures (household counts,
 *      income, assets, debts, family contribution, advocacy letter)
 *      so admin can fix a typo or transcribe a paper application on
 *      the family's behalf from the Financial Aid section of the
 *      family-detail page. The child tables (contributing members,
 *      homes, vehicles, benefits) and document uploads are still
 *      edited through the parent flow.
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
    // Legacy column — `*_admin` typed as int (teacher id). Newer
    // confirm triples (see `tax_document_confirm` below) use a text
    // column carrying the admin's display name.
    adminType: "id" as const,
  },
  {
    confirmKey: "is_unemployment_confirm",
    timeKey: "unemployment_confirm_time",
    adminKey: "unemployment_confirm_admin",
    adminType: "id" as const,
  },
  {
    confirmKey: "tax_document_confirm",
    timeKey: "tax_document_confirm_time",
    adminKey: "tax_document_confirm_admin",
    // Newer convention — stamps the admin's display name as text so
    // the family-page Documents table can render "Confirmed by Hunter"
    // without a teacher-id → name lookup. Matches the contributing-
    // members + benefits routes.
    adminType: "name" as const,
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
      // Tax-return confirm flag — same shape as the SNAP / unemployment
      // flags above; required on the Opportunity Scholarship path so
      // admin can verify the prior-year 1040 + schedules. The audit
      // pair (`tax_document_confirm_time` + `tax_document_confirm_admin`)
      // is auto-stamped below alongside the boolean flip.
      "tax_document_confirm",
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
      // letter, prior-year tax return). The columns hold Xano file
      // metadata arrays; the upload route returns the file metadata
      // which the client splices into the existing array before
      // PATCHing.
      "snap_benefits",
      "unemployment_letter",
      "tax_return",
      // ── Scalar financial figures — admin edits these on the
      //    family's behalf via the inline Edit on the Scholarship
      //    block (Financial Aid section of the family-detail page).
      //    Plain pass-through columns: no audit pairing, no cascade,
      //    so they fall straight through the `key in body` filter
      //    below. Child tables (members / homes / vehicles /
      //    benefits) and file uploads remain on the parent flow. ──
      "household_adults",
      "household_children",
      "no_contributing_member",
      "government_benefits",
      "business_income_monthly",
      "capital_gains_monthly",
      "child_support_monthly",
      "alimony_monthly",
      "trusts_monthly",
      "other_income_monthly",
      "describe_other_income",
      "assets_checking",
      "assets_savings",
      "assets_retirement_savings",
      "assets_stocks_bonds_securities",
      "assets_trusts_inheritance",
      "assets_business",
      "debts_credit_cards",
      "debts_student_loans",
      "debts_personal_loans",
      "family_contribution_per_month",
      "scholarship_advocacy_letter",
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
    const adminDisplayName = admin.name?.trim() || admin.email || "an admin";
    const now = Date.now();
    for (const pair of CONFIRM_PAIRS) {
      if (pair.confirmKey in patch) {
        const next = patch[pair.confirmKey] === true;
        patch[pair.timeKey] = next ? now : null;
        // Legacy int columns stamp the teacher id; newer text columns
        // (tax_document_confirm_admin) stamp the admin's display name
        // so the family-page Documents table can render
        // "Confirmed by Hunter" without a teacher-id → name lookup.
        if (pair.adminType === "name") {
          patch[pair.adminKey] = next ? adminDisplayName : "";
        } else {
          patch[pair.adminKey] = next ? adminTeacherId : 0;
        }
      }
    }

    const updated = await xano.scholarship.update(id, patch);

    // Note: confirming SNAP is an audit-only flip. It does NOT
    // touch any application row's billing math. Admin enters the
    // per-student "Remaining Amount Family Pays" manually on the
    // Determination card — the same way they do on every other
    // scholarship path — and that value is the single input that
    // drives `remaining_opportunity_amount`, `opportunity_award_amount`,
    // `tuition_sub_total`, and `monthly_amount`. An earlier
    // cascade here zeroed `remaining_opportunity_amount` across every
    // active app on SNAP-confirm; that auto-mutation surprised admins
    // who had typed non-zero values and got them wiped, so the entire
    // billing-mutation block (and its Stripe re-sync) is intentionally
    // gone. SUFS / OS coverage math is now 100% admin-driven.

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

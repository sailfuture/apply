import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";

/**
 * Admin POST — bootstrap a `registration_opportunity_scholarship`
 * row for a (family, year) when the parent hasn't opened the
 * Financial Aid section yet. Mostly used from the Financial Aid
 * card's empty state, where admin needs to set the family's
 * scholarship path (SNAP / Opportunity Scholarship / Opted out)
 * without waiting on the parent.
 *
 * Distinct from the parent-side `/api/scholarship` POST: that
 * route requires a Clerk-authenticated parent session and creates
 * the row scoped to the parent's own family. This admin route
 * accepts an explicit `registration_families_id` so admin can
 * bootstrap on behalf of any family.
 *
 * Idempotent: if a row already exists for the (family, year),
 * returns the existing row. Optional `path` body sets the matching
 * boolean flag at creation time (one of "isOpportunityScholarship"
 * / "isSNAPBenefits" / "isNotParticipating"); the other two flags
 * stay false. Mirrors the mutual-exclusion semantic the PATCH
 * route applies later.
 *
 * Body:
 *   - `familyId` (required)
 *   - `yearId` (required)
 *   - `path` (optional) — initial path flag to set true at create
 *     time. Accepts the same three flag names as the PATCH route.
 */
/**
 * Admin GET — the family's scholarship for a year, plus every child
 * row, resolved by `(familyId, yearId)`.
 *
 *   GET /api/admin/scholarships?familyId=F&yearId=Y
 *   → { scholarship, homes, vehicles, contributing_members, benefits }
 *   → 200 with `{ scholarship: null, ... }` when the family has no row.
 *
 * Exists because the `registration_application_by_family` query's
 * `_registration_opportunity_scholarship` addon comes back NULL for
 * every row (the application table has no FK to the scholarship — the
 * scholarship is keyed by family + year). Anything that read the
 * scholarship off that addon silently saw "no scholarship on file".
 * Resolve it here from the plain table instead, the same way
 * `xano.scholarship.getByFamilyAndYear` does everywhere else.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const familyId = Number(req.nextUrl.searchParams.get("familyId"));
    const yearId = Number(req.nextUrl.searchParams.get("yearId"));
    if (!Number.isFinite(familyId) || familyId <= 0) {
      return NextResponse.json(
        { error: "familyId is required" },
        { status: 400 }
      );
    }
    if (!Number.isFinite(yearId) || yearId <= 0) {
      return NextResponse.json(
        { error: "yearId is required" },
        { status: 400 }
      );
    }
    const scholarship = await xano.scholarship.getByFamilyAndYear(
      familyId,
      yearId
    );
    if (!scholarship?.id) {
      return NextResponse.json({
        scholarship: null,
        homes: [],
        vehicles: [],
        contributing_members: [],
        benefits: [],
      });
    }
    const payload = await xano.scholarship.getByIdWithChildren(
      scholarship.id
    );
    return NextResponse.json(payload);
  } catch (err) {
    return handleAdminError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = await req.json();
    const familyId = Number(body?.familyId);
    const yearId = Number(body?.yearId);
    if (!Number.isFinite(familyId) || familyId <= 0) {
      return NextResponse.json(
        { error: "familyId is required" },
        { status: 400 }
      );
    }
    if (!Number.isFinite(yearId) || yearId <= 0) {
      return NextResponse.json(
        { error: "yearId is required" },
        { status: 400 }
      );
    }

    // Optional initial path flag. Only accept the three known flag
    // names; anything else gets ignored so the row defaults to
    // "no path chosen yet" and admin can pick later.
    const VALID_PATHS = [
      "isOpportunityScholarship",
      "isSNAPBenefits",
      "isNotParticipating",
    ] as const;
    const rawPath = typeof body?.path === "string" ? body.path : "";
    const initialPath = (VALID_PATHS as readonly string[]).includes(rawPath)
      ? (rawPath as (typeof VALID_PATHS)[number])
      : null;

    // Idempotent — bail out with the existing row if admin clicks
    // a path twice in quick succession. The PATCH route handles
    // changing the path on an existing row.
    const existing = await xano.scholarship.getByFamilyAndYear(
      familyId,
      yearId
    );
    if (existing) {
      return NextResponse.json(existing);
    }

    const created = await xano.scholarship.create({
      registration_families_id: familyId,
      registration_school_years_id: yearId,
      household_adults: 0,
      household_children: 0,
      no_contributing_member: false,
      business_income_monthly: 0,
      capital_gains_monthly: 0,
      child_support_monthly: 0,
      alimony_monthly: 0,
      trusts_monthly: 0,
      other_income_monthly: 0,
      describe_other_income: "",
      assets_checking: 0,
      assets_savings: 0,
      assets_retirement_savings: 0,
      assets_stocks_bonds_securities: 0,
      assets_trusts_inheritance: 0,
      assets_business: 0,
      debts_credit_cards: 0,
      debts_student_loans: 0,
      debts_personal_loans: 0,
      government_benefits: false,
      snap_benefits: [],
      other_benefits: [],
      family_contribution_per_month: 0,
      scholarship_advocacy_letter: "",
      signature: null,
      unemployment_letter: [],
      last_edited: null,
      isOpportunityScholarship: initialPath === "isOpportunityScholarship",
      isSNAPBenefits: initialPath === "isSNAPBenefits",
      isNotParticipating: initialPath === "isNotParticipating",
    });
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    return handleAdminError(err);
  }
}

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { xano } from "@/lib/xano";
import {
  denyScholarshipFamilyAccess,
  scholarshipFamilyId,
} from "@/lib/scholarship-access";

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const yearId = req.nextUrl.searchParams.get("yearId");
  const familyIdParam = req.nextUrl.searchParams.get("familyId");

  if (!familyIdParam) {
    return NextResponse.json({ error: "familyId is required" }, { status: 400 });
  }

  // Ownership guard — admin or the family itself only. The family id
  // comes off the query string, so without this any signed-in user
  // could read any family's financial record (IDOR). Everything below
  // uses the validated number, never the raw param.
  const familyId = Number(familyIdParam);
  const denied = await denyScholarshipFamilyAccess(familyId);
  if (denied) return denied;

  if (yearId) {
    const scholarship = await xano.scholarship.getByFamilyAndYear(
      familyId,
      Number(yearId)
    );
    return NextResponse.json(scholarship);
  }

  // Always filter to the family here — a Xano list endpoint that
  // ignores the query param answers 200 with every family's rows.
  const onlyThisFamily = (rows: unknown) =>
    (Array.isArray(rows) ? rows : []).filter(
      (s) => scholarshipFamilyId(s) === familyId
    );

  try {
    const res = await fetch(
      `${process.env.XANO_API_BASE_URL}/registration_opportunity_scholarship?registration_families_id=${familyId}`,
      { cache: "no-store" }
    );
    if (!res.ok) {
      // Fallback to full scan
      return NextResponse.json(onlyThisFamily(await xano.scholarship.getAll()));
    }
    return NextResponse.json(onlyThisFamily(await res.json()));
  } catch {
    return NextResponse.json(onlyThisFamily(await xano.scholarship.getAll()));
  }
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const registration_families_id = Number(body?.registration_families_id);
  const registration_school_years_id = Number(
    body?.registration_school_years_id
  );

  if (!registration_families_id || !registration_school_years_id) {
    return NextResponse.json(
      { error: "registration_families_id and registration_school_years_id are required" },
      { status: 400 }
    );
  }

  // Ownership guard — admin or the family itself only. This route
  // returns the family's existing record when there is one, so an
  // unchecked family id in the body leaked it (IDOR).
  const denied = await denyScholarshipFamilyAccess(registration_families_id);
  if (denied) return denied;

  const existing = await xano.scholarship.getByFamilyAndYear(
    registration_families_id,
    registration_school_years_id
  );
  if (existing) {
    return NextResponse.json(existing);
  }

  const scholarship = await xano.scholarship.create({
    registration_families_id,
    registration_school_years_id,
    household_adults: 0,
    household_children: 0,
    no_contributing_member: false,
    // Monetary fields initialize as `null` ("untouched") so the
    // CurrencyInput placeholder shows on first load. A typed `0`
    // is preserved as `0` once the family enters one. Distinct
    // values let admin tell "didn't fill in" apart from "confirmed
    // no income from this source" downstream.
    business_income_monthly: null,
    capital_gains_monthly: null,
    child_support_monthly: null,
    alimony_monthly: null,
    trusts_monthly: null,
    other_income_monthly: null,
    describe_other_income: "",
    assets_checking: null,
    assets_savings: null,
    assets_retirement_savings: null,
    assets_stocks_bonds_securities: null,
    assets_trusts_inheritance: null,
    assets_business: null,
    debts_credit_cards: null,
    debts_student_loans: null,
    debts_personal_loans: null,
    government_benefits: false,
    snap_benefits: [],
    other_benefits: [],
    family_contribution_per_month: null,
    scholarship_advocacy_letter: "",
    signature: null,
    // Empty array on first create — populated when the family chooses
    // "no contributing members" and uploads proof.
    unemployment_letter: [],
    last_edited: null,
    isNotParticipating: false,
    isSNAPBenefits: false,
    isOpportunityScholarship: false,
  });

  return NextResponse.json(scholarship, { status: 201 });
}

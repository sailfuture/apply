import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { xano } from "@/lib/xano";

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const yearId = req.nextUrl.searchParams.get("yearId");
  const familyId = req.nextUrl.searchParams.get("familyId");

  if (!familyId) {
    return NextResponse.json({ error: "familyId is required" }, { status: 400 });
  }

  if (yearId) {
    const scholarship = await xano.scholarship.getByFamilyAndYear(
      Number(familyId),
      Number(yearId)
    );
    return NextResponse.json(scholarship);
  }

  try {
    const res = await fetch(
      `${process.env.XANO_API_BASE_URL}/registration_opportunity_scholarship?registration_families_id=${familyId}`,
      { cache: "no-store" }
    );
    if (!res.ok) {
      // Fallback to full scan
      const all = await xano.scholarship.getAll();
      const filtered = all.filter(
        (s) => s.registration_families_id === Number(familyId)
      );
      return NextResponse.json(filtered);
    }
    const results = await res.json();
    return NextResponse.json(Array.isArray(results) ? results : []);
  } catch {
    const all = await xano.scholarship.getAll();
    const filtered = all.filter(
      (s) => s.registration_families_id === Number(familyId)
    );
    return NextResponse.json(filtered);
  }
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { registration_families_id, registration_school_years_id } = body;

  if (!registration_families_id || !registration_school_years_id) {
    return NextResponse.json(
      { error: "registration_families_id and registration_school_years_id are required" },
      { status: 400 }
    );
  }

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

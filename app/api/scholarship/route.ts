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

  const all = await xano.scholarship.getAll();
  const filtered = all.filter(
    (s) => s.registration_families_id === Number(familyId)
  );
  return NextResponse.json(filtered);
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
    snap_benefits: null,
    other_benefits: null,
    family_contribution_per_month: 0,
    scholarship_advocacy_letter: "",
    signature: null,
    termination_letter: null,
    last_edited: null,
    isNotParticipating: false,
    isSNAPBenefits: false,
    isOpportunityScholarship: false,
  });

  return NextResponse.json(scholarship, { status: 201 });
}

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { xano } from "@/lib/xano";
import {
  denyScholarshipAccess,
  denyScholarshipFamilyAccess,
} from "@/lib/scholarship-access";

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const source_scholarship_id = Number(body?.source_scholarship_id);
  const registration_families_id = Number(body?.registration_families_id);
  const registration_school_years_id = Number(
    body?.registration_school_years_id
  );

  if (!source_scholarship_id || !registration_families_id || !registration_school_years_id) {
    return NextResponse.json(
      { error: "source_scholarship_id, registration_families_id, and registration_school_years_id are required" },
      { status: 400 }
    );
  }

  // Ownership guard on BOTH ends — admin, or a family copying its own
  // record into its own year. All three ids come off the body, so
  // unchecked this cloned any family's financial record (and uploaded
  // documents) into a row the caller could then read (IDOR).
  const deniedTarget = await denyScholarshipFamilyAccess(
    registration_families_id
  );
  if (deniedTarget) return deniedTarget;
  const deniedSource = await denyScholarshipAccess(source_scholarship_id);
  if (deniedSource) return deniedSource;

  const existing = await xano.scholarship.getByFamilyAndYear(
    registration_families_id,
    registration_school_years_id
  );
  if (existing) {
    return NextResponse.json(existing);
  }

  const source = await xano.scholarship.getById(source_scholarship_id);
  if (!source) {
    return NextResponse.json({ error: "Source scholarship not found" }, { status: 404 });
  }

  const newScholarship = await xano.scholarship.create({
    registration_families_id,
    registration_school_years_id,
    household_adults: source.household_adults,
    household_children: source.household_children,
    no_contributing_member: source.no_contributing_member,
    business_income_monthly: source.business_income_monthly,
    capital_gains_monthly: source.capital_gains_monthly,
    child_support_monthly: source.child_support_monthly,
    alimony_monthly: source.alimony_monthly,
    trusts_monthly: source.trusts_monthly,
    other_income_monthly: source.other_income_monthly,
    describe_other_income: source.describe_other_income,
    assets_checking: source.assets_checking,
    assets_savings: source.assets_savings,
    assets_retirement_savings: source.assets_retirement_savings,
    assets_stocks_bonds_securities: source.assets_stocks_bonds_securities,
    assets_trusts_inheritance: source.assets_trusts_inheritance,
    assets_business: source.assets_business,
    debts_credit_cards: source.debts_credit_cards,
    debts_student_loans: source.debts_student_loans,
    debts_personal_loans: source.debts_personal_loans,
    government_benefits: source.government_benefits,
    snap_benefits: [],
    other_benefits: [],
    family_contribution_per_month: source.family_contribution_per_month,
    scholarship_advocacy_letter: source.scholarship_advocacy_letter,
    signature: null,
    // Carry the unemployment / termination proof forward so a re-applying
    // family doesn't have to re-upload the same letter — they can replace
    // it on the new year if their employment situation has changed.
    unemployment_letter: Array.isArray(source.unemployment_letter)
      ? source.unemployment_letter
      : [],
    last_edited: Date.now(),
    isNotParticipating: source.isNotParticipating ?? false,
    isSNAPBenefits: source.isSNAPBenefits ?? false,
    isOpportunityScholarship: source.isOpportunityScholarship ?? false,
  });

  const newId = newScholarship.id;

  const [sourceMembers, sourceHomes, sourceVehicles, sourceBenefits] =
    await Promise.all([
      xano.scholarshipContributingMembers.getByScholarshipId(source_scholarship_id),
      xano.scholarshipHomes.getByScholarshipId(source_scholarship_id),
      xano.scholarshipVehicles.getByScholarshipId(source_scholarship_id),
      xano.scholarshipBenefits.getByScholarshipId(source_scholarship_id),
    ]);

  await Promise.all([
    ...sourceMembers.map((m) =>
      xano.scholarshipContributingMembers.create({
        registration_opportunity_scholarship_id: newId,
        first_name: m.first_name,
        last_name: m.last_name,
        address_1: m.address_1,
        address_2: m.address_2,
        city: m.city,
        state: m.state,
        zipcode: m.zipcode,
        estimated_annual_income: m.estimated_annual_income,
        isW2: m.isW2,
        isPayStubs: m.isPayStubs,
        w2: m.w2,
        paystub_1: m.paystub_1,
        paystub_2: m.paystub_2,
        paystub_3: m.paystub_3,
        paystub_4: m.paystub_4,
      })
    ),
    ...sourceHomes.map((h) =>
      xano.scholarshipHomes.create({
        registration_opportunity_scholarship_id: newId,
        type: h.type,
        address_1: h.address_1,
        address_2: h.address_2,
        city: h.city,
        state: h.state,
        zipcode: h.zipcode,
        total_value: h.total_value,
        outstanding_debt: h.outstanding_debt,
      })
    ),
    ...sourceVehicles.map((v) =>
      xano.scholarshipVehicles.create({
        registration_opportunity_scholarship_id: newId,
        type: v.type,
        car_make: v.car_make,
        car_model: v.car_model,
        car_year: v.car_year,
        total_value: v.total_value,
        remaining_debt: v.remaining_debt,
      })
    ),
    ...sourceBenefits.map((b) =>
      xano.scholarshipBenefits.create({
        registration_opportunity_scholarship_id: newId,
        type: b.type,
        amount_monthly: b.amount_monthly,
        // Carry the per-benefit documentation forward when a parent
        // re-applies — same idea as the rest of the row clone here.
        // Documentation is rarely year-specific (a Medicaid card is a
        // Medicaid card), so re-using it lets families avoid re-uploading
        // the same paperwork. They can still replace it on the new year.
        benefit_documentation: Array.isArray(b.benefit_documentation)
          ? b.benefit_documentation
          : [],
      })
    ),
  ]);

  const result = await xano.scholarship.getById(newId);
  return NextResponse.json(result, { status: 201 });
}

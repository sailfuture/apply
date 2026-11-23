import { xano } from "@/lib/xano";
import type { LunchLetterHousehold } from "@/lib/lunch-letter-prefill";

/**
 * What the family's scholarship application for the year tells us about
 * the household, shaped for the lunch letter's income section.
 *
 * Income rows come only from an Opportunity Scholarship application,
 * the one path where the family lists contributing members and their
 * income. A SNAP family gets the SNAP answer and nothing else; a family
 * that isn't participating gets nothing.
 *
 * Best-effort: any failed read returns an empty household, so the
 * letter still opens with those boxes blank for the parent to fill in.
 */

const EMPTY: LunchLetterHousehold = {
  receivesSnap: false,
  snapCaseNumber: "",
  adults: [],
  assistanceMonthly: 0,
  otherMonthly: 0,
  householdTotal: 0,
};

const num = (v: number | null | undefined) =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;

export async function loadLunchLetterHousehold(
  familyId: number,
  yearId: number
): Promise<LunchLetterHousehold> {
  try {
    const scholarship = await xano.scholarship.getByFamilyAndYear(
      familyId,
      yearId
    );
    if (!scholarship) return EMPTY;

    const receivesSnap = scholarship.isSNAPBenefits === true;
    const snapCaseNumber = receivesSnap
      ? (scholarship.snap_case_number ?? "").trim()
      : "";
    if (scholarship.isOpportunityScholarship !== true) {
      return { ...EMPTY, receivesSnap, snapCaseNumber };
    }

    const [members, benefits] = await Promise.all([
      scholarship.no_contributing_member === true
        ? Promise.resolve([])
        : xano.scholarshipContributingMembers.getByScholarshipId(scholarship.id),
      xano.scholarshipBenefits.getByScholarshipId(scholarship.id),
    ]);

    // SNAP / food assistance isn't cash income on this form: it is
    // reported through the case number question instead.
    const cashBenefits = benefits
      .filter((b) => !/snap|food/i.test(b.type ?? ""))
      .reduce((sum, b) => sum + num(b.amount_monthly), 0);

    return {
      receivesSnap,
      snapCaseNumber,
      adults: members.map((m) => ({
        first_name: m.first_name,
        last_name: m.last_name,
        annualEarnings: num(m.estimated_annual_income),
      })),
      assistanceMonthly:
        cashBenefits +
        num(scholarship.child_support_monthly) +
        num(scholarship.alimony_monthly),
      otherMonthly:
        num(scholarship.business_income_monthly) +
        num(scholarship.capital_gains_monthly) +
        num(scholarship.trusts_monthly) +
        num(scholarship.other_income_monthly),
      householdTotal:
        num(scholarship.household_adults) + num(scholarship.household_children),
    };
  } catch (err) {
    console.error("[lunch-letter] household lookup failed:", err);
    return EMPTY;
  }
}

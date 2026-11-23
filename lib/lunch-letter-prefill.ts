import { formatUSPhone } from "@/lib/phone";
import { pandaDocDate, schoolTodayIso } from "@/lib/pandadoc";

/**
 * Prefill values for the free and reduced lunch letter (the state's
 * household meal application), keyed by MERGE FIELD name.
 *
 * PandaDoc matches a prefill to a field by the field's "Merge Field"
 * property, not its Field ID. A field with no merge field set simply
 * isn't filled, so every name below is safe to send whether or not the
 * template uses it: the template opts in field by field.
 *
 * What we fill:
 *   - the children: the family's students for the year, one per row of
 *     the form's four-row grid (first name, last name, grade)
 *   - the SNAP question: "Yes" when the family is on the SNAP
 *     scholarship path, otherwise left unanswered, plus the case number
 *     when they gave one
 *   - the income section, for a family with an Opportunity Scholarship
 *     application: one row per contributing member (name, yearly
 *     earnings marked "Annual"), the family's monthly assistance and
 *     other income on the first row, and the household count
 *   - the adult signing: name, mailing address, phone, email
 *   - today's date
 *
 * What stays with the parent because the app doesn't hold it: middle
 * initials, the foster / migrant / runaway /
 * homeless boxes, child income and the SSN digits. The income figures
 * are what the family reported on the scholarship application, so every
 * box stays editable for them to correct before they sign. A household can include children who aren't SailFuture
 * students, so rows past our students stay blank, not "N/A".
 */

/** The form's child grid has four rows. */
export const LUNCH_LETTER_CHILD_ROWS = 4;

/**
 * Radio prefills have to match the option's label in PandaDoc exactly.
 * The template's radio groups sit on top of a PDF that prints its own
 * captions, so their options still carry PandaDoc's default labels
 * ("Option 1", "Option 2", ...), numbered left to right. Verified against
 * the API on 2026-11-22: "Option N" fills, "Yes" / "Annual" do not.
 * If the options are ever renamed in the template, change these.
 */

/** SNAP question: NO is the first circle, YES the second. */
export const LUNCH_LETTER_SNAP_YES = "Option 2";

/** The form's adult income grid has five rows. */
export const LUNCH_LETTER_ADULT_ROWS = 5;

/** "How often received?": Weekly, Every 2 Weeks, 2x Month, Monthly, and
 *  (earnings only) Annual. The app stores earnings per year and
 *  everything else per month. */
export const LUNCH_LETTER_FREQ_ANNUAL = "Option 5";
export const LUNCH_LETTER_FREQ_MONTHLY = "Option 4";

/** The household as the scholarship application describes it. Built by
 *  `loadLunchLetterHousehold`. */
export interface LunchLetterHousehold {
  /** The family is on the SNAP scholarship path for this year. */
  receivesSnap: boolean;
  /** Their SNAP / TANF / FDPIR case number. "" = not entered. */
  snapCaseNumber: string;
  /** Contributing members: the adults with income. */
  adults: {
    first_name?: string | null;
    last_name?: string | null;
    annualEarnings: number;
  }[];
  /** Cash benefits + child support + alimony, per month, family-wide. */
  assistanceMonthly: number;
  /** Business, capital gains, trusts and other income, per month. */
  otherMonthly: number;
  /** Adults plus children. 0 = unknown. */
  householdTotal: number;
}

/** Whole dollars with thousands separators; the form prints the "$". */
const dollars = (n: number) => Math.round(n).toLocaleString("en-US");

export interface LunchLetterChild {
  first_name?: string | null;
  last_name?: string | null;
  /** The grade the student is entering for this school year. */
  grade?: string | null;
}

export interface LunchLetterAdult {
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  address_line_1?: string | null;
  address_line_2?: string | null;
  city?: string | null;
  state?: string | null;
  zipcode?: string | null;
}

const clean = (v: string | null | undefined) => (v ?? "").trim();

export function lunchLetterPrefill(input: {
  children: LunchLetterChild[];
  household: LunchLetterHousehold;
  /** The adult signing: the signed-in parent, or the primary parent on
   *  an admin send. Null when their record couldn't be loaded. */
  adult: LunchLetterAdult | null;
}): Record<string, string> {
  const out: Record<string, string> = {};

  input.children.slice(0, LUNCH_LETTER_CHILD_ROWS).forEach((child, i) => {
    const n = i + 1;
    out[`child_${n}_first_name`] = clean(child.first_name);
    out[`child_${n}_last_name`] = clean(child.last_name);
    out[`child_${n}_grade`] = clean(child.grade);
  });

  // Only ever answered "Yes": a family that isn't on the SNAP path in
  // Apply may still receive TANF or FDPIR, which the same question
  // covers, so "No" is theirs to pick.
  const household = input.household;
  if (household.receivesSnap) {
    out.snap_benefits = LUNCH_LETTER_SNAP_YES;
    out.snap_case_number = clean(household.snapCaseNumber);
  }

  // Income grid: one row per contributing member.
  household.adults.slice(0, LUNCH_LETTER_ADULT_ROWS).forEach((member, i) => {
    const n = i + 1;
    out[`adult_${n}_name`] =
      `${clean(member.first_name)} ${clean(member.last_name)}`.trim();
    if (member.annualEarnings > 0) {
      out[`adult_${n}_earnings`] = dollars(member.annualEarnings);
      out[`adult_${n}_earnings_frequency`] = LUNCH_LETTER_FREQ_ANNUAL;
    }
  });
  // Assistance and other income are stored once per family, not per
  // adult, so they go on the first row for the parent to move if they
  // belong to someone else. Written even when no member is listed.
  if (household.assistanceMonthly > 0) {
    out.adult_1_assistance = dollars(household.assistanceMonthly);
    out.adult_1_assistance_frequency = LUNCH_LETTER_FREQ_MONTHLY;
  }
  if (household.otherMonthly > 0) {
    out.adult_1_other = dollars(household.otherMonthly);
    out.adult_1_other_frequency = LUNCH_LETTER_FREQ_MONTHLY;
  }
  if (household.householdTotal > 0) {
    out.household_total = String(household.householdTotal);
  }

  const adult = input.adult;
  if (adult) {
    const name = `${clean(adult.first_name)} ${clean(adult.last_name)}`.trim();
    out.adult_full_name = name;
    out.mailing_address = [clean(adult.address_line_1), clean(adult.address_line_2)]
      .filter(Boolean)
      .join(", ");
    out.mailing_city = clean(adult.city);
    out.mailing_state = clean(adult.state);
    out.mailing_zip = clean(adult.zipcode);
    out.adult_phone = formatUSPhone(adult.phone);
    out.adult_email = clean(adult.email);
  }

  out.today_date = pandaDocDate(schoolTodayIso());
  return out;
}

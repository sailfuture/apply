/**
 * Who a parent is told to write to, by where the family is with the
 * school (user decision, 2026-11-22):
 *
 *   - applying, or submitted and under review → admissions
 *   - accepted onward (registration, then enrolled) → the dean's office
 *
 * The phone number is the office Main Line on every screen
 * (`MAIN_LINE` in lib/school-phones.ts).
 *
 * Before this the address was whatever each screen happened to carry:
 * the header said admissions on every page, the application overview
 * said the dean, the "under review" screens gave a staff member's own
 * number, and one page could show two different addresses at once.
 * Screens import from here instead of typing an address.
 *
 * Client-safe: no imports.
 */

export const ADMISSIONS_EMAIL = "admissions@sailfuture.org";
export const DEAN_EMAIL = "dean@sailfuture.org";

/** The address for a family at this stage. `accepted` covers everything
 *  from acceptance on: the registration steps and the enrolled pages. */
export function parentContactEmail(accepted: boolean): string {
  return accepted ? DEAN_EMAIL : ADMISSIONS_EMAIL;
}

/**
 * The person named on the "Need Help?" panel. One name, with the
 * stage's address and the Main Line beside it rather than a personal
 * email and phone, so a staffing change is one edit here and never
 * leaves a parent with a number nobody answers.
 */
export const HELP_CONTACT = {
  name: "Ms. Laura Manke",
  title: "Assistant Head of School",
} as const;

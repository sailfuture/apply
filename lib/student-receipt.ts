/**
 * Pure, client-safe tuition-receipt math.
 *
 * Lives apart from `lib/per-student-billing.ts` on purpose: that
 * module reaches for Xano + the server-only Stripe client, so the
 * admin receipt components ("use client") can't import from it.
 */

/**
 * The per-student figures a tuition receipt renders, read from the
 * application row's SAVED billing columns and nothing else.
 *
 * Deliberately does NOT fall back to year-level policy
 * (`school_year.annual_fees`, the SUFS tier table) the way the admin
 * receipts used to. A student whose Scholarship Determination was
 * never saved has null columns, and substituting the year defaults
 * printed a subtotal the family is not being invoiced for: the admin
 * receipt showed a full $500 admin fee plus a tier-derived award for
 * such a student, while the Year summary, the Start Monthly Billing
 * button, and the parent's own `/dashboard/tuition` view all counted
 * the same student as $0. Absent columns now read as absent, and
 * `hasSavedDetermination` lets the surface say so out loud.
 */
export interface StudentReceiptAmounts {
  /** Stored `sufs_amount` (the only home of a custom tier's typed
   *  value), 0 when the column is unset. */
  sufsAmount: number;
  /** Stored per-student `annual_fee`, 0 when unset. */
  annualFee: number;
  /** Stored `remaining_opportunity_amount` — admin's "Remaining
   *  Amount Family Pays" input — 0 when unset. */
  remainingTuition: number;
  /** Annual family-paid total (`remainingTuition + annualFee`). */
  subtotal: number;
  /** What Stripe bills for this student each month: the stored
   *  `monthly_amount` that becomes their SubscriptionItem, falling
   *  back to `subtotal / 12` only for a row saved before the column
   *  existed. */
  monthly: number;
  /** False when the row carries none of the billing columns — every
   *  figure above is 0 by absence, not by decision, and the student
   *  contributes nothing to the family's billed total. */
  hasSavedDetermination: boolean;
}

export function resolveStudentReceiptAmounts(app: {
  sufs_amount?: number | null;
  annual_fee?: number | null;
  remaining_opportunity_amount?: number | null;
  monthly_amount?: number | null;
}): StudentReceiptAmounts {
  const stored = (v: number | null | undefined): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const sufs = stored(app.sufs_amount);
  const fee = stored(app.annual_fee);
  const remaining = stored(app.remaining_opportunity_amount);
  const monthly = stored(app.monthly_amount);
  const subtotal = (remaining ?? 0) + (fee ?? 0);
  return {
    sufsAmount: sufs ?? 0,
    annualFee: fee ?? 0,
    remainingTuition: remaining ?? 0,
    subtotal,
    monthly: monthly ?? Math.round((subtotal / 12) * 100) / 100,
    hasSavedDetermination:
      sufs != null || fee != null || remaining != null || monthly != null,
  };
}

/**
 * Family monthly total — the SUM of each student's own rounded
 * monthly, NOT the annual grand total divided by 12.
 *
 * Stripe bills one SubscriptionItem per student at that student's
 * rounded `monthly_amount`, so two students at $41.67 are invoiced
 * $83.34; the receipts' old `grandTotal / 12` printed $83.33 and
 * disagreed by a cent with the Year summary directly above it.
 */
export function sumStudentMonthly(
  rows: Array<{ monthly: number }>
): number {
  return (
    Math.round(rows.reduce((acc, r) => acc + r.monthly, 0) * 100) / 100
  );
}

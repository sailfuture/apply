import { buildMonthSlots, parseAnchorDate } from "@/lib/billing-schedule";

/**
 * Tuition payment plans.
 *
 * What a student owes for the year is spread over monthly payments.
 * The billing year is the 12 months from the school year's
 * `billing_start_date` (August through July), every plan ends with the
 * last of those months, and a student's first payment is the month
 * they start (or the month billing begins, if that is later). A
 * student starting in January pays in 7 payments, January through
 * July, not 12. (How much they owe for a shortened year is the second
 * half of this file.)
 *
 * A family gets ONE invoice a month, but each student's payments run
 * over that student's own months: see "One invoice, each student from
 * their own month" below.
 *
 * `registration_application.payment_count` stores the number of
 * payments (1–12). The last payment is always the year's final month,
 * so the count alone fixes the first one: month slot `12 − count`.
 * Rows saved before the column existed hold nothing and bill the way
 * they always did, over 12.
 *
 * Month slots are the SAME ones the billing schedule draws
 * (`buildMonthSlots`: UTC, anchored on `billing_start_date`), so "how
 * many payments are left" cannot disagree with the schedule a family
 * sees. One consequence: late in the evening (Eastern) on the last day
 * of a month, UTC has already rolled over and the next month counts as
 * the first payment. Stripe cycles in UTC too, so the count and the
 * invoices still agree.
 *
 * Pure and client-safe.
 */

/** Payments in a full billing year. */
export const FULL_YEAR_PAYMENTS = 12;

/** A stored `payment_count` when it holds a real plan (1–12), else
 *  null. Xano hands back null (or 0) for a row with no plan yet. */
export function storedPaymentCount(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= FULL_YEAR_PAYMENTS
    ? value
    : null;
}

/** The count a row bills over: its plan, or 12 for a row saved before
 *  plans existed. */
export function resolvedPaymentCount(value: unknown): number {
  return storedPaymentCount(value) ?? FULL_YEAR_PAYMENTS;
}

function hasBillingStart(
  billingStartDate: string | null | undefined
): billingStartDate is string {
  return (
    !!billingStartDate &&
    Number.isFinite(Date.parse(`${billingStartDate}T00:00:00Z`))
  );
}

function yearSlots(billingStartDate: string) {
  return buildMonthSlots(parseAnchorDate(billingStartDate));
}

/**
 * Which of the billing year's month slots `atMs` falls in: 0–11, −1
 * before the year starts, 12 once it is over. Null when the year has
 * no (usable) billing start date, so there is no schedule to count on.
 */
export function billingSlotAt(
  billingStartDate: string | null | undefined,
  atMs: number
): number | null {
  if (!hasBillingStart(billingStartDate)) return null;
  const slots = yearSlots(billingStartDate);
  if (atMs < slots[0].periodStart) return -1;
  for (const slot of slots) {
    if (atMs < slot.periodEndExclusive) return slot.slotIndex;
  }
  return FULL_YEAR_PAYMENTS;
}

/**
 * When the billing year ends (unix ms): the start of the month after
 * its 12th. An invoice dated before this belongs to the year; one
 * dated on or after it is next year's. Null with no billing start
 * date.
 */
export function billingYearEndMs(
  billingStartDate: string | null | undefined
): number | null {
  if (!hasBillingStart(billingStartDate)) return null;
  return yearSlots(billingStartDate)[FULL_YEAR_PAYMENTS - 1].periodEndExclusive;
}

/**
 * How many payments a plan has when its first invoice goes out at
 * `firstInvoiceMs`: one per month slot from that one through the
 * year's last. 12 before the year starts (or with no billing start
 * date); never less than 1.
 */
export function paymentsFrom(
  billingStartDate: string | null | undefined,
  firstInvoiceMs: number
): number {
  const slot = billingSlotAt(billingStartDate, firstInvoiceMs);
  if (slot == null || slot < 0) return FULL_YEAR_PAYMENTS;
  return Math.max(FULL_YEAR_PAYMENTS - slot, 1);
}

/** Start (unix ms) of the month slot a `count`-payment plan's first
 *  payment falls in. Null with no billing start date. */
export function planFirstSlotStartMs(
  billingStartDate: string | null | undefined,
  count: number
): number | null {
  if (!hasBillingStart(billingStartDate)) return null;
  const slot = yearSlots(billingStartDate)[FULL_YEAR_PAYMENTS - count];
  return slot ? slot.periodStart : null;
}

/* ─────────────── One invoice, each student from their own month ───────────────
 *
 * Siblings share the family's one monthly invoice, but not a start
 * month. A sibling who starts in January owes less tuition than one
 * who started in August, and is not billed before January just because
 * a brother or sister already is. Their line joins the family's invoice
 * on the first one dated in or after their own first payment month, and
 * the invoice carries both students from then on.
 *
 * So when a family's billing starts, or a student is being put on a
 * subscription that is already running, a student whose month hasn't
 * come is left off for now ("scheduled") and added when it opens.
 */

/**
 * Whether a student's plan has reached its first payment on an invoice
 * schedule that has `paymentsLeft` invoices still to send this year,
 * the next one included. A 7-payment plan (first payment January) is
 * not due while 8 or more remain. A row with no plan stored was priced
 * before plans existed and bills as soon as it can, as it always did.
 */
export function planIsDue(planCount: unknown, paymentsLeft: number): boolean {
  const stored = storedPaymentCount(planCount);
  return stored == null || paymentsLeft <= stored;
}

/**
 * One sentence per student left off the invoice for now because their
 * first payment month hasn't come (the Start Monthly Billing response's
 * `scheduled`). Null when everyone is being billed.
 */
export function describeScheduledStudents(
  scheduled:
    | Array<{ studentName: string; firstMonthLabel: string | null }>
    | null
    | undefined
): string | null {
  if (!scheduled || scheduled.length === 0) return null;
  const lines = scheduled.map((s) =>
    s.firstMonthLabel
      ? `${s.studentName} starts paying in ${s.firstMonthLabel}`
      : `${s.studentName} starts paying later this year`
  );
  return `Not on the invoice yet: ${lines.join("; ")}. They are added to this family's invoice automatically when that month opens.`;
}

/* ─────────────── Tuition for a student who starts mid-year ───────────────
 *
 * A student is charged tuition for the months they attend: the month
 * they START through the end of the billing year. A January start is 7
 * of 12 months, so 7/12 of the year's tuition. (The annual fee is not
 * prorated.)
 *
 * The start month is not the month the family registers — a family can
 * enroll in November for a January start — and it is not the number of
 * payments either: a student who started in November but whose billing
 * begins in December still owes 9 months of tuition, in 8 payments. So
 * the months of tuition live on the row as the prorated figure itself,
 * `registration_application.tuition_total`, and are read back from its
 * ratio to the year's tuition. `payment_count` only ever says how many
 * payments that amount is spread over.
 */

/** Tuition for `months` of the 12-month year, to the cent. Anything
 *  that isn't a whole number of months from 1 to 12 is a full year. */
export function proratedTuition(yearTuition: number, months: unknown): number {
  const count = resolvedPaymentCount(months);
  if (count >= FULL_YEAR_PAYMENTS) return yearTuition;
  return Math.round(((yearTuition * count) / FULL_YEAR_PAYMENTS) * 100) / 100;
}

/**
 * How many months of tuition a stored `tuition_total` stands for, out
 * of the year's tuition: 16,054.50 of 27,522 is 7. A row with nothing
 * stored, or saved before proration existed (it holds the full year),
 * reads as 12.
 */
export function tuitionMonthsOf(
  tuitionTotal: unknown,
  yearTuition: unknown
): number {
  if (
    typeof tuitionTotal !== "number" ||
    typeof yearTuition !== "number" ||
    !Number.isFinite(tuitionTotal) ||
    !Number.isFinite(yearTuition) ||
    tuitionTotal <= 0 ||
    yearTuition <= 0
  ) {
    return FULL_YEAR_PAYMENTS;
  }
  const months = Math.round((tuitionTotal / yearTuition) * FULL_YEAR_PAYMENTS);
  return Math.min(Math.max(months, 1), FULL_YEAR_PAYMENTS);
}

/** The receipt's tuition line: "Annual Tuition" for a full year,
 *  "Tuition (Jan – Jul, 7 of 12 months)" for a mid-year start. */
export function tuitionLineLabel(
  billingStartDate: string | null | undefined,
  months: number
): string {
  if (months >= FULL_YEAR_PAYMENTS) return "Annual Tuition";
  const range = planRangeLabel(billingStartDate, months);
  const of12 = `${months} of ${FULL_YEAR_PAYMENTS} months`;
  return range ? `Tuition (${range}, ${of12})` : `Tuition (${of12})`;
}

/**
 * The tuition line of one student's receipt: the stored
 * `tuition_total` (what their determination charged), how many months
 * it stands for, and the label to print beside it. A row with nothing
 * stored shows the year's tuition, as every receipt did before
 * proration existed.
 */
export function studentTuitionLine(
  app: { tuition_total?: number | null },
  yearTuition: number,
  billingStartDate: string | null | undefined
): { tuition: number; months: number; label: string } {
  const stored = app.tuition_total;
  const tuition =
    typeof stored === "number" && Number.isFinite(stored) && stored > 0
      ? stored
      : yearTuition;
  const months = tuitionMonthsOf(tuition, yearTuition);
  return { tuition, months, label: tuitionLineLabel(billingStartDate, months) };
}

/**
 * Every month a student can start in, first month of the billing year
 * first: August (12 months) down to July (1). Unlike a first payment,
 * a start month can be in the past — the student is already attending.
 * Empty with no billing start date.
 */
export function startMonthOptions(
  billingStartDate: string | null | undefined
): PaymentPlanOption[] {
  if (!hasBillingStart(billingStartDate)) return [];
  const options: PaymentPlanOption[] = [];
  for (let count = FULL_YEAR_PAYMENTS; count >= 1; count -= 1) {
    const label = planFirstMonthLabel(billingStartDate, count);
    if (label) options.push({ count, firstMonthLabel: label });
  }
  return options;
}

/** The monthly payment for a yearly amount spread over `count`
 *  payments, rounded to cents the way every stored figure is. */
export function monthlyForPlan(annualTotal: number, count: number): number {
  return Math.round((annualTotal / count) * 100) / 100;
}

function monthName(ms: number, style: "short" | "long", withYear: boolean) {
  return new Date(ms).toLocaleDateString("en-US", {
    month: style,
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  });
}

/** "January 2027": the month a `count`-payment plan starts in. */
export function planFirstMonthLabel(
  billingStartDate: string | null | undefined,
  count: number
): string | null {
  const start = planFirstSlotStartMs(billingStartDate, count);
  return start == null ? null : monthName(start, "long", true);
}

/** "Jan – Jul": first and last payment months of a plan. Null with no
 *  billing start date. */
export function planRangeLabel(
  billingStartDate: string | null | undefined,
  count: number
): string | null {
  if (!hasBillingStart(billingStartDate)) return null;
  const slots = yearSlots(billingStartDate);
  const first = slots[FULL_YEAR_PAYMENTS - count];
  const last = slots[FULL_YEAR_PAYMENTS - 1];
  if (!first || !last) return null;
  if (count === 1) return monthName(last.periodStart, "short", false);
  return `${monthName(first.periodStart, "short", false)} – ${monthName(last.periodStart, "short", false)}`;
}

/** "7 months" / "1 month". */
export function paymentCountLabel(count: number): string {
  return `${count} ${count === 1 ? "month" : "months"}`;
}

/**
 * The parenthetical on a "Monthly Payment" total: "Jan – Jul, 7
 * months". `counts` are the stored plans of the students in the total
 * (null / missing = a 12-payment row). When they differ, the one
 * monthly figure doesn't run the same number of months for everyone,
 * so the label says that instead of naming a range.
 */
export function planSummaryLabel(
  billingStartDate: string | null | undefined,
  counts: unknown[]
): string {
  const resolved = Array.from(new Set(counts.map(resolvedPaymentCount)));
  if (resolved.length > 1) return "months vary by student";
  const count = resolved[0] ?? FULL_YEAR_PAYMENTS;
  const range =
    planRangeLabel(billingStartDate, count) ??
    (count === FULL_YEAR_PAYMENTS ? "Aug – Jul" : null);
  return range
    ? `${range}, ${paymentCountLabel(count)}`
    : paymentCountLabel(count);
}

/**
 * One sentence per student whose monthly amount moved when their
 * billing started (the Start Monthly Billing response's
 * `planChanges`). Null when nothing moved. The button showed the
 * amount on file, so the admin is told what was actually billed.
 */
export function describePlanChanges(
  changes:
    | Array<{
        studentName: string;
        fromCount: number;
        toCount: number;
        fromMonthly: number;
        toMonthly: number;
      }>
    | null
    | undefined
): string | null {
  if (!changes || changes.length === 0) return null;
  const usd = (value: number) =>
    value.toLocaleString("en-US", { style: "currency", currency: "USD" });
  const lines = changes.map(
    (c) =>
      `${c.studentName}: ${c.toCount} monthly payment${c.toCount === 1 ? "" : "s"} of ${usd(c.toMonthly)} (was ${usd(c.fromMonthly)} over ${c.fromCount})`
  );
  return `Payment plan set for the months left this year. ${lines.join("; ")}. The yearly amount is unchanged.`;
}

export interface PaymentPlanOption {
  /** Number of payments. */
  count: number;
  /** "January 2027": the month the first payment falls in. */
  firstMonthLabel: string;
}

/**
 * The plans a not-yet-billed student can be put on at `nowMs`: a first
 * payment this month, or any later month of the billing year. Longest
 * plan first. Empty with no billing start date.
 */
export function availablePlanOptions(
  billingStartDate: string | null | undefined,
  nowMs: number
): PaymentPlanOption[] {
  if (!hasBillingStart(billingStartDate)) return [];
  const open = paymentsFrom(billingStartDate, nowMs);
  const options: PaymentPlanOption[] = [];
  for (let count = open; count >= 1; count -= 1) {
    const label = planFirstMonthLabel(billingStartDate, count);
    if (label) options.push({ count, firstMonthLabel: label });
  }
  return options;
}

/**
 * A family's scheduled amount for one month slot: each student's
 * monthly counts only from the slot their own plan starts in. Null
 * when no student is scheduled that month.
 */
export function scheduledCentsForSlot(
  apps: Array<{ monthly_amount?: number | null; payment_count?: unknown }>,
  slotIndex: number
): number | null {
  let cents = 0;
  let any = false;
  for (const app of apps) {
    const monthly = app.monthly_amount;
    if (typeof monthly !== "number" || !Number.isFinite(monthly)) continue;
    const firstSlot =
      FULL_YEAR_PAYMENTS - resolvedPaymentCount(app.payment_count);
    if (slotIndex < firstSlot) continue;
    cents += Math.round(monthly * 100);
    any = true;
  }
  return any && cents > 0 ? cents : null;
}

/**
 * What a family pays across the billing year: each student's monthly
 * times their own number of payments. Null when no student has a
 * monthly amount.
 */
export function planYearTotalCents(
  apps: Array<{ monthly_amount?: number | null; payment_count?: unknown }>
): number | null {
  let cents = 0;
  let any = false;
  for (const app of apps) {
    const monthly = app.monthly_amount;
    if (typeof monthly !== "number" || !Number.isFinite(monthly)) continue;
    cents += Math.round(monthly * 100) * resolvedPaymentCount(app.payment_count);
    any = true;
  }
  return any && cents > 0 ? cents : null;
}

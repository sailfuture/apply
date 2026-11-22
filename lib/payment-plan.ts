import { buildMonthSlots, parseAnchorDate } from "@/lib/billing-schedule";

/**
 * Tuition payment plans.
 *
 * A family owes the same yearly amount whenever they enroll: nothing
 * is prorated for a late start. What changes is how many monthly
 * payments that amount is spread over. The billing year is the 12
 * months from the school year's `billing_start_date` (August through
 * July), every plan ends with the last of those months, and a family's
 * first payment is the month they enroll. A family starting in January
 * pays the whole amount in 7 payments (January through July), not 12.
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

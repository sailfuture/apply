import type { XanoPaymentTransaction } from "@/lib/xano";

/**
 * Shared helpers for the two 12-month billing-schedule endpoints
 * (parent `/api/billing/schedule` and admin
 * `/api/admin/families/[id]/billing/schedule`). Extracted so the slot
 * math and invoice→month mapping can only ever disagree with itself
 * in one place.
 *
 * Two correctness rules live here:
 *
 *   1. Invoices map to month slots by `period_end`, not
 *      `period_start`. A Stripe subscription invoice's period covers
 *      the span since the PREVIOUS invoice — the renewal generated on
 *      Sep 1 carries period Aug 1 → Sep 1. Keying on period_start put
 *      every invoice one month early, and pushed the FIRST invoice
 *      (whose period covers the pre-anchor trial: creation → Aug 1)
 *      into a month before the schedule even starts, i.e. invisible.
 *      `period_end` is the billing-cycle date for both shapes.
 *
 *   2. Month slots use overflow-safe day clamping. Anchors on day
 *      29–31 (e.g. `billing_start_date = 2026-08-31`) naively add
 *      `(month + i, day 31)`, which JS rolls into the following month
 *      (Feb 31 → Mar 3) — producing two slots with the same month
 *      key, a skipped February, and the same invoice rendered twice.
 */

export interface ScheduleMonthSlot {
  slotIndex: number;
  /** Unix ms for the UTC start of this slot. */
  periodStart: number;
  /** Unix ms for the start of the NEXT slot — exclusive end. */
  periodEndExclusive: number;
  /** Human label ("August 2026") for the row. */
  monthLabel: string;
}

export function parseAnchorDate(billingStartDate: string | null): Date {
  if (billingStartDate) {
    // Treat as UTC midnight to match the convention in the
    // subscription-create flow. Date.parse interprets "YYYY-MM-DD"
    // as UTC midnight per the spec.
    const ms = Date.parse(`${billingStartDate}T00:00:00Z`);
    if (Number.isFinite(ms)) return new Date(ms);
  }
  // Fallback: first day of the current calendar month at UTC midnight.
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** Day-clamped date construction: (2026, Feb, 31) → Feb 28, not Mar 3. */
function utcDateClamped(year: number, monthIndex: number, day: number): Date {
  // Normalize the month first (monthIndex may exceed 11), then clamp
  // the day to that month's length.
  const firstOfMonth = new Date(Date.UTC(year, monthIndex, 1));
  const y = firstOfMonth.getUTCFullYear();
  const m = firstOfMonth.getUTCMonth();
  const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(day, daysInMonth)));
}

export function buildMonthSlots(anchor: Date): ScheduleMonthSlot[] {
  const out: ScheduleMonthSlot[] = [];
  const anchorDay = anchor.getUTCDate();
  for (let i = 0; i < 12; i += 1) {
    const start = utcDateClamped(
      anchor.getUTCFullYear(),
      anchor.getUTCMonth() + i,
      anchorDay
    );
    const end = utcDateClamped(
      anchor.getUTCFullYear(),
      anchor.getUTCMonth() + i + 1,
      anchorDay
    );
    out.push({
      slotIndex: i,
      periodStart: start.getTime(),
      periodEndExclusive: end.getTime(),
      monthLabel: start.toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }),
    });
  }
  return out;
}

export function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * The month key an invoice belongs to — its billing-cycle date. See
 * rule 1 above: `period_end` is the cycle boundary the invoice was
 * generated on; `period_start` is the previous one. Falls back to
 * period_start for degenerate rows (period_end missing/0).
 */
export function transactionMonthKey(tx: XanoPaymentTransaction): string {
  const basis = tx.period_end || tx.period_start || 0;
  return monthKey(new Date(basis));
}

/**
 * Pick one invoice per month slot: newest cycle wins when Stripe ever
 * issues two invoices in the same month (manual out-of-cycle invoice).
 */
export function indexTransactionsByMonth(
  transactions: XanoPaymentTransaction[]
): Map<string, XanoPaymentTransaction> {
  const byMonth = new Map<string, XanoPaymentTransaction>();
  for (const t of transactions) {
    const k = transactionMonthKey(t);
    const existing = byMonth.get(k);
    const tBasis = t.period_end || t.period_start || 0;
    const eBasis = existing
      ? existing.period_end || existing.period_start || 0
      : -1;
    if (!existing || tBasis > eBasis) byMonth.set(k, t);
  }
  return byMonth;
}

/**
 * Map Stripe's invoice status to the friendlier UI label.
 *   - `paid` → `paid`
 *   - `uncollectible` → `failed` (Stripe's terminal failure state;
 *     in-flight payment failures keep the invoice `open`)
 *   - `void` → `void`
 *   - `open` / `draft` / anything else → `open`
 */
export function stripeStatusToUi(
  status: string
): "open" | "paid" | "failed" | "void" {
  switch (status) {
    case "paid":
      return "paid";
    case "void":
      return "void";
    case "uncollectible":
      return "failed";
    case "open":
    case "draft":
    default:
      return "open";
  }
}

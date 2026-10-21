/**
 * Tuition billing texts — which invoices are due a text today.
 *
 * The daily reminder cron texts the family's primary parent (through
 * `sendSms`, so the Main Line in Quo when that's the phone system):
 *
 *   - Due soon: once, when an open invoice comes due within the next
 *     `BILLING_UPCOMING_LEAD_DAYS` days. Skipped for families on
 *     autopay, since Stripe charges the invoice on its due date.
 *   - Past due: 7, 14 and 21 days after the due date, the same days as
 *     the past-due emails (`PAST_DUE_EMAIL_STAGES`). Only the highest
 *     stage an invoice has reached goes out, and each (invoice, stage)
 *     once, so an invoice already a month overdue gets the 21-day text
 *     once rather than all three.
 *
 * Every text carries two links: the invoice's branded pay link
 * (`/pay/<invoice>` → Stripe's hosted page) and `/autopay` (the
 * Tuition page's Autopay panel, behind sign-in).
 *
 * Several invoices reaching a past-due stage on the same day share one
 * text, which leads with the oldest and prints the account's total.
 *
 * This module is the pure planning half; the send half (dedupe against
 * the SMS log, render, send) is in lib/sms/triggers.ts. Type-only
 * imports, so a local dry-run script can load it as-is.
 */

import type { XanoPaymentTransaction } from "@/lib/xano";
import { pastDueBalance, pastDueStage } from "@/lib/billing-past-due";

/** Days ahead of the due date the "due soon" text goes out. */
export const BILLING_UPCOMING_LEAD_DAYS = 3;

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** The 7/14/21-day texts shipped 2026-10-21. A stage an invoice reached
 *  before then is never texted, so shipping didn't text the backlog
 *  (those families already had the old on-the-due-date text and the
 *  past-due emails); its next stage still goes out. UTC calendar day,
 *  like the stage count itself. */
const PAST_DUE_TEXTS_FROM_DAY = Math.floor(Date.UTC(2026, 9, 21) / ONE_DAY_MS);

export interface PlannedUpcomingText {
  familyId: number;
  invoiceId: string;
  /** Still owed on the invoice. */
  amountCents: number;
  /** Unix ms. */
  dueDate: number;
  /** Cents past due on the family's other invoices. */
  otherPastDueCents: number;
  payUrl: string;
}

export interface PastDueTextInvoice {
  invoiceId: string;
  amountCents: number;
  /** Unix ms. For an autopay invoice (no due date) it's when it was
   *  issued and charged. */
  dueDate: number;
  daysPastDue: number;
  /** Highest stage reached: 7, 14 or 21. */
  stage: number;
  payUrl: string;
}

/** One family's past-due text. Several invoices reaching a stage on
 *  the same day share one text, so a family is never sent two in a
 *  morning. */
export interface FamilyPastDueText {
  familyId: number;
  /** Invoices with a stage reached, oldest first, before dedupe
   *  against the SMS log. */
  invoices: PastDueTextInvoice[];
  /** Everything past due on the account, including invoices not yet
   *  7 days late. */
  totalPastDueCents: number;
  /** The family is on autopay, so these charges failed. */
  onAutopay: boolean;
}

export function planBillingTexts({
  txns,
  isBillableFamily,
  isOnAutopay,
  pastDueTotals,
  payUrlFor,
  nowMs,
}: {
  /** The year's invoice mirror rows, less anything charged this run. */
  txns: XanoPaymentTransaction[];
  /** Families the school is still billing for the year (live
   *  subscription, not residential). */
  isBillableFamily: (familyId: number) => boolean;
  isOnAutopay: (subscriptionId: string) => boolean;
  /** `pastDueTotalsByFamily` over the same rows. */
  pastDueTotals: Map<number, number>;
  payUrlFor: (tx: XanoPaymentTransaction) => string;
  nowMs: number;
}): { upcoming: PlannedUpcomingText[]; pastDue: FamilyPastDueText[] } {
  const upcoming: PlannedUpcomingText[] = [];
  const byFamily = new Map<number, FamilyPastDueText>();
  for (const tx of txns) {
    const familyId = Number(tx.registration_families_id);
    if (!isBillableFamily(familyId)) continue;
    // `open` only: paid, void and refunded are settled, and one staff
    // marked uncollectible has been written off.
    if (tx.status !== "open") continue;
    const owed = Number(tx.amount_due_cents) - Number(tx.amount_paid_cents);
    if (!(owed > 0)) continue;
    const onAutopay = isOnAutopay(tx.stripe_subscription_id);

    const balance = pastDueBalance(tx, nowMs);
    if (balance) {
      const stage = pastDueStage(balance.daysPastDue);
      if (stage === null) continue;
      if (Math.floor(balance.due / ONE_DAY_MS) + stage < PAST_DUE_TEXTS_FROM_DAY) {
        continue;
      }
      const plan = byFamily.get(familyId) ?? {
        familyId,
        invoices: [],
        totalPastDueCents: pastDueTotals.get(familyId) ?? 0,
        onAutopay,
      };
      plan.onAutopay = plan.onAutopay || onAutopay;
      plan.invoices.push({
        invoiceId: tx.stripe_invoice_id,
        amountCents: balance.owed,
        dueDate: balance.due,
        daysPastDue: balance.daysPastDue,
        stage,
        payUrl: payUrlFor(tx),
      });
      byFamily.set(familyId, plan);
      continue;
    }

    // Not past due yet: due today or later. Autopay charges it on the
    // due date, so there's nothing for the family to pay.
    const due = Number(tx.due_date);
    if (onAutopay || !(due > 0)) continue;
    if (due > nowMs + BILLING_UPCOMING_LEAD_DAYS * ONE_DAY_MS) continue;
    upcoming.push({
      familyId,
      invoiceId: tx.stripe_invoice_id,
      amountCents: owed,
      dueDate: due,
      // This invoice isn't in the past-due totals yet.
      otherPastDueCents: pastDueTotals.get(familyId) ?? 0,
      payUrl: payUrlFor(tx),
    });
  }

  const pastDue = [...byFamily.values()];
  for (const plan of pastDue) plan.invoices.sort((a, b) => a.dueDate - b.dueDate);
  return { upcoming, pastDue };
}

/** Template prefix on a past-due text's log row. The row's template
 *  lists a `-<stage>d-<invoice id>` token for every reminder the text
 *  covered, e.g. `past_due-21d-in_1U6u…-7d-in_1UK2…`. */
export const PAST_DUE_TEXT_PREFIX = "past_due";

const REMINDER_TOKEN = /-(\d+)d-(in_[A-Za-z0-9]+)/g;

/** `<stage>:<invoice id>` for every reminder a past-due text already
 *  covered, read from the thread's outbound, non-failed rows. */
export function sentPastDueTextReminders(
  rows: Array<{ direction: string; template?: string | null; status: string }>
): Set<string> {
  const sent = new Set<string>();
  for (const row of rows) {
    if (row.direction !== "outbound" || row.status === "failed") continue;
    const tag = row.template ?? "";
    if (!tag.startsWith(PAST_DUE_TEXT_PREFIX + "-")) continue;
    for (const m of tag.matchAll(REMINDER_TOKEN)) sent.add(`${m[1]}:${m[2]}`);
  }
  return sent;
}

export function pastDueTextTemplate(invoices: PastDueTextInvoice[]): string {
  return (
    PAST_DUE_TEXT_PREFIX +
    invoices.map((i) => `-${i.stage}d-${i.invoiceId}`).join("")
  );
}

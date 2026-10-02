/**
 * Past-due tuition emails — which invoices are due a reminder today.
 *
 * The daily reminder cron emails every parent on a family (primary and
 * secondary) 7, 14 and 21 days after an open tuition invoice's due
 * date, each invoice with its own pay link. This module is the pure
 * planning half: given the year's invoice mirror and "now", it groups
 * each billable family's past-due invoices and names the reminders that
 * have come due. The send half (dedupe against the email log, render,
 * send) is `sendTuitionPastDueEmail` in lib/emails/triggers.ts.
 *
 * Rules:
 *   - Days are counted on UTC calendar dates, the date Stripe prints as
 *     "Due September 7" on the invoice and its hosted page, so the
 *     7-day email lands on September 14 whatever hour the invoice was
 *     cut.
 *   - Only the HIGHEST stage an invoice has reached is ever due. An
 *     invoice already 30 days past due when this shipped gets the
 *     21-day email once, not all three in one morning.
 *   - Each (invoice, stage) goes out once. The email's audit row stores
 *     a `-<stage>d-<invoice id>` token in its template tag for every
 *     reminder it covered, and later runs read those back
 *     (`sentPastDueReminders`).
 *   - One email per family per run. Invoices that reach a stage on the
 *     same day share one email, which lists every past-due invoice on
 *     the account.
 *   - An autopay invoice has no due date: it's charged when issued, so
 *     one still open has failed, and the count runs from its
 *     finalization (`finalized_at`).
 *
 * Type-only imports, so a local dry-run script can load this file
 * as-is.
 */

import type { XanoPaymentTransaction } from "@/lib/xano";

/** Days past the due date at which a reminder goes out. */
export const PAST_DUE_EMAIL_STAGES = [7, 14, 21] as const;

/** Template tag prefix on the email audit row. The "tuition" in it also
 *  files the row under Billing in the activity stream. */
export const PAST_DUE_TEMPLATE_PREFIX = "tuition-past-due";

/** Resend caps a tag value at 256 characters and each token runs ~33,
 *  so one email covers at most this many reminders. Any extra go out
 *  on the next run. In practice several invoices only reach a stage
 *  on the same day once: the backlog on the day this shipped. */
const MAX_REMINDERS_PER_EMAIL = 6;

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export interface PastDueInvoice {
  invoiceId: string;
  /** Still owed on the invoice: amount due minus amount paid. */
  amountCents: number;
  /** Unix ms. */
  dueDate: number;
  daysPastDue: number;
  /** Highest reminder stage reached, or null under 7 days. */
  stage: number | null;
  /** Branded `/pay/<invoice>` link → Stripe's hosted invoice page. */
  payUrl: string;
}

export interface PastDueReminder {
  invoiceId: string;
  stage: number;
}

export interface FamilyPastDuePlan {
  familyId: number;
  /** Every past-due invoice on the account for the year, oldest first.
   *  The email lists them all, not only the ones whose stage came up
   *  today. */
  pastDue: PastDueInvoice[];
  /** Reminders due today, oldest invoice first, before dedupe against
   *  the email log. */
  reminders: PastDueReminder[];
}

/** The highest stage reached `daysPastDue` days after the due date, or
 *  null below the first stage. */
export function pastDueStage(daysPastDue: number): number | null {
  let stage: number | null = null;
  for (const s of PAST_DUE_EMAIL_STAGES) {
    if (daysPastDue >= s) stage = s;
  }
  return stage;
}

/** Whole UTC calendar days from `dueMs` to `nowMs`. */
function calendarDaysBetween(dueMs: number, nowMs: number): number {
  return Math.floor(nowMs / ONE_DAY_MS) - Math.floor(dueMs / ONE_DAY_MS);
}

export function planPastDueEmails({
  txns,
  isBillableFamily,
  payUrlFor,
  nowMs,
}: {
  /** The year's invoice mirror rows. */
  txns: XanoPaymentTransaction[];
  /** Families the school is still billing for the year. */
  isBillableFamily: (familyId: number) => boolean;
  payUrlFor: (tx: XanoPaymentTransaction) => string;
  nowMs: number;
}): FamilyPastDuePlan[] {
  const byFamily = new Map<number, PastDueInvoice[]>();
  for (const tx of txns) {
    // `open` only: paid, void and refunded invoices are settled, and
    // one staff marked uncollectible has been written off.
    if (tx.status !== "open") continue;
    const owed = Number(tx.amount_due_cents) - Number(tx.amount_paid_cents);
    if (!(owed > 0)) continue;
    // An autopay invoice has no due date. Stripe charges it when it's
    // issued, so one still open has failed: count from then.
    const due = Number(tx.due_date ?? tx.finalized_at);
    if (!(due > 0) || !Number.isFinite(due)) continue;
    // A day past due at least. The due-date text already covers day 0.
    const daysPastDue = calendarDaysBetween(due, nowMs);
    if (daysPastDue < 1) continue;
    const familyId = Number(tx.registration_families_id);
    if (!isBillableFamily(familyId)) continue;

    const list = byFamily.get(familyId) ?? [];
    list.push({
      invoiceId: tx.stripe_invoice_id,
      amountCents: owed,
      dueDate: due,
      daysPastDue,
      stage: pastDueStage(daysPastDue),
      payUrl: payUrlFor(tx),
    });
    byFamily.set(familyId, list);
  }

  return [...byFamily.entries()].map(([familyId, list]) => {
    const pastDue = list.sort((a, b) => a.dueDate - b.dueDate);
    return {
      familyId,
      pastDue,
      reminders: pastDue.flatMap((inv) =>
        inv.stage === null ? [] : [{ invoiceId: inv.invoiceId, stage: inv.stage }]
      ),
    };
  });
}

/** One `-<stage>d-<invoice id>` token inside a past-due email's tag. */
const REMINDER_TOKEN = /-(\d+)d-(in_[A-Za-z0-9]+)/g;

function reminderKey(r: PastDueReminder): string {
  return `${r.stage}:${r.invoiceId}`;
}

/** Keys (`<stage>:<invoice id>`) of every reminder a SENT past-due
 *  email already covered, read back out of the audit rows' tags. A
 *  failed send isn't counted, so tomorrow's run retries it. */
export function sentPastDueReminders(
  rows: Array<{ template: string | null; status: string }>
): Set<string> {
  const sent = new Set<string>();
  for (const row of rows) {
    if (row.status !== "sent") continue;
    const tag = row.template ?? "";
    if (!tag.startsWith(PAST_DUE_TEMPLATE_PREFIX)) continue;
    for (const m of tag.matchAll(REMINDER_TOKEN)) {
      sent.add(reminderKey({ stage: Number(m[1]), invoiceId: m[2] }));
    }
  }
  return sent;
}

/** The reminders one email should cover now: not already sent, oldest
 *  invoice first, at most `MAX_REMINDERS_PER_EMAIL`. */
export function pendingPastDueReminders(
  reminders: PastDueReminder[],
  sent: Set<string>
): PastDueReminder[] {
  return reminders
    .filter((r) => !sent.has(reminderKey(r)))
    .slice(0, MAX_REMINDERS_PER_EMAIL);
}

/** Template tag for an email covering `reminders`, e.g.
 *  `tuition-past-due-7d-in_1U7Q…`. It's also the email's Resend tag,
 *  which allows only letters, digits, `_` and `-`. Stripe invoice ids
 *  fit that. */
export function pastDueTemplateTag(reminders: PastDueReminder[]): string {
  return (
    PAST_DUE_TEMPLATE_PREFIX +
    reminders.map((r) => `-${r.stage}d-${r.invoiceId}`).join("")
  );
}

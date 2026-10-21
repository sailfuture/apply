/**
 * "Fire SMS X" entry points, mirroring `lib/emails/triggers.ts`. The
 * four lifecycle senders are called right beside their email twins in
 * the status-change routes; the two billing senders are driven by the
 * daily cron (planned in lib/billing-texts.ts). Every one is
 * best-effort (never throws) and reuses the
 * email layer's `resolveFamilyContext` for the student name + login
 * URL. The recipient phone + opt-out check live in `sendSms`.
 *
 * Dedupe is log-based: `priorSend` scans the `sms_messages` thread for
 * a prior non-failed send with the same `template` — so a re-toggled
 * status (or a daily cron) can't re-text. No extra Xano dedupe columns
 * are needed (unlike the email cron's `*_sent_at` stamps).
 *
 * The thread is read straight from Xano, three attempts, and a read
 * that still fails is reported as "unknown" rather than passed off as
 * "never sent" (which is what the list accessors' [] used to mean
 * here). What happens next depends on whether the text gets another
 * chance:
 *
 *   - Lifecycle texts SEND anyway. They fire once, on a status change,
 *     and nothing retries them — a skipped one is a text the family
 *     never gets, while the worst a send can do is repeat itself.
 *   - Billing texts WAIT. The cron runs again tomorrow and the invoice
 *     will still qualify, so holding costs a day; guessing costs a
 *     family a second "you owe" text.
 */

import { xano } from "@/lib/xano";
import { sendSms, type SendSmsResult } from "@/lib/sms/send";
import { resolveFamilyContext } from "@/lib/emails/triggers";
import * as tpl from "@/lib/sms/templates";
import {
  pastDueTextTemplate,
  sentPastDueTextReminders,
  type FamilyPastDueText,
} from "@/lib/billing-texts";

/** Returned when dedupe short-circuits a send — treated as success
 *  (nothing to do), matching the email layer's deduped return. */
const DEDUPED: SendSmsResult = { ok: true };

/** Returned when a billing text is held because the log couldn't say
 *  whether it already went out. Not a success: the cron counts it
 *  apart from both sends and failures. */
const UNVERIFIED: SendSmsResult = { ok: false, skipped: "unverified" };

type PriorSend = "sent" | "not_sent" | "unknown";

async function priorSend(
  familyId: number,
  template: string,
  yearId?: number | null
): Promise<PriorSend> {
  try {
    const rows = await xano.smsMessages.getByContactStrict("family", familyId);
    return rows.some(
      (m) =>
        m.direction === "outbound" &&
        m.template === template &&
        m.status !== "failed" &&
        (yearId == null || m.registration_school_years_id === yearId)
    )
      ? "sent"
      : "not_sent";
  } catch (err) {
    console.error(
      `[sms/triggers] couldn't read family ${familyId}'s thread to dedupe "${template}":`,
      err
    );
    return "unknown";
  }
}

/* ───────────────────────── Lifecycle triggers ───────────────────────── */

/** SMS 1 — application received / under review. Beside
 *  `sendApplicationReceivedEmail` in PATCH /api/family-progress. */
export async function sendApplicationReceivedSms(
  familyId: number,
  yearId: number
): Promise<SendSmsResult> {
  if ((await priorSend(familyId, "application_received", yearId)) === "sent") {
    return DEDUPED;
  }
  const ctx = await resolveFamilyContext(familyId, yearId);
  if (!ctx) return { ok: false, error: "context-failed" };
  return sendSms({
    familyId,
    yearId,
    template: "application_received",
    body: tpl.applicationReceivedSms({ student: ctx.studentDisplayNames }),
  });
}

/** SMS 2 — accepted, complete registration. Beside
 *  `sendAcceptanceEmail` in PATCH /api/admin/family-progress. */
export async function sendAcceptanceSms(
  familyId: number,
  yearId: number
): Promise<SendSmsResult> {
  if ((await priorSend(familyId, "accepted", yearId)) === "sent") {
    return DEDUPED;
  }
  const ctx = await resolveFamilyContext(familyId, yearId);
  if (!ctx) return { ok: false, error: "context-failed" };
  return sendSms({
    familyId,
    yearId,
    template: "accepted",
    body: tpl.acceptedSms({
      student: ctx.studentDisplayNames,
      link: ctx.loginUrl,
    }),
  });
}

/** SMS 3 — registration packet received. Beside
 *  `sendRegistrationReceivedEmail` in PATCH
 *  /api/student-registration-progress. */
export async function sendRegistrationReceivedSms(
  familyId: number,
  yearId: number
): Promise<SendSmsResult> {
  if (
    (await priorSend(familyId, "registration_received", yearId)) === "sent"
  ) {
    return DEDUPED;
  }
  const ctx = await resolveFamilyContext(familyId, yearId);
  if (!ctx) return { ok: false, error: "context-failed" };
  return sendSms({
    familyId,
    yearId,
    template: "registration_received",
    body: tpl.registrationReceivedSms({ student: ctx.studentDisplayNames }),
  });
}

/** SMS 4 — officially enrolled. Beside `sendEnrolledEmail` in PATCH
 *  /api/admin/registration-progress. */
export async function sendEnrolledSms(
  familyId: number,
  yearId: number
): Promise<SendSmsResult> {
  if ((await priorSend(familyId, "enrolled", yearId)) === "sent") {
    return DEDUPED;
  }
  const ctx = await resolveFamilyContext(familyId, yearId);
  if (!ctx) return { ok: false, error: "context-failed" };
  return sendSms({
    familyId,
    yearId,
    template: "enrolled",
    body: tpl.enrolledSms({
      student: ctx.studentDisplayNames,
      link: ctx.loginUrl,
    }),
  });
}

/* ───────────────────────── Billing triggers ───────────────────────── */

export interface BillingSmsInput {
  familyId: number;
  yearId: number;
  /** Stripe invoice id — the per-invoice dedupe key (encoded into the
   *  `template` so a fresh monthly invoice can remind again). */
  invoiceId: string;
  /** Outstanding cents on the invoice (amount_due − amount_paid). */
  amountCents: number;
  /** Invoice due date (unix ms), or null. */
  dueDate: number | null;
  /** Branded `/pay/<invoice>` link, falling back to the Tuition page. */
  payUrl: string;
  /** `/autopay` — the Tuition page's Autopay panel. */
  autopayUrl: string;
  /** Cents past due on the family's OTHER open invoices for the year,
   *  this one excluded (lib/billing-texts.ts). When there are any, the
   *  text adds "Total past due on your account"; a family whose only
   *  past-due invoice is this one isn't told the same number twice. */
  otherPastDueCents?: number;
}

/** The account total to print beside one invoice's amount, or
 *  undefined when nothing else on the account is past due. */
function accountTotalLine(
  input: Pick<BillingSmsInput, "amountCents" | "otherPastDueCents">,
  thisInvoicePastDue: boolean
): string | undefined {
  const others = input.otherPastDueCents ?? 0;
  if (!(others > 0)) return undefined;
  return formatUsd(others + (thisInvoicePastDue ? input.amountCents : 0));
}

/** SMS 5 — tuition due soon. Fires from the cron when an open
 *  invoice's due date is within the lead window. Once per invoice. */
export async function sendBillingUpcomingSms(
  input: BillingSmsInput
): Promise<SendSmsResult> {
  const template = `billing_upcoming:${input.invoiceId}`;
  const prior = await priorSend(input.familyId, template);
  if (prior === "sent") return DEDUPED;
  if (prior === "unknown") return UNVERIFIED;
  return sendSms({
    familyId: input.familyId,
    yearId: input.yearId,
    template,
    body: tpl.billingUpcomingSms({
      amount: formatUsd(input.amountCents),
      date: formatDueDate(input.dueDate),
      link: input.payUrl,
      autopayLink: input.autopayUrl,
      // The upcoming invoice isn't past due, so any past-due total is
      // news to the family.
      totalPastDue: accountTotalLine(input, false),
    }),
  });
}

/** SMS 6 — tuition past due, 7, 14 and 21 days after the due date.
 *  One text per family per run, covering every (invoice, stage) not
 *  yet texted: it leads with the oldest of them and prints the
 *  account's total past due. Each covered reminder is recorded in the
 *  row's template (lib/billing-texts.ts), so none repeats. Before
 *  2026-10-20 a single text went out on the due date itself under
 *  `outstanding:<invoice>`; those rows stay in the threads as history. */
export async function sendPastDueTuitionSms(
  plan: FamilyPastDueText,
  yearId: number,
  autopayUrl: string
): Promise<SendSmsResult> {
  let sent: Set<string>;
  try {
    sent = sentPastDueTextReminders(
      await xano.smsMessages.getByContactStrict("family", plan.familyId)
    );
  } catch (err) {
    console.error(
      `[sms/triggers] couldn't read family ${plan.familyId}'s thread to dedupe past-due texts:`,
      err
    );
    return UNVERIFIED;
  }
  const pending = plan.invoices.filter(
    (i) => !sent.has(`${i.stage}:${i.invoiceId}`)
  );
  const first = pending[0];
  if (!first) return DEDUPED;
  return sendSms({
    familyId: plan.familyId,
    yearId,
    template: pastDueTextTemplate(pending),
    body: tpl.pastDueTuitionSms({
      amount: formatUsd(first.amountCents),
      date: formatDueDate(first.dueDate),
      daysPastDue: first.daysPastDue,
      link: first.payUrl,
      autopayLink: autopayUrl,
      onAutopay: plan.onAutopay,
      // Only when there's more past due than this one invoice.
      totalPastDue:
        plan.totalPastDueCents > first.amountCents
          ? formatUsd(plan.totalPastDueCents)
          : undefined,
    }),
  });
}

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

function formatUsd(cents: number): string {
  return USD.format(Math.max(0, Math.round(cents)) / 100);
}

function formatDueDate(ts: number | null): string {
  if (!ts) return "soon";
  return new Date(ts).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
  });
}

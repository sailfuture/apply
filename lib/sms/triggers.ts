/**
 * "Fire SMS X" entry points, mirroring `lib/emails/triggers.ts`. The
 * four lifecycle senders are called right beside their email twins in
 * the status-change routes; the two billing senders are driven by the
 * daily cron. Every one is best-effort (never throws) and reuses the
 * email layer's `resolveFamilyContext` for the student name + login
 * URL. The recipient phone + opt-out check live in `sendSms`.
 *
 * Dedupe is log-based: `hasSentSms` scans the `sms_messages` thread for
 * a prior non-failed send with the same `template` — so a re-toggled
 * status (or a daily cron) can't re-text. No extra Xano dedupe columns
 * are needed (unlike the email cron's `*_sent_at` stamps).
 */

import { xano } from "@/lib/xano";
import { sendSms, type SendSmsResult } from "@/lib/sms/send";
import { resolveFamilyContext } from "@/lib/emails/triggers";
import * as tpl from "@/lib/sms/templates";

/** Returned when dedupe short-circuits a send — treated as success
 *  (nothing to do), matching the email layer's deduped return. */
const DEDUPED: SendSmsResult = { ok: true };

async function hasSentSms(
  familyId: number,
  template: string,
  yearId?: number | null
): Promise<boolean> {
  try {
    const rows = await xano.smsMessages.getByFamilyId(familyId);
    return rows.some(
      (m) =>
        m.direction === "outbound" &&
        m.template === template &&
        m.status !== "failed" &&
        (yearId == null || m.registration_school_years_id === yearId)
    );
  } catch {
    // Better a rare duplicate than swallowing a real send because the
    // dedupe read failed.
    return false;
  }
}

/* ───────────────────────── Lifecycle triggers ───────────────────────── */

/** SMS 1 — application received / under review. Beside
 *  `sendApplicationReceivedEmail` in PATCH /api/family-progress. */
export async function sendApplicationReceivedSms(
  familyId: number,
  yearId: number
): Promise<SendSmsResult> {
  if (await hasSentSms(familyId, "application_received", yearId)) return DEDUPED;
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
  if (await hasSentSms(familyId, "accepted", yearId)) return DEDUPED;
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
  if (await hasSentSms(familyId, "registration_received", yearId)) {
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
  if (await hasSentSms(familyId, "enrolled", yearId)) return DEDUPED;
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
  /** Stripe hosted-invoice URL to pay, falling back to the app login. */
  payUrl: string;
}

/** SMS 5 — monthly billing upcoming. Fires from the cron when an open
 *  invoice's due date is within the lead window. */
export async function sendBillingUpcomingSms(
  input: BillingSmsInput
): Promise<SendSmsResult> {
  const template = `billing_upcoming:${input.invoiceId}`;
  if (await hasSentSms(input.familyId, template)) return DEDUPED;
  return sendSms({
    familyId: input.familyId,
    yearId: input.yearId,
    template,
    body: tpl.billingUpcomingSms({
      amount: formatUsd(input.amountCents),
      date: formatDueDate(input.dueDate),
      link: input.payUrl,
    }),
  });
}

/** SMS 6 — outstanding tuition (past due). Fires from the cron once an
 *  open invoice's due date has passed. Once per invoice. */
export async function sendOutstandingTuitionSms(
  input: BillingSmsInput
): Promise<SendSmsResult> {
  const template = `outstanding:${input.invoiceId}`;
  if (await hasSentSms(input.familyId, template)) return DEDUPED;
  return sendSms({
    familyId: input.familyId,
    yearId: input.yearId,
    template,
    body: tpl.outstandingTuitionSms({
      amount: formatUsd(input.amountCents),
      date: formatDueDate(input.dueDate),
      link: input.payUrl,
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

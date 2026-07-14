import { NextRequest, NextResponse } from "next/server";
import { xano } from "@/lib/xano";
import {
  sendDraftReminderEmail,
  sendEnrollmentReminderEmail,
  sendBackToSchoolEmail,
} from "@/lib/emails/triggers";
import {
  sendBillingUpcomingSms,
  sendOutstandingTuitionSms,
} from "@/lib/sms/triggers";
import { activeStripeSubscriptionId } from "@/lib/xano";
import { sendBillingAlert } from "@/lib/billing-alerts";

/**
 * Daily cron sweep that drives the three time-based reminder emails:
 *
 *   - Email 5 — draft reminder (3-5 days after the parent created
 *     their family-progress row without submitting).
 *   - Email 6 — enrollment-agreement reminder (5+ days after admin
 *     accepted, if the parent hasn't signed yet).
 *   - Email 11 — back-to-school welcome (1-2 weeks before August
 *     24th, to every officially-enrolled family for the current
 *     year).
 *
 * Authorization: Vercel Cron sends `Authorization: Bearer
 * $CRON_SECRET` when the `CRON_SECRET` env var is set. Other callers
 * (e.g. local dev, manual debug) can hit `/api/cron/email-reminders`
 * directly when `CRON_SECRET` is unset — useful for spot-checking
 * the logic without spinning up a real cron.
 *
 * Wire-up:
 *   1. Add `CRON_SECRET` to Vercel env (recommended — keeps the
 *      endpoint locked down in production).
 *   2. `vercel.json` declares the schedule (daily at 14:00 UTC =
 *      10am ET, a friendly send time for parents).
 *   3. The three Xano dedupe columns
 *      (`draft_reminder_sent_at`, `acceptance_reminder_sent_at`,
 *      `back_to_school_sent_at`) must exist on
 *      `registration_family_application_progress` — see the type
 *      definition in `lib/xano.ts`. Without them the cron will
 *      re-send daily because the dedupe write silently no-ops.
 *
 * Response shape: `{ ok, draft, enrollment, backToSchool }` with
 * per-sweep counts so you can grep the cron log for `[cron/email-
 * reminders]` and see which buckets fired today.
 *
 * Best-effort everywhere — one bad row never aborts the whole
 * sweep. Per-family failures log with enough context to debug and
 * the cron moves on to the next family.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60; // seconds — generous for slow Xano days

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** Window for Email 5 — fires when the family-progress row's
 *  `created_at` is between 3 and 5 days old. Tighter than the spec's
 *  "3-5 days" so the cron only needs to run once per day to catch
 *  every eligible family at least once inside the window. */
const DRAFT_REMINDER_MIN_AGE_DAYS = 3;
const DRAFT_REMINDER_MAX_AGE_DAYS = 7;

/** Window for Email 6 — fires when admin acceptance is at least 5
 *  days old. Open-ended on the upper side so the reminder still
 *  goes out for old accepts the cron missed during a downtime. The
 *  one-shot dedupe column prevents repeat sends. */
const ENROLLMENT_REMINDER_MIN_AGE_DAYS = 5;

/** Window for Email 11 — fires once between Aug 10 and Aug 17
 *  (1-2 weeks before the first day on Aug 24). Local America/New_York
 *  date check; the cron runs in UTC, so we compute the ET date from
 *  the current UTC timestamp. */
const BACK_TO_SCHOOL_START_MONTH_INDEX = 7; // August (0-indexed)
const BACK_TO_SCHOOL_START_DAY = 10;
const BACK_TO_SCHOOL_END_DAY = 17;

/** Lead time for the "monthly billing upcoming" SMS — fire when an open
 *  invoice's due date is within this many days. Past that (due date in
 *  the past) it becomes the "outstanding tuition" reminder instead. */
const BILLING_UPCOMING_LEAD_DAYS = 3;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization") ?? "";
  const expected = process.env.CRON_SECRET
    ? `Bearer ${process.env.CRON_SECRET}`
    : null;
  if (expected && authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = {
    ok: true as boolean,
    draft: { eligible: 0, sent: 0, failed: 0 },
    enrollment: { eligible: 0, sent: 0, failed: 0 },
    backToSchool: { eligible: 0, sent: 0, failed: 0 },
    billingUpcoming: { eligible: 0, sent: 0, failed: 0 },
    outstanding: { eligible: 0, sent: 0, failed: 0 },
  };

  try {
    const years = await xano.schoolYears.getAll();
    // Active + upcoming years are what families touch today. Skip
    // years flagged `isPast` — no point sending reminders for a year
    // that's already wrapped.
    const activeYears = years.filter((y) => y.isPast !== true);

    for (const year of activeYears) {
      const progresses = await xano.familyApplicationProgress.getByYear(
        year.id
      );

      for (const p of progresses) {
        // Archived rows are out of consideration for all three
        // sweeps — admin has explicitly set the family aside for
        // this year.
        if (p.is_archived === true) continue;

        // Email 5 — draft reminder.
        if (isEligibleForDraftReminder(p)) {
          result.draft.eligible += 1;
          const res = await sendDraftReminderEmail(
            p.registration_families_id,
            p.registration_school_years_id
          );
          if (res.ok) {
            await stampSentAt(p.id, "draft_reminder_sent_at");
            result.draft.sent += 1;
          } else {
            result.draft.failed += 1;
          }
        }

        // Email 6 — enrollment-agreement reminder. Needs both the
        // family-progress row (for `accepted_at` + dedupe stamp) and
        // the registration-progress row (for `isEnrollment`, the
        // bool that flips true once the parent finishes signing).
        if (await isEligibleForEnrollmentReminder(p)) {
          result.enrollment.eligible += 1;
          const res = await sendEnrollmentReminderEmail(
            p.registration_families_id,
            p.registration_school_years_id
          );
          if (res.ok) {
            await stampSentAt(p.id, "acceptance_reminder_sent_at");
            result.enrollment.sent += 1;
          } else {
            result.enrollment.failed += 1;
          }
        }
      }

      // Email 11 — back-to-school. Only runs if today's ET date
      // falls inside the configured window. Tied to the year's
      // first-day-of-school (Aug 24) — we don't fire this in any
      // other window even if the year is flagged active.
      if (isBackToSchoolWindow(new Date())) {
        const regs = await xano.studentRegistrationProgress.getByYear(
          year.id
        );
        for (const reg of regs) {
          if (reg.isArchived === true) continue;
          if (reg.isRegistrationConfirmed !== true) continue;

          // Dedupe stamp lives on the family-progress row, not the
          // registration-progress row — keeps all three notification
          // timestamps in one place. Look up the matching family-
          // progress row to read/write the stamp. Best-effort: if
          // we can't find one, skip (means the family doesn't have
          // a progress row at all, which is degenerate).
          const fp = progresses.find(
            (p) =>
              p.registration_families_id === reg.registration_families_id
          );
          if (!fp) continue;
          if (fp.back_to_school_sent_at) continue;

          result.backToSchool.eligible += 1;
          const sent = await sendBackToSchoolEmail(
            reg.registration_families_id,
            reg.registration_school_years_id
          );
          if (sent.ok) {
            await stampSentAt(fp.id, "back_to_school_sent_at");
            result.backToSchool.sent += 1;
          } else {
            result.backToSchool.failed += 1;
          }
        }
      }

      // Billing SMS — reminders driven off the invoice mirror
      // (`registration_payment_transactions`). For each still-open
      // invoice with a balance: fire "upcoming" when the due date is
      // within the lead window, or "outstanding" once it's past due.
      // Both dedupe per-invoice via the SMS log (see lib/sms/triggers),
      // so a daily run only texts each invoice once per state. No-ops
      // safely when Twilio isn't configured.
      const billingFallbackUrl =
        process.env.NEXT_PUBLIC_APP_URL ??
        "https://apply.sailfutureacademy.org";
      const txns = await xano.paymentTransactions.getAllByYear(year.id);
      for (const tx of txns) {
        const outstanding =
          Number(tx.amount_due_cents) - Number(tx.amount_paid_cents);
        const isOpen =
          (tx.status === "open" || tx.status === "uncollectible") &&
          outstanding > 0;
        if (!isOpen) continue;

        const input = {
          familyId: tx.registration_families_id,
          yearId: year.id,
          invoiceId: tx.stripe_invoice_id,
          amountCents: outstanding,
          dueDate: tx.due_date,
          payUrl: tx.hosted_invoice_url ?? billingFallbackUrl,
        };

        if (tx.due_date != null && tx.due_date < Date.now()) {
          result.outstanding.eligible += 1;
          const res = await sendOutstandingTuitionSms(input);
          if (res.ok) result.outstanding.sent += 1;
          else result.outstanding.failed += 1;
        } else if (
          tx.due_date != null &&
          tx.due_date <= Date.now() + BILLING_UPCOMING_LEAD_DAYS * ONE_DAY_MS
        ) {
          result.billingUpcoming.eligible += 1;
          const res = await sendBillingUpcomingSms(input);
          if (res.ok) result.billingUpcoming.sent += 1;
          else result.billingUpcoming.failed += 1;
        }
      }

      // Drift detection — a family with a LIVE subscription but ZERO
      // mirrored invoices well past billing start means either the
      // Stripe webhook is broken/misconfigured (mirror silently dead:
      // no schedules, no reminders, no outstanding tracking) or the
      // subscription itself isn't generating invoices. Both are the
      // "family silently not billed / not tracked" worst case, so
      // surface them daily until fixed.
      try {
        const billingStartMs = year.billing_start_date
          ? Date.parse(`${year.billing_start_date}T00:00:00Z`)
          : NaN;
        const graceMs = 7 * ONE_DAY_MS;
        if (Number.isFinite(billingStartMs)) {
          const payments = await xano.familyPayments.getAllByYear(year.id);
          const familiesWithInvoices = new Set(
            txns.map((t) => t.registration_families_id)
          );
          const silent = payments.filter((p) => {
            const live = activeStripeSubscriptionId(p.stripe_subscription_id);
            if (!live) return false;
            if (familiesWithInvoices.has(p.registration_families_id)) {
              return false;
            }
            // Grace: billing anchor AND the subscription's payment row
            // must both be comfortably in the past — a just-started
            // family legitimately has no invoices yet.
            const startedMs = Math.max(
              billingStartMs,
              Number(p.created_at) || 0
            );
            return Date.now() > startedMs + graceMs;
          });
          if (silent.length > 0) {
            await sendBillingAlert(
              `${silent.length} live subscription(s) with no mirrored invoices (${year.year_name})`,
              [
                `These families have a live Stripe subscription for ${year.year_name} but ZERO invoices in the billing mirror, more than a week past billing start:`,
                ...silent.map(
                  (p) =>
                    `  - family #${p.registration_families_id} (subscription ${activeStripeSubscriptionId(p.stripe_subscription_id)})`
                ),
                ``,
                `Most likely cause: the Stripe webhook isn't reaching /api/webhooks/stripe (check the endpoint + STRIPE_WEBHOOK_SECRET in the Stripe Dashboard), or the subscription isn't generating invoices.`,
                `Run POST /api/admin/billing/backfill?yearId=${year.id} after fixing the webhook to recover missed invoices.`,
              ]
            );
          }
        }
      } catch (err) {
        console.error(
          `[cron/email-reminders] billing drift check failed for year ${year.id}:`,
          err
        );
      }
    }

    console.log(
      `[cron/email-reminders] complete: ${JSON.stringify(result)}`
    );
    return NextResponse.json(result);
  } catch (err) {
    console.error("[cron/email-reminders] sweep failed:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

/* ────────────────────────── Eligibility checks ────────────────────────── */

function isEligibleForDraftReminder(
  p: import("@/lib/xano").XanoFamilyApplicationProgress
): boolean {
  if (p.isSubmitted === true) return false;
  if (p.draft_reminder_sent_at) return false;
  const ageDays = (Date.now() - Number(p.created_at)) / ONE_DAY_MS;
  return (
    ageDays >= DRAFT_REMINDER_MIN_AGE_DAYS &&
    ageDays <= DRAFT_REMINDER_MAX_AGE_DAYS
  );
}

/** Async because the enrollment-progress row has to be fetched to
 *  check whether the parent has already signed the agreement. We
 *  use `resolve` (read-or-create) so even families that haven't yet
 *  touched the registration flow get a row back; the
 *  `isEnrollment === false` check then correctly classifies them as
 *  "still needs to sign". */
async function isEligibleForEnrollmentReminder(
  p: import("@/lib/xano").XanoFamilyApplicationProgress
): Promise<boolean> {
  if (p.isAccepted !== true) return false;
  if (!p.accepted_at) return false;
  if (p.acceptance_reminder_sent_at) return false;
  const ageDays = (Date.now() - Number(p.accepted_at)) / ONE_DAY_MS;
  if (ageDays < ENROLLMENT_REMINDER_MIN_AGE_DAYS) return false;
  try {
    const reg = await xano.studentRegistrationProgress.resolve(
      p.registration_families_id,
      p.registration_school_years_id
    );
    // Already signed? Skip — nothing to remind about. Check both the
    // section bool and the agreement-status field for belt-and-suspenders.
    if (reg.isEnrollment === true) return false;
    if (reg.is_enrollment_agreement_signed === true) return false;
    return true;
  } catch (err) {
    console.warn(
      `[cron/email-reminders] enrollment-reminder eligibility lookup failed for family=${p.registration_families_id} year=${p.registration_school_years_id}:`,
      err
    );
    return false;
  }
}

/** True if `now`'s date in America/New_York falls between Aug
 *  ${BACK_TO_SCHOOL_START_DAY} and Aug ${BACK_TO_SCHOOL_END_DAY},
 *  inclusive. The cron runs daily and the dedupe stamp ensures each
 *  family only gets one email even if the window spans multiple
 *  cron firings. */
function isBackToSchoolWindow(now: Date): boolean {
  const et = new Date(
    now.toLocaleString("en-US", { timeZone: "America/New_York" })
  );
  const month = et.getMonth();
  const day = et.getDate();
  return (
    month === BACK_TO_SCHOOL_START_MONTH_INDEX &&
    day >= BACK_TO_SCHOOL_START_DAY &&
    day <= BACK_TO_SCHOOL_END_DAY
  );
}

/* ────────────────────────── Stamp helper ────────────────────────── */

async function stampSentAt(
  progressRowId: number,
  column:
    | "draft_reminder_sent_at"
    | "acceptance_reminder_sent_at"
    | "back_to_school_sent_at"
): Promise<void> {
  try {
    await xano.familyApplicationProgress.update(progressRowId, {
      [column]: Date.now(),
    });
  } catch (err) {
    // If the column doesn't exist in Xano yet, the write throws —
    // log loudly so an admin notices, but don't let it abort the
    // sweep. Worst case the email re-sends tomorrow until the column
    // is added.
    console.error(
      `[cron/email-reminders] failed to stamp ${column} on progress row ${progressRowId}:`,
      err
    );
  }
}

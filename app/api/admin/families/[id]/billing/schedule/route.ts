import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano, activeStripeSubscriptionId } from "@/lib/xano";
import {
  fetchActiveFamilyApplications,
  sumFamilyBillingTotals,
} from "@/lib/per-student-billing";
import {
  parseAnchorDate,
  buildMonthSlots,
  monthKey,
  indexTransactionsByMonth,
  stripeStatusToUi,
} from "@/lib/billing-schedule";

/**
 * Per-family 12-month billing schedule for the admin billing
 * detail page.
 *
 *   GET /api/admin/families/:id/billing/schedule?yearId=Y
 *
 * Returns a 12-row schedule anchored to the school year's
 * `billing_start_date` (e.g. Aug 1 → 12 monthly slots through the
 * following July). Each slot is either filled from a real invoice
 * in the payment-transactions mirror (if Stripe has generated one
 * for that month) or marked `not_started` for future months that
 * haven't been billed yet.
 *
 * Reads exclusively from Xano — no Stripe calls per request. The
 * mirror is webhook-fed and backfilled, so it's authoritative for
 * historical state. Each row carries the Stripe invoice id +
 * hosted URL so the UI can deep-link without a follow-up call.
 *
 * Response shape:
 *   {
 *     monthlyAmountCents: number | null,
 *     billingStartDate: string | null,  // YYYY-MM-DD
 *     yearTotalCents: number | null,
 *     paidCents: number,
 *     outstandingCents: number,
 *     slots: Array<{
 *       slotIndex: 0..11,
 *       periodStart: number,          // unix ms (UTC midnight)
 *       periodEndExclusive: number,
 *       monthLabel: "Aug 2026",
 *       status: "not_started" | "open" | "paid" | "failed" | "void",
 *       invoice: { ... } | null,      // hydrated when status !== "not_started"
 *     }>
 *   }
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const { id } = await params;
    const familyId = Number(id);
    const yearIdParam = req.nextUrl.searchParams.get("yearId");
    const yearId = Number(yearIdParam);
    if (!Number.isFinite(familyId) || familyId <= 0) {
      return NextResponse.json(
        { error: "Invalid family id" },
        { status: 400 }
      );
    }
    if (!Number.isFinite(yearId) || yearId <= 0) {
      return NextResponse.json(
        { error: "yearId is required" },
        { status: 400 }
      );
    }

    const [year, transactions, activeApps, family, progress, payments] =
      await Promise.all([
        xano.schoolYears.getById(yearId),
        xano.paymentTransactions.getByFamilyAndYear(familyId, yearId),
        fetchActiveFamilyApplications(familyId, yearId),
        // Family label for the page title. `getById` throws on a Xano
        // error — degrade to null so a lookup hiccup doesn't 500 the
        // whole schedule (the page falls back to "Family #id").
        xano.families.getById(familyId).catch(() => null),
        // Registration-confirmation latch — the BillingCard on the
        // schedule page gates Start Monthly Billing on it, same as
        // the registration detail page.
        xano.studentRegistrationProgress.getByFamilyAndYear(
          familyId,
          yearId
        ),
        // Payment row — a LIVE subscription with no invoices yet means
        // the months are SCHEDULED (future-dated billing), not
        // "not started".
        xano.familyPayments.getAllByYear(yearId).catch(() => []),
      ]);
    const paymentRow =
      payments.find(
        (p) => Number(p.registration_families_id) === familyId
      ) ?? null;
    const hasLiveSubscription = Boolean(
      activeStripeSubscriptionId(paymentRow?.stripe_subscription_id)
    );

    // Family monthly total is derived from per-student
    // `monthly_amount` on each active application row — the
    // application row is the per-student source of truth for
    // billing math.
    const totals = sumFamilyBillingTotals(activeApps);
    const monthlyAmountCents =
      totals.monthlyTotal > 0 ? Math.round(totals.monthlyTotal * 100) : null;
    const billingStartDate = year?.billing_start_date ?? null;

    // Build 12 month slots anchored to billing_start_date. If admin
    // hasn't set the date yet, slots are anchored to the first day
    // of the current calendar month so the UI still has something to
    // render — the empty state for the date itself is surfaced as a
    // separate banner on the page.
    const anchor = parseAnchorDate(billingStartDate);
    const slots = buildMonthSlots(anchor);

    // Match each slot to its invoice by billing-cycle month via the
    // shared helper (period_end — see lib/billing-schedule.ts for why
    // period_start put every invoice one month early). One invoice
    // per slot under normal operation; two invoices in one month
    // (manual out-of-cycle) → the most recent wins.
    const txByMonthKey = indexTransactionsByMonth(transactions);

    const enrichedSlots = slots.map((slot) => {
      const k = monthKey(new Date(slot.periodStart));
      const tx = txByMonthKey.get(k) ?? null;
      if (!tx) {
        return {
          ...slot,
          // No invoice yet: with a live subscription on file that
          // month is SCHEDULED (Stripe will bill it — e.g. a
          // future-dated start via trial_end); without one it truly
          // hasn't started.
          status: hasLiveSubscription
            ? ("scheduled" as const)
            : ("not_started" as const),
          invoice: null,
        };
      }
      const status = stripeStatusToUi(tx.status);
      return {
        ...slot,
        status,
        invoice: {
          stripeInvoiceId: tx.stripe_invoice_id,
          amountDueCents: tx.amount_due_cents,
          amountPaidCents: tx.amount_paid_cents,
          hostedInvoiceUrl: tx.hosted_invoice_url,
          invoicePdfUrl: tx.invoice_pdf_url,
          dueDate: tx.due_date,
          paidAt: tx.paid_at,
          finalizedAt: tx.finalized_at,
        },
      };
    });

    // Aggregations across the year — used in the summary header.
    const yearTotalCents =
      monthlyAmountCents != null ? monthlyAmountCents * 12 : null;
    const paidCents = transactions.reduce(
      (acc, t) => acc + (t.amount_paid_cents ?? 0),
      0
    );
    // Outstanding = sum of amount_due on open/uncollectible invoices.
    // Future months that haven't generated an invoice yet aren't
    // counted as "outstanding" — they're not yet billed.
    const outstandingCents = transactions.reduce((acc, t) => {
      if (t.status === "open" || t.status === "uncollectible") {
        return acc + Math.max((t.amount_due_cents ?? 0) - (t.amount_paid_cents ?? 0), 0);
      }
      return acc;
    }, 0);

    return NextResponse.json({
      familyName: family?.family_name?.trim() || `Family #${familyId}`,
      registrationConfirmed: progress?.isRegistrationConfirmed === true,
      monthlyAmountCents,
      billingStartDate,
      yearTotalCents,
      paidCents,
      outstandingCents,
      slots: enrichedSlots,
    } satisfies ScheduleResponse);
  } catch (err) {
    return handleAdminError(err);
  }
}

export interface ScheduleResponse {
  /** Display label for the page title — the family's name, falling
   *  back to "Family #id" when the family row can't be loaded. */
  familyName: string;
  /** Family-level `isRegistrationConfirmed` for the year — gates the
   *  BillingCard's Start Monthly Billing button on this page exactly
   *  like the registration detail page. */
  registrationConfirmed: boolean;
  monthlyAmountCents: number | null;
  billingStartDate: string | null;
  yearTotalCents: number | null;
  paidCents: number;
  outstandingCents: number;
  slots: ScheduleSlot[];
}

export interface ScheduleSlot {
  slotIndex: number;
  /** Unix ms for the UTC midnight start of this month slot. */
  periodStart: number;
  /** Unix ms for the start of the NEXT month — exclusive end. */
  periodEndExclusive: number;
  /** Human label ("Aug 2026") for the row. */
  monthLabel: string;
  status: "not_started" | "scheduled" | "open" | "paid" | "failed" | "void";
  invoice: {
    stripeInvoiceId: string;
    amountDueCents: number;
    amountPaidCents: number;
    hostedInvoiceUrl: string | null;
    invoicePdfUrl: string | null;
    dueDate: number | null;
    paidAt: number | null;
    finalizedAt: number | null;
  } | null;
}

// Slot/mapping helpers live in lib/billing-schedule.ts, shared with
// the parent schedule route so the two surfaces can't drift.

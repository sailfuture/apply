import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano, STRIPE_SUB_CANCELED_PREFIX } from "@/lib/xano";
import type { XanoPaymentTransaction } from "@/lib/xano";
import { getStripeClient } from "@/lib/stripe";

/**
 * Backfill the payment-transactions mirror from Stripe. Run once
 * after creating the mirror table (or any time the mirror has
 * drifted) to pull every invoice for every family-subscription for
 * the year and upsert it.
 *
 *   POST /api/admin/billing/backfill?yearId=Y
 *
 * Strategy:
 *   1. Read every `registration_families_payment` row for the year
 *      where `stripe_subscription_id` is set.
 *   2. For each subscription, list its invoices via Stripe API
 *      (auto-paginated until exhausted).
 *   3. Upsert each invoice via `findByStripeId` + create/update.
 *
 * Webhook-arrived rows aren't disturbed — the upsert means a
 * row that's already in sync is just rewritten with the same
 * data. The `last_synced_at` column bumps each pass.
 *
 * Returns `{ scannedSubscriptions, upsertedInvoices, errors }`
 * so admin can see the run summary. Errors per subscription are
 * collected rather than aborting the whole run — one broken
 * subscription doesn't poison the rest.
 */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const yearIdParam = req.nextUrl.searchParams.get("yearId");
    const yearId = Number(yearIdParam);
    if (!Number.isFinite(yearId) || yearId <= 0) {
      return NextResponse.json(
        { error: "yearId is required" },
        { status: 400 }
      );
    }

    const payments = await xano.familyPayments.getAllByYear(yearId);
    // Include canceled (`canceled:<id>` sentinel) subscriptions too —
    // their historical invoices are exactly what a backfill exists to
    // recover — by unwrapping the sentinel back to the raw Stripe id.
    const subs = payments
      .map((p) => ({
        payment: p,
        subscriptionId: p.stripe_subscription_id?.startsWith(
          STRIPE_SUB_CANCELED_PREFIX
        )
          ? p.stripe_subscription_id.slice(STRIPE_SUB_CANCELED_PREFIX.length)
          : (p.stripe_subscription_id ?? null),
      }))
      .filter(
        (s): s is { payment: (typeof payments)[number]; subscriptionId: string } =>
          !!s.subscriptionId
      );

    const stripe = getStripeClient();
    let upsertedInvoices = 0;
    const errors: Array<{ subscriptionId: string; message: string }> = [];

    for (const { payment, subscriptionId } of subs) {
      try {
        const invoices = await listAllInvoicesForSubscription(
          stripe,
          subscriptionId
        );
        for (const invoice of invoices) {
          if (!invoice.id) continue;
          await upsertInvoiceRow({
            stripe,
            invoice,
            familyId: Number(payment.registration_families_id),
            yearId: Number(payment.registration_school_years_id),
            paymentRowId: payment.id,
            subscriptionId,
          });
          upsertedInvoices += 1;
        }
      } catch (err) {
        errors.push({
          subscriptionId,
          message: err instanceof Error ? err.message : String(err),
        });
        console.error(
          `[/api/admin/billing/backfill] sub ${subscriptionId} failed:`,
          err
        );
      }
    }

    return NextResponse.json({
      scannedSubscriptions: subs.length,
      upsertedInvoices,
      errors,
    });
  } catch (err) {
    return handleAdminError(err);
  }
}

/**
 * Stripe's `invoices.list` is auto-paginated; this helper walks the
 * cursor until exhausted so we get every historical invoice for the
 * subscription, not just the most recent page. Limit per page is
 * Stripe's max (100) to minimize round trips.
 */
async function listAllInvoicesForSubscription(
  stripe: Stripe,
  subscriptionId: string
): Promise<Stripe.Invoice[]> {
  const out: Stripe.Invoice[] = [];
  let startingAfter: string | undefined = undefined;
  while (true) {
    const page = await stripe.invoices.list({
      subscription: subscriptionId,
      limit: 100,
      // `payments` is expandable-only — needed to recognize
      // out-of-band (check/cash) payment records below.
      expand: ["data.payments"],
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    out.push(...page.data);
    if (!page.has_more || page.data.length === 0) break;
    startingAfter = page.data[page.data.length - 1].id;
    if (!startingAfter) break;
  }
  return out;
}

async function upsertInvoiceRow({
  stripe,
  invoice,
  familyId,
  yearId,
  paymentRowId,
  subscriptionId,
}: {
  stripe: Stripe;
  invoice: Stripe.Invoice;
  familyId: number;
  yearId: number;
  paymentRowId: number;
  subscriptionId: string;
}): Promise<void> {
  if (!invoice.id) return;
  const now = Date.now();
  const status = invoice.status ?? "open";
  const periodStart = (invoice.period_start ?? 0) * 1000;
  const periodEnd = (invoice.period_end ?? 0) * 1000;
  const dueDate = invoice.due_date ? invoice.due_date * 1000 : null;
  // `status_transitions` carries the canonical paid_at + finalized_at
  // timestamps from Stripe. Falls back to "now" only if we're seeing
  // a status that should have a transition but doesn't (paranoid
  // path; Stripe always stamps these).
  const transitions = (
    invoice as Stripe.Invoice & {
      status_transitions?: {
        paid_at?: number | null;
        finalized_at?: number | null;
      } | null;
    }
  ).status_transitions;
  const paidAt =
    status === "paid"
      ? (transitions?.paid_at ?? null) && transitions?.paid_at
        ? transitions.paid_at! * 1000
        : now
      : null;
  const finalizedAt = transitions?.finalized_at
    ? transitions.finalized_at * 1000
    : null;

  // Strict lookup — a transient Xano failure must throw (collected in
  // the per-subscription error list) rather than coerce to null,
  // which would create a duplicate mirror row for this invoice.
  // Fetched BEFORE the payload so the paid-amount floor guard below
  // can read the existing row.
  const existing = await xano.paymentTransactions.findByStripeIdStrict(
    invoice.id
  );

  // Out-of-band (check/cash) payments report `amount_paid` 0 — money
  // Stripe never touched. The payments list (expanded on the fetch)
  // says so deterministically: a succeeded `payment_record` payment
  // means out-of-band, so the amount due counts as collected. The
  // floor guard below stays as a second net so a re-sync can never
  // un-count a recorded check payment either way.
  let reportedPaidCents = invoice.amount_paid ?? 0;
  if (
    status === "paid" &&
    reportedPaidCents === 0 &&
    (invoice.amount_due ?? 0) > 0 &&
    (invoice.payments?.data ?? []).some(
      (p) => p.status === "paid" && p.payment?.type === "payment_record"
    )
  ) {
    reportedPaidCents = invoice.amount_due ?? 0;
  }

  // Refund awareness — Stripe leaves a refunded invoice `paid` with
  // its full `amount_paid` forever, so a plain re-sync would
  // resurrect refunded money as "collected" and flip a webhook-
  // stamped `refunded` row back to Complete. For Stripe-collected
  // paid invoices, list the refunds on each succeeded payment intent
  // and net them out; fully refunded mirrors as our own `refunded`
  // status. Out-of-band (check/cash `payment_record`) payments have
  // no payment intent and can't be refunded through Stripe, so they
  // skip this naturally.
  let refundedCents = 0;
  if (status === "paid") {
    const paymentIntentIds = (invoice.payments?.data ?? [])
      .filter((p) => p.status === "paid")
      .map((p) =>
        typeof p.payment?.payment_intent === "string"
          ? p.payment.payment_intent
          : (p.payment?.payment_intent?.id ?? null)
      )
      .filter((id): id is string => !!id);
    for (const paymentIntentId of paymentIntentIds) {
      const refunds = await stripe.refunds.list({
        payment_intent: paymentIntentId,
        limit: 100,
      });
      refundedCents += refunds.data
        .filter((r) => r.status === "succeeded" || r.status === "pending")
        .reduce((acc, r) => acc + (r.amount ?? 0), 0);
    }
  }
  const netPaidCents = Math.max(reportedPaidCents - refundedCents, 0);
  const fullyRefunded =
    status === "paid" && refundedCents > 0 && netPaidCents === 0;

  // Omits `payment_method` — owned by the admin mark-paid route; a
  // re-sync must not clear it (PATCH leaves absent keys untouched).
  const payload: Omit<XanoPaymentTransaction, "id" | "created_at"> = {
    registration_families_id: familyId,
    registration_school_years_id: yearId,
    registration_families_payment_id: paymentRowId,
    stripe_invoice_id: invoice.id,
    stripe_subscription_id: subscriptionId,
    period_start: periodStart,
    period_end: periodEnd,
    amount_due_cents: invoice.amount_due ?? 0,
    // With refunds in play the freshly computed net is the truth and
    // the floor guard must NOT apply — it exists to protect recorded
    // check payments from a $0 re-sync, not to resurrect refunded
    // money.
    amount_paid_cents:
      refundedCents > 0
        ? netPaidCents
        : status === "paid"
          ? Math.max(reportedPaidCents, existing?.amount_paid_cents ?? 0)
          : reportedPaidCents,
    status: fullyRefunded ? "refunded" : status,
    hosted_invoice_url: invoice.hosted_invoice_url ?? null,
    invoice_pdf_url: invoice.invoice_pdf ?? null,
    due_date: dueDate,
    paid_at: paidAt,
    finalized_at: finalizedAt,
    last_synced_at: now,
  };

  if (existing) {
    await xano.paymentTransactions.update(existing.id, payload);
  } else {
    await xano.paymentTransactions.create(payload);
  }
}

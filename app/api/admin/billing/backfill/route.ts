import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
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
    const subs = payments.filter((p) => !!p.stripe_subscription_id);

    const stripe = getStripeClient();
    let upsertedInvoices = 0;
    const errors: Array<{ subscriptionId: string; message: string }> = [];

    for (const payment of subs) {
      const subscriptionId = payment.stripe_subscription_id!;
      try {
        const invoices = await listAllInvoicesForSubscription(
          stripe,
          subscriptionId
        );
        for (const invoice of invoices) {
          if (!invoice.id) continue;
          await upsertInvoiceRow({
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
  invoice,
  familyId,
  yearId,
  paymentRowId,
  subscriptionId,
}: {
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

  const payload: Omit<XanoPaymentTransaction, "id" | "created_at"> = {
    registration_families_id: familyId,
    registration_school_years_id: yearId,
    registration_families_payment_id: paymentRowId,
    stripe_invoice_id: invoice.id,
    stripe_subscription_id: subscriptionId,
    period_start: periodStart,
    period_end: periodEnd,
    amount_due_cents: invoice.amount_due ?? 0,
    amount_paid_cents: invoice.amount_paid ?? 0,
    status,
    hosted_invoice_url: invoice.hosted_invoice_url ?? null,
    invoice_pdf_url: invoice.invoice_pdf ?? null,
    due_date: dueDate,
    paid_at: paidAt,
    finalized_at: finalizedAt,
    last_synced_at: now,
  };

  const existing = await xano.paymentTransactions.findByStripeId(invoice.id);
  if (existing) {
    await xano.paymentTransactions.update(existing.id, payload);
  } else {
    await xano.paymentTransactions.create(payload);
  }
}

import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { xano } from "@/lib/xano";
import type { XanoPaymentTransaction } from "@/lib/xano";
import { verifyWebhookSignature } from "@/lib/stripe";

/**
 * Stripe webhook receiver. Stripe signs every event with a secret
 * shared via the Dashboard; we verify the signature before doing
 * anything else. A failed verification returns 400 — Stripe will
 * not retry (signature errors are caller-side problems, not transport
 * issues), but the failure shows in the Dashboard's webhook log.
 *
 * Idempotency: handlers upsert on natural keys
 * (`stripe_subscription_id` for the family-payment row,
 * `stripe_invoice_id` for the payment-transactions mirror). If Stripe
 * retries an event the second pass is a PATCH instead of a duplicate
 * INSERT, so we can't double-write.
 *
 * Billing model: subscriptions run in `send_invoice` mode — Stripe
 * generates a hosted invoice each month and emails the link to the
 * family. The parent has nothing to set up; admin creates the
 * Subscription on Confirm Registration. So there's no
 * `checkout.session.completed` handler — Checkout is dead in the
 * current flow.
 *
 * Events handled:
 *   - `customer.subscription.created` — admin created a Subscription
 *     (via the cascade on Confirm Registration or the manual Start
 *     Billing button). Persist `stripe_subscription_id` onto the
 *     family-payment row + back-fill `stripe_customer_id` on the
 *     family if it isn't already mirrored.
 *   - `customer.subscription.deleted` — admin canceled the
 *     subscription. Clear `stripe_subscription_id` so the admin
 *     Billing card flips back to the "Start Monthly Billing" empty
 *     state.
 *   - `invoice.finalized` — Stripe stamped + sent the invoice. UPSERT
 *     into the payment-transactions mirror so the admin billing
 *     aggregation surfaces have a row for this period.
 *   - `invoice.paid` — invoice cleared. UPSERT (status → paid,
 *     paid_at = now, amount_paid_cents updated).
 *   - `invoice.payment_failed` — UPSERT to keep amount_due in sync
 *     and bump the audit trail. Status stays `open` (Stripe's own
 *     attempt counter lives on the invoice).
 *   - `invoice.voided` — admin voided the invoice in Dashboard.
 *     UPSERT (status → void).
 *
 * Anything else is acknowledged with 200 so Stripe stops retrying
 * but logs the unhandled-event type for visibility.
 */

// Disable Next.js body parsing for this route — we need the raw
// request body string for signature verification.
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("stripe-signature");

  let event: Stripe.Event;
  try {
    event = verifyWebhookSignature(rawBody, signature);
  } catch (err) {
    console.error(
      "[/api/webhooks/stripe] signature verification failed:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { error: "Invalid signature" },
      { status: 400 }
    );
  }

  try {
    switch (event.type) {
      case "customer.subscription.created":
        await handleSubscriptionCreated(event.data.object);
        break;
      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(event.data.object);
        break;
      case "invoice.finalized":
      case "invoice.paid":
      case "invoice.payment_failed":
      case "invoice.voided":
        await upsertInvoiceFromEvent(event.type, event.data.object);
        break;
      default:
        // Acknowledge unhandled types so Stripe stops retrying. The
        // log line gives us a paper trail if we add new flows later.
        console.log(
          `[/api/webhooks/stripe] unhandled event type: ${event.type}`
        );
    }
    return NextResponse.json({ received: true });
  } catch (err) {
    // Transient handler errors → return 500 so Stripe retries with
    // backoff. The catch above for signature errors uses 400 so
    // Stripe doesn't retry signature mismatches.
    console.error(
      `[/api/webhooks/stripe] handler error for ${event.type}:`,
      err
    );
    return NextResponse.json(
      { error: "Handler failed" },
      { status: 500 }
    );
  }
}

/* ─────────────────────── Subscription handlers ─────────────────────── */

async function handleSubscriptionCreated(
  subscription: Stripe.Subscription
): Promise<void> {
  // Admin created the Subscription via the cascade on Confirm
  // Registration or the manual Start Billing button. Read family +
  // year off the metadata our create flow stamped on.
  const familyId = Number(subscription.metadata?.family_id);
  const yearId = Number(subscription.metadata?.year_id);
  if (!Number.isFinite(familyId) || !Number.isFinite(yearId)) {
    // Subscription wasn't created by our flow — leave it alone.
    return;
  }
  const customerId = idOrString(subscription.customer);
  await persistSubscriptionForFamily({
    familyId,
    yearId,
    subscriptionId: subscription.id,
    customerId,
  });
}

/**
 * Idempotently write the subscription id + customer id back to Xano.
 * Reads the current row first and skips writes for any field already
 * populated correctly, so retries are no-ops.
 */
async function persistSubscriptionForFamily({
  familyId,
  yearId,
  subscriptionId,
  customerId,
}: {
  familyId: number;
  yearId: number;
  subscriptionId: string;
  customerId: string | null;
}): Promise<void> {
  const payment = await xano.familyPayments.getByFamilyAndYear(
    familyId,
    yearId
  );
  if (!payment) {
    console.error(
      `[/api/webhooks/stripe] no family_payment row for (family=${familyId}, year=${yearId}) — can't persist subscription ${subscriptionId}`
    );
    return;
  }

  if (payment.stripe_subscription_id !== subscriptionId) {
    await xano.familyPayments.update(payment.id, {
      stripe_subscription_id: subscriptionId,
    });
  }

  // Backup write for the family's stripe_customer_id — the create
  // route writes this best-effort, but if it failed we fill in here.
  if (customerId) {
    try {
      const family = await xano.families.getById(familyId);
      if (family && family.stripe_customer_id !== customerId) {
        await xano.families.update(familyId, {
          stripe_customer_id: customerId,
        });
      }
    } catch (err) {
      // Best-effort — failing to mirror the customer id doesn't
      // break anything. Log and move on.
      console.error(
        `[/api/webhooks/stripe] failed to persist stripe_customer_id on family ${familyId}:`,
        err
      );
    }
  }
}

async function handleSubscriptionDeleted(
  subscription: Stripe.Subscription
): Promise<void> {
  const familyId = Number(subscription.metadata?.family_id);
  const yearId = Number(subscription.metadata?.year_id);
  if (!Number.isFinite(familyId) || !Number.isFinite(yearId)) return;

  const payment = await xano.familyPayments.getByFamilyAndYear(
    familyId,
    yearId
  );
  if (!payment) return;

  // Clear the subscription id so the admin Billing card flips back
  // to the "Start Monthly Billing" empty state. Admin can re-create
  // a fresh Subscription whenever they're ready.
  if (payment.stripe_subscription_id === subscription.id) {
    await xano.familyPayments.update(payment.id, {
      stripe_subscription_id: null,
    });
  }
}

/* ─────────────────────── Invoice mirror ─────────────────────── */

/**
 * Upsert the payment-transactions mirror from any of the four
 * invoice lifecycle events. Resolves (family, year) two ways — first
 * try the invoice's own `subscription_details.metadata`, then fall
 * back to looking up the family-payment row by `stripe_subscription_id`.
 * This redundancy matters because Stripe puts subscription metadata
 * on the invoice for newly-created invoices but older invoices (and
 * some retry paths) only carry it on the parent subscription record.
 */
async function upsertInvoiceFromEvent(
  eventType: string,
  invoice: Stripe.Invoice
): Promise<void> {
  if (!invoice.id) {
    console.warn(`[/api/webhooks/stripe] ${eventType} missing invoice id`);
    return;
  }
  const subscriptionId = invoiceSubscriptionId(invoice);
  if (!subscriptionId) {
    // No subscription — not a tuition invoice (maybe a one-off, or
    // pre-subscription). Nothing to mirror.
    console.log(
      `[/api/webhooks/stripe] ${eventType} for ${invoice.id} has no subscription — skipping mirror.`
    );
    return;
  }

  const { familyId, yearId, paymentRowId } = await resolveFamilyYearForInvoice(
    invoice,
    subscriptionId
  );
  if (!familyId || !yearId || !paymentRowId) {
    console.error(
      `[/api/webhooks/stripe] ${eventType}: could not resolve (family, year, paymentRow) for invoice ${invoice.id} / sub ${subscriptionId}. Skipping mirror.`
    );
    return;
  }

  const now = Date.now();
  // Stripe's status values: draft, open, paid, void, uncollectible.
  // We store whatever Stripe sends so the column matches the source
  // 1:1 — the UI does the friendly mapping ("Complete" / "Pending"
  // / "Failed").
  const status = invoice.status ?? "open";
  const paidAt =
    eventType === "invoice.paid" || status === "paid" ? now : null;
  const finalizedAtFromEvent =
    eventType === "invoice.finalized" ? now : null;
  const periodStart = (invoice.period_start ?? 0) * 1000;
  const periodEnd = (invoice.period_end ?? 0) * 1000;
  const dueDate = invoice.due_date ? invoice.due_date * 1000 : null;

  const existing = await xano.paymentTransactions.findByStripeId(invoice.id);

  // Preserve `finalized_at` on subsequent events — only the
  // `invoice.finalized` event should stamp it, but other events
  // (paid, payment_failed) may arrive without a prior finalized in
  // our log if the mirror is being backfilled or events arrived out
  // of order. Keep whatever timestamp we have.
  const finalizedAt =
    finalizedAtFromEvent ?? existing?.finalized_at ?? null;

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
    paid_at: paidAt ?? existing?.paid_at ?? null,
    finalized_at: finalizedAt,
    last_synced_at: now,
  };

  if (existing) {
    await xano.paymentTransactions.update(existing.id, payload);
  } else {
    await xano.paymentTransactions.create(payload);
  }
}

/**
 * Resolve (familyId, yearId, paymentRowId) for an invoice. Two
 * resolution paths:
 *   1. Read `subscription_details.metadata` off the invoice — Stripe
 *      sets this from the subscription's metadata at finalization
 *      time. Fastest path; no extra Xano calls.
 *   2. Fall back to looking up the family-payment row by
 *      `stripe_subscription_id`. We need the row id anyway for the
 *      FK column, so this always runs at least to fetch the row.
 */
async function resolveFamilyYearForInvoice(
  invoice: Stripe.Invoice,
  subscriptionId: string
): Promise<{
  familyId: number | null;
  yearId: number | null;
  paymentRowId: number | null;
}> {
  // The subscription_details field carries the subscription's
  // metadata at finalization time. Available on most modern invoice
  // events; older or non-subscription invoices may lack it.
  const subDetails = (
    invoice as Stripe.Invoice & {
      subscription_details?: {
        metadata?: Record<string, string | undefined> | null;
      } | null;
    }
  ).subscription_details;
  const metaFromInvoice = subDetails?.metadata ?? null;
  let familyId = metaFromInvoice
    ? Number(metaFromInvoice.family_id)
    : NaN;
  let yearId = metaFromInvoice
    ? Number(metaFromInvoice.year_id)
    : NaN;

  // We always need the family-payment row id (for the FK), so the
  // lookup happens regardless of whether we got metadata above.
  // We'll also use the row's family/year as the fallback if metadata
  // was missing.
  if (!Number.isFinite(familyId) || !Number.isFinite(yearId)) {
    const paymentRow = await findFamilyPaymentBySubscriptionId(
      subscriptionId
    );
    if (paymentRow) {
      familyId = Number(paymentRow.registration_families_id);
      yearId = Number(paymentRow.registration_school_years_id);
      return {
        familyId: Number.isFinite(familyId) ? familyId : null,
        yearId: Number.isFinite(yearId) ? yearId : null,
        paymentRowId: paymentRow.id,
      };
    }
    return { familyId: null, yearId: null, paymentRowId: null };
  }

  // Metadata had family + year; still need the paymentRowId.
  const paymentRow = await xano.familyPayments.getByFamilyAndYear(
    familyId,
    yearId
  );
  return {
    familyId,
    yearId,
    paymentRowId: paymentRow?.id ?? null,
  };
}

/**
 * Find the per-year family-payment row by its
 * `stripe_subscription_id`. No dedicated Xano endpoint for this —
 * we scan via the existing year-list endpoints. Inefficient but
 * only runs on the cold fallback path (metadata missing). The hot
 * path uses metadata and a direct (family, year) lookup.
 */
async function findFamilyPaymentBySubscriptionId(
  subscriptionId: string
): Promise<{
  id: number;
  registration_families_id: number;
  registration_school_years_id: number;
} | null> {
  // We don't have a "find by stripe_subscription_id" helper; this
  // path only fires when invoice metadata is missing, which should
  // be rare. If it becomes hot, add a dedicated Xano query.
  try {
    const years = await xano.schoolYears.getAll();
    for (const year of years) {
      const rows = await xano.familyPayments.getAllByYear(year.id);
      const match = rows.find(
        (r) => r.stripe_subscription_id === subscriptionId
      );
      if (match) {
        return {
          id: match.id,
          registration_families_id: Number(match.registration_families_id),
          registration_school_years_id: Number(
            match.registration_school_years_id
          ),
        };
      }
    }
    return null;
  } catch (err) {
    console.error(
      `[/api/webhooks/stripe] findFamilyPaymentBySubscriptionId(${subscriptionId}) failed:`,
      err
    );
    return null;
  }
}

/* ─────────────────────── Helpers ─────────────────────── */

/** Stripe expanded fields land as either a string id or an object
 *  with `.id`. Normalize to `string | null`. */
function idOrString(
  value: string | { id: string } | null | undefined
): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  return value.id;
}

/** Stripe's Invoice type has `subscription` as a loose `string | object`
 *  union the generated types don't fully model. Normalize to a string
 *  id we can log. */
function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const subscriptionField = (
    invoice as Stripe.Invoice & {
      subscription?: string | { id: string } | null;
    }
  ).subscription;
  return idOrString(subscriptionField);
}

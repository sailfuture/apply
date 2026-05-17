import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { xano } from "@/lib/xano";
import { verifyWebhookSignature } from "@/lib/stripe";

/**
 * Stripe webhook receiver. Stripe signs every event with a secret
 * shared via the Dashboard; we verify the signature before doing
 * anything else. A failed verification returns 400 — Stripe will
 * not retry (signature errors are caller-side problems, not transport
 * issues), but the failure shows in the Dashboard's webhook log.
 *
 * Idempotency: every state-change handler reads the current Xano row
 * first and skips the write when the field is already set. If Stripe
 * retries an event (legitimate transient retry), the second pass is
 * a no-op.
 *
 * Events handled:
 *   - `checkout.session.completed` — Checkout finished, subscription
 *     created. Pull `subscription` + `customer` from the Session,
 *     resolve the family-payment row via metadata, stamp
 *     `stripe_subscription_id` + `isStripeSetup: true`. Also
 *     idempotently write `stripe_customer_id` on the family in case
 *     the /api/payment-setup route's best-effort write missed.
 *   - `customer.subscription.created` — backup for the above; same
 *     logic, in case Stripe delivers `subscription.created` before
 *     `checkout.session.completed` (rare but documented as possible).
 *   - `invoice.payment_failed` — log for admin visibility. No Xano
 *     mirror needed; admin reads live from Stripe API.
 *   - `customer.subscription.deleted` — clear `isStripeSetup` so the
 *     parent registration step re-opens. Subscription id stays for
 *     audit trail.
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
      case "checkout.session.completed":
        await handleCheckoutCompleted(event.data.object);
        break;
      case "customer.subscription.created":
        await handleSubscriptionCreated(event.data.object);
        break;
      case "invoice.payment_failed":
        await handlePaymentFailed(event.data.object);
        break;
      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(event.data.object);
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

/* ─────────────────────── Handlers ─────────────────────── */

async function handleCheckoutCompleted(
  session: Stripe.Checkout.Session
): Promise<void> {
  // Subscription mode Checkout — both `subscription` and `customer`
  // should be present. They land as either a string id or an
  // expanded object depending on Stripe's whim; normalize.
  const subscriptionId = idOrString(session.subscription);
  const customerId = idOrString(session.customer);
  if (!subscriptionId) {
    console.warn(
      "[/api/webhooks/stripe] checkout.session.completed missing subscription id, session:",
      session.id
    );
    return;
  }

  // Resolve family + year from metadata. The /api/payment-setup route
  // stamps both on the session AND the subscription metadata, so
  // either source works; prefer session metadata since that's what we
  // explicitly own.
  const familyId = Number(session.metadata?.family_id);
  const yearId = Number(session.metadata?.year_id);
  if (!Number.isFinite(familyId) || !Number.isFinite(yearId)) {
    console.error(
      "[/api/webhooks/stripe] checkout.session.completed missing family_id/year_id metadata on session:",
      session.id
    );
    return;
  }

  await persistSubscriptionForFamily({
    familyId,
    yearId,
    subscriptionId,
    customerId,
  });
}

async function handleSubscriptionCreated(
  subscription: Stripe.Subscription
): Promise<void> {
  // Backup path — most of the time the checkout.session.completed
  // handler already persisted this. Read metadata off the
  // subscription itself (which /api/payment-setup also stamps via
  // `subscription_data.metadata`).
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
 * Idempotently write the subscription id + customer id + stripe-setup
 * flag back to Xano. Reads the current row first and skips writes
 * for any field already populated correctly, so retries are no-ops.
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

  const needsSubscriptionUpdate =
    payment.stripe_subscription_id !== subscriptionId ||
    payment.isStripeSetup !== true;
  if (needsSubscriptionUpdate) {
    await xano.familyPayments.update(payment.id, {
      stripe_subscription_id: subscriptionId,
      isStripeSetup: true,
    });
  }

  // Backup write for the family's stripe_customer_id — the route
  // handler tries this best-effort, but if it failed we want the
  // webhook to fill in.
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
      // break the subscription flow. Log and move on.
      console.error(
        `[/api/webhooks/stripe] failed to persist stripe_customer_id on family ${familyId}:`,
        err
      );
    }
  }
}

async function handlePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  // Admin reads live from Stripe for status, so we don't mirror
  // payment_status fields here. The log line + the Dashboard's
  // "Failed payments" view are the visibility surface. If we ever
  // want a Xano mirror for fast filtering, add a
  // `payment_health` enum field here and update it.
  const subscriptionField = (
    invoice as Stripe.Invoice & {
      subscription?: string | { id: string } | null;
    }
  ).subscription;
  const subscriptionId =
    typeof subscriptionField === "string"
      ? subscriptionField
      : subscriptionField?.id ?? null;
  console.warn(
    `[/api/webhooks/stripe] invoice.payment_failed for invoice ${invoice.id} (subscription ${subscriptionId}). Amount due: ${invoice.amount_due / 100}, attempt count: ${invoice.attempt_count}.`
  );
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

  // Flip the step gate back off so the parent's registration nav
  // surfaces the Payment Setup step again. Subscription id stays
  // on the row for admin audit; the new Checkout will overwrite it
  // when the parent re-runs payment setup.
  if (payment.isStripeSetup) {
    await xano.familyPayments.update(payment.id, {
      isStripeSetup: false,
    });
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

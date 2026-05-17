/**
 * Server-side Stripe client + helpers.
 *
 * The whole apply repo only needs Stripe on the server: every flow
 * (Checkout session creation, webhook handling, admin billing actions)
 * runs through Route Handlers. We never ship the secret key to the
 * browser — parent-side payment kicks off via a POST to
 * `/api/payment-setup`, which builds a Checkout Session and returns the
 * URL for `window.location.href = url`.
 *
 * Env vars (set on Vercel):
 *   STRIPE_SECRET_KEY         — `sk_live_...` (or `sk_test_...` on
 *                                preview deploys)
 *   STRIPE_WEBHOOK_SECRET     — `whsec_...` from Dashboard → Webhooks
 *   STRIPE_TUITION_PRODUCT_ID — the single Product all family
 *                                Subscriptions attach to (per-family
 *                                amounts go on the inline Price each
 *                                Subscription generates at creation
 *                                time, not on pre-created Price
 *                                objects)
 *   NEXT_PUBLIC_APP_URL       — base URL for Checkout success/cancel
 *                                redirects (e.g. `https://apply.sailfuture.org`)
 *
 * Architecture choices baked in here:
 *   - One Stripe Customer per family, long-lived across academic
 *     years. Customer ID is stored on `registration_families`.
 *   - One Stripe Subscription per family per year, with inline
 *     `price_data` carrying the family's scholarship-adjusted monthly
 *     amount. Subscription ID is stored on
 *     `registration_families_payment` (the per-year billing row,
 *     parallel to the existing PandaDoc envelope state).
 *   - `billing_cycle_anchor` lives on `registration_school_years` as
 *     `billing_start_date` (e.g. `2025-08-01`). Subscriptions created
 *     before that date use `trial_end = billing_start_date_unix` so
 *     the first charge defers to the anchor — no upfront charge at
 *     signup. Subscriptions created after the date charge immediately
 *     (we set `trial_end` to "now" effectively a no-op).
 *   - Admin reads live from Stripe for status displays (per the
 *     "read live" choice on rollout). We cache nothing here; the
 *     webhook handler is only for state-change events (subscription
 *     created / payment failed / canceled), not for routine display.
 */

import Stripe from "stripe";

// Lazy singleton — the module can be imported in client bundles
// transitively (e.g. through a re-export) without exploding if the
// env var is missing. The error fires only when something actually
// tries to talk to Stripe.
let cached: Stripe | null = null;

export function getStripeClient(): Stripe {
  if (cached) return cached;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error(
      "STRIPE_SECRET_KEY is not set. Add it to the Vercel environment " +
        "(both Production and Preview) before any Stripe route runs."
    );
  }
  cached = new Stripe(key, {
    // Pin the API version explicitly so a Stripe-side update doesn't
    // silently change response shapes. This matches the package's
    // `Stripe.LatestApiVersion` at install time (`stripe@22.1.1` →
    // `2026-04-22.dahlia`). Bump in lockstep with the SDK upgrade.
    apiVersion: "2026-04-22.dahlia",
    appInfo: {
      name: "SailFuture Apply",
      version: "1.0.0",
    },
  });
  return cached;
}

/** Return the Stripe Product ID that every family's tuition
 *  Subscription attaches to. The Product is created in the Stripe
 *  Dashboard (admin already has one configured); the env var just
 *  points us at it. */
export function getTuitionProductId(): string {
  const id = process.env.STRIPE_TUITION_PRODUCT_ID;
  if (!id) {
    throw new Error(
      "STRIPE_TUITION_PRODUCT_ID is not set. Find the 'Monthly Tuition' " +
        "Product in the Stripe Dashboard and add its `prod_...` id to the " +
        "Vercel environment."
    );
  }
  return id;
}

/** Base URL for success/cancel redirects after Stripe Checkout. Falls
 *  back to the request's origin when running locally so dev still
 *  works without `NEXT_PUBLIC_APP_URL` set. */
export function getAppBaseUrl(requestOrigin?: string): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    requestOrigin ??
    "http://localhost:3000"
  );
}

/* ─────────────────────── Customer helpers ─────────────────────── */

/**
 * Fetch the family's existing Stripe Customer or create a new one.
 *
 * `customerId` is the value previously stored on
 * `registration_families.stripe_customer_id` (may be null on first
 * signup). When present we retrieve to confirm it still exists — a
 * customer can be deleted in the Stripe dashboard, in which case we
 * fall through to create a fresh one.
 *
 * Returns `{ customer, created }` so the caller knows whether to
 * persist the new id back to Xano.
 */
export async function getOrCreateCustomer({
  customerId,
  familyName,
  primaryParentEmail,
  primaryParentName,
  familyId,
}: {
  customerId: string | null | undefined;
  familyName: string;
  primaryParentEmail: string;
  primaryParentName: string;
  familyId: number;
}): Promise<{ customer: Stripe.Customer; created: boolean }> {
  const stripe = getStripeClient();

  if (customerId) {
    try {
      const existing = await stripe.customers.retrieve(customerId);
      if (!existing.deleted) {
        return { customer: existing as Stripe.Customer, created: false };
      }
      // Customer was deleted in Stripe — fall through to recreate.
    } catch (err) {
      // Retrieve can fail if the id is bogus or for a different account
      // (e.g. switched from test → live). Log and recreate.
      console.warn(
        `[stripe] customers.retrieve(${customerId}) failed, will create a new Customer:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  const customer = await stripe.customers.create({
    email: primaryParentEmail,
    name: primaryParentName || familyName,
    description: familyName,
    metadata: {
      family_id: String(familyId),
      family_name: familyName,
    },
  });
  return { customer, created: true };
}

/* ─────────────────────── Checkout session ─────────────────────── */

interface CreateCheckoutInput {
  customerId: string;
  monthlyTuitionCents: number;
  /** ISO date string (YYYY-MM-DD) from `school_years.billing_start_date`.
   *  When the date is in the future, we set `trial_end` to that date so
   *  the first charge defers. When in the past or today, we bill
   *  immediately (no trial). */
  billingStartDate: string | null;
  familyId: number;
  yearId: number;
  /** Where to send the user on Checkout success / cancel. */
  successUrl: string;
  cancelUrl: string;
}

/**
 * Build a Stripe Checkout Session in subscription mode. Returns the
 * `{ url, id }` for client-side redirect. The Subscription is created
 * by Stripe upon Checkout completion — at that point our webhook
 * handler grabs the subscription id and persists it.
 *
 * `subscription_data.trial_end` defers the first invoice to the
 * school year's `billing_start_date`. If the date has already passed
 * (e.g. family enrolls mid-year), Stripe bills immediately — we omit
 * `trial_end` for past dates rather than passing a stale timestamp.
 */
export async function createCheckoutSession(
  input: CreateCheckoutInput
): Promise<Stripe.Checkout.Session> {
  const stripe = getStripeClient();
  const productId = getTuitionProductId();

  const billingAnchorUnix = (() => {
    if (!input.billingStartDate) return null;
    // Treat the date as midnight UTC so it's deterministic across the
    // admin's local timezone and Stripe's server clock.
    const ms = Date.parse(`${input.billingStartDate}T00:00:00Z`);
    if (!Number.isFinite(ms)) return null;
    const unix = Math.floor(ms / 1000);
    // Stripe requires trial_end to be at least 48 hours in the future
    // when set on a Subscription. Skip the trial if the date is too
    // close — better to bill immediately than have Checkout fail.
    const nowUnix = Math.floor(Date.now() / 1000);
    if (unix <= nowUnix + 48 * 60 * 60) return null;
    return unix;
  })();

  return stripe.checkout.sessions.create({
    mode: "subscription",
    customer: input.customerId,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          product: productId,
          unit_amount: input.monthlyTuitionCents,
          recurring: { interval: "month" },
        },
      },
    ],
    subscription_data: {
      ...(billingAnchorUnix ? { trial_end: billingAnchorUnix } : {}),
      metadata: {
        family_id: String(input.familyId),
        year_id: String(input.yearId),
      },
      description: `SailFuture Academy monthly tuition · family ${input.familyId} · year ${input.yearId}`,
    },
    // Link the Session back to our records so the webhook handler can
    // find them without re-querying Xano. `client_reference_id` is the
    // canonical place; we also stamp metadata as a backup for tooling
    // that filters in the Stripe Dashboard.
    client_reference_id: `family-${input.familyId}-year-${input.yearId}`,
    metadata: {
      family_id: String(input.familyId),
      year_id: String(input.yearId),
    },
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
  });
}

/* ─────────────────────── Admin billing reads ─────────────────────── */

export interface BillingSnapshot {
  subscription: Stripe.Subscription;
  invoices: Stripe.Invoice[];
  /** Most recent invoice that ended `paid`, used for the "Refund last
   *  invoice" admin action. Null when no successful invoice exists yet. */
  lastPaidInvoice: Stripe.Invoice | null;
  /** Quick-status pill: derived from subscription.status plus
   *  collection_paused so the admin UI doesn't have to know about
   *  every Stripe substatus. */
  statusLabel: "Active" | "Trialing" | "Past Due" | "Paused" | "Canceled" | "Incomplete" | "Unknown";
}

/**
 * Fetch subscription + last 12 invoices in two parallel calls. Used by
 * the admin Billing card on the family registration detail page. We
 * never cache this — the call only happens on admin page loads, and
 * the read latency is acceptable for a low-volume admin surface.
 */
export async function getBillingSnapshot(
  subscriptionId: string
): Promise<BillingSnapshot> {
  const stripe = getStripeClient();
  const [subscription, invoiceList] = await Promise.all([
    stripe.subscriptions.retrieve(subscriptionId, {
      expand: ["default_payment_method", "latest_invoice"],
    }),
    stripe.invoices.list({ subscription: subscriptionId, limit: 12 }),
  ]);

  const lastPaidInvoice =
    invoiceList.data.find((inv) => inv.status === "paid") ?? null;

  let statusLabel: BillingSnapshot["statusLabel"] = "Unknown";
  if (subscription.pause_collection) {
    statusLabel = "Paused";
  } else {
    switch (subscription.status) {
      case "active":
        statusLabel = "Active";
        break;
      case "trialing":
        statusLabel = "Trialing";
        break;
      case "past_due":
      case "unpaid":
        statusLabel = "Past Due";
        break;
      case "canceled":
        statusLabel = "Canceled";
        break;
      case "incomplete":
      case "incomplete_expired":
        statusLabel = "Incomplete";
        break;
      default:
        statusLabel = "Unknown";
    }
  }

  return {
    subscription,
    invoices: invoiceList.data,
    lastPaidInvoice,
    statusLabel,
  };
}

/* ─────────────────────── Admin billing actions ─────────────────────── */

/** Pause future invoice collection. Existing charges are unaffected;
 *  Stripe just stops generating new invoices until we resume. */
export async function pauseSubscription(
  subscriptionId: string
): Promise<Stripe.Subscription> {
  const stripe = getStripeClient();
  return stripe.subscriptions.update(subscriptionId, {
    pause_collection: { behavior: "void" },
  });
}

/** Clear the pause flag so future invoices generate normally. */
export async function resumeSubscription(
  subscriptionId: string
): Promise<Stripe.Subscription> {
  const stripe = getStripeClient();
  return stripe.subscriptions.update(subscriptionId, {
    pause_collection: null,
  });
}

/** Cancel at the end of the current billing period — preserves access
 *  through the period the family already paid for. The hard
 *  `subscriptions.cancel()` would be a different button if we ever
 *  add an "immediate cancel" admin action. */
export async function cancelSubscriptionAtPeriodEnd(
  subscriptionId: string
): Promise<Stripe.Subscription> {
  const stripe = getStripeClient();
  return stripe.subscriptions.update(subscriptionId, {
    cancel_at_period_end: true,
  });
}

/**
 * Update the family's monthly amount on an existing Subscription.
 * Stripe requires us to swap the SubscriptionItem with a new
 * inline-`price_data` payload since we don't have pre-created Prices
 * per family. Proration behavior follows Stripe defaults (creates
 * prorated line items on the next invoice); admin gets the standard
 * "next invoice will include a prorated difference" behavior.
 */
export async function updateSubscriptionMonthlyAmount({
  subscriptionId,
  newMonthlyCents,
}: {
  subscriptionId: string;
  newMonthlyCents: number;
}): Promise<Stripe.Subscription> {
  const stripe = getStripeClient();
  const productId = getTuitionProductId();
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const currentItem = subscription.items.data[0];
  if (!currentItem) {
    throw new Error(
      `Subscription ${subscriptionId} has no items — cannot update amount.`
    );
  }
  return stripe.subscriptions.update(subscriptionId, {
    items: [
      {
        id: currentItem.id,
        price_data: {
          currency: "usd",
          product: productId,
          unit_amount: newMonthlyCents,
          recurring: { interval: "month" },
        },
      },
    ],
    proration_behavior: "create_prorations",
  });
}

/**
 * Refund the most recent paid invoice on a Subscription. Refunds the
 * underlying Charge in full; partial refunds are out of scope for the
 * standard admin flow (admin can issue partial refunds via the Stripe
 * Dashboard directly).
 */
export async function refundInvoice(
  invoiceId: string
): Promise<Stripe.Refund> {
  const stripe = getStripeClient();
  const invoice = await stripe.invoices.retrieve(invoiceId);
  const paymentIntentField = (
    invoice as Stripe.Invoice & {
      payment_intent?: string | { id: string };
    }
  ).payment_intent;
  const paymentIntentId =
    typeof paymentIntentField === "string"
      ? paymentIntentField
      : paymentIntentField?.id ?? null;
  if (!paymentIntentId) {
    throw new Error(
      `Invoice ${invoiceId} has no payment_intent — nothing to refund.`
    );
  }
  return stripe.refunds.create({
    payment_intent: paymentIntentId,
    reason: "requested_by_customer",
  });
}

/* ─────────────────────── Webhook helpers ─────────────────────── */

/** Verify an incoming webhook signature using Stripe's helper. Throws
 *  if the signature doesn't match — the route handler should catch
 *  and return 400 so Stripe retries against a valid endpoint. */
export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null
): Stripe.Event {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error(
      "STRIPE_WEBHOOK_SECRET is not set — webhook verification cannot run."
    );
  }
  if (!signatureHeader) {
    throw new Error("Missing Stripe-Signature header on webhook request.");
  }
  return getStripeClient().webhooks.constructEvent(
    rawBody,
    signatureHeader,
    secret
  );
}

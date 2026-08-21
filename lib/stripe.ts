/**
 * Server-side Stripe client + helpers.
 *
 * The whole apply repo only needs Stripe on the server: every flow
 * (subscription creation, webhook handling, admin billing actions)
 * runs through Route Handlers. We never ship the secret key to the
 * browser.
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
 *   NEXT_PUBLIC_APP_URL       — base URL (e.g. `https://apply.sailfutureacademy.org`)
 *
 * Architecture choices baked in here:
 *   - One Stripe Customer per family, long-lived across academic
 *     years. Customer ID is stored on `registration_families`.
 *   - One Stripe Subscription per family per year, in `send_invoice`
 *     collection mode — Stripe generates a hosted invoice each month
 *     and emails the link to the family. No card on file required.
 *     Inline `price_data` carries the family's scholarship-adjusted
 *     monthly amount. Subscription ID lives on
 *     `registration_families_payment` (per-year billing row).
 *   - `billing_cycle_anchor` lives on `registration_school_years` as
 *     `billing_start_date` (e.g. `2025-08-01`). Subscriptions created
 *     before that date use `trial_end = billing_start_date_unix` so
 *     the first invoice defers to the anchor — no early invoicing at
 *     signup. Subscriptions created after the date invoice
 *     immediately.
 *   - Admin triggers subscription creation: cascade on Confirm Family
 *     Registration is the happy path; admin Billing card has a manual
 *     "Start Monthly Billing" button as the override / retry path
 *     when the cascade hit a precondition error.
 *   - Admin reads live from Stripe for status displays. We cache
 *     nothing here; the webhook handler is only for state-change
 *     events (subscription created/deleted, invoice paid/failed/finalized),
 *     not for routine display.
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
      // ONLY recreate when Stripe says the id genuinely doesn't exist
      // (bogus id, or test→live account switch). Transient failures
      // (network blip, 429, 5xx) must rethrow — treating them as
      // "customer gone" would mint a duplicate Customer, splitting
      // the family's billing history across two records.
      const code = (err as { code?: string; statusCode?: number }) ?? {};
      const isMissing =
        code.code === "resource_missing" || code.statusCode === 404;
      if (!isMissing) throw err;
      console.warn(
        `[stripe] customer ${customerId} no longer exists (resource_missing) — creating a new Customer.`
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

/* ─────────────────────── Invoice subscription ─────────────────────── */

interface CreateInvoiceSubscriptionInput {
  customerId: string;
  monthlyTuitionCents: number;
  /** ISO date string (YYYY-MM-DD) from `school_years.billing_start_date`.
   *  When the date is in the future, we set `trial_end` to that date so
   *  the first invoice fires on the anchor. When in the past or today,
   *  Stripe generates the first invoice immediately. */
  billingStartDate: string | null;
  familyId: number;
  yearId: number;
  /** Days from invoice issue date until it's marked overdue. Net 15
   *  per the SailFuture billing policy. */
  daysUntilDue?: number;
}

/**
 * Create a Stripe Subscription in `send_invoice` collection mode.
 * Stripe generates a hosted invoice each month and emails the link
 * to the customer — the family pays however they want (card on the
 * hosted page, ACH, or pay outside Stripe via check and admin marks
 * paid manually).
 *
 * Distinct from a charge-automatically subscription (which we used
 * to have): no card on file is required; the parent has nothing to
 * "set up" before billing kicks in. Admin triggers subscription
 * creation directly — either auto-cascade from Confirm Registration
 * or via the manual "Start Monthly Billing" button on the admin
 * Billing card.
 *
 * `subscription_data.trial_end` defers the first invoice to the
 * school year's `billing_start_date`. If the date has already passed
 * (e.g. family enrolls mid-year), Stripe issues the first invoice
 * immediately — we omit `trial_end` for past dates rather than
 * passing a stale timestamp.
 *
 * Returns the created Subscription; caller persists `id` onto the
 * `registration_families_payment.stripe_subscription_id` column.
 */
export async function createInvoiceSubscription(
  input: CreateInvoiceSubscriptionInput
): Promise<Stripe.Subscription> {
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
    // close — better to invoice immediately than have create fail.
    const nowUnix = Math.floor(Date.now() / 1000);
    if (unix <= nowUnix + 48 * 60 * 60) return null;
    return unix;
  })();

  return stripe.subscriptions.create({
    customer: input.customerId,
    // `send_invoice` flips Stripe from auto-charge-on-card to
    // generate-and-email-an-invoice. Required pairing with
    // `days_until_due`.
    collection_method: "send_invoice",
    days_until_due: input.daysUntilDue ?? 15,
    items: [
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
    ...(billingAnchorUnix ? { trial_end: billingAnchorUnix } : {}),
    metadata: {
      family_id: String(input.familyId),
      year_id: String(input.yearId),
    },
    description: `SailFuture Academy monthly tuition · family ${input.familyId} · year ${input.yearId}`,
  });
}

/* ─────────────────────── Admin billing reads ─────────────────────── */

export interface BillingSnapshot {
  subscription: Stripe.Subscription;
  invoices: Stripe.Invoice[];
  /** Most recent invoice with money actually collected THROUGH STRIPE
   *  — the only thing the admin "Refund last payment" action can act
   *  on, and the gate that shows/hides the button. Deliberately
   *  stricter than `status === "paid"`: $0 invoices (Stripe auto-pays
   *  them instantly, e.g. the creation invoice of a deferred-start
   *  subscription) and out-of-band payments (admin-recorded check/
   *  cash) are both `paid` with nothing refundable, and matching them
   *  offered a Refund button to families who never paid a cent. */
  lastPaidInvoice: Stripe.Invoice | null;
  /** Quick-status pill: derived from subscription.status plus
   *  collection_paused so the admin UI doesn't have to know about
   *  every Stripe substatus. */
  /** Display label for the status pill. We map Stripe's raw status
   *  values onto these friendlier labels — notably `trialing` →
   *  "Scheduled" because in our flow a "trialing" subscription is
   *  one whose first invoice is deferred until `billing_start_date`,
   *  not a free trial of the school. Calling it Scheduled keeps
   *  staff from misreading the pill. */
  statusLabel: "Active" | "Scheduled" | "Past Due" | "Paused" | "Canceled" | "Incomplete" | "Unknown";
}

/** When a subscription's next invoice will actually be EMAILED, from
 *  the Stripe fact that holds the date. Sources, in precedence order:
 *    - "draft"  — the invoice already exists as a draft; Stripe
 *      auto-finalizes (and emails) it at `automatically_finalizes_at`
 *      (24h after subscription creation for `send_invoice` subs). The
 *      webhook mirror can't see drafts — it fills on
 *      `invoice.finalized` — so a family's first day of billing reads
 *      as "no invoices" everywhere the mirror feeds.
 *    - "trial"  — future-anchored subscription; first invoice lands at
 *      `trial_end`.
 *    - "anchor" — future `billing_cycle_anchor` (the ≤48h create
 *      path); first invoice lands at the anchor.
 *    - "cycle"  — normal running subscription; next invoice at the
 *      current period's end. NOTE for zero-invoice mirrors: "cycle"
 *      means Stripe already issued an invoice this period, so a mirror
 *      showing none is a webhook/mirror problem, not a pending first
 *      invoice — callers deciding between "scheduled" and "something's
 *      wrong" must branch on the source.
 */
export interface NextInvoiceTiming {
  sendsAtMs: number;
  source: "draft" | "trial" | "anchor" | "cycle";
}

export async function getNextInvoiceTiming(
  subscriptionId: string
): Promise<NextInvoiceTiming | null> {
  const stripe = getStripeClient();
  const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
    expand: ["latest_invoice"],
  });
  const latest = subscription.latest_invoice as Stripe.Invoice | null;
  if (latest?.status === "draft" && latest.automatically_finalizes_at) {
    return {
      sendsAtMs: latest.automatically_finalizes_at * 1000,
      source: "draft",
    };
  }
  const nowUnix = Math.floor(Date.now() / 1000);
  if (subscription.status === "trialing" && subscription.trial_end) {
    return { sendsAtMs: subscription.trial_end * 1000, source: "trial" };
  }
  if (subscription.billing_cycle_anchor > nowUnix) {
    return {
      sendsAtMs: subscription.billing_cycle_anchor * 1000,
      source: "anchor",
    };
  }
  // Billing periods live on the items (flexible billing mode has no
  // subscription-level current_period_end).
  const cycleEnd = subscription.items.data[0]?.current_period_end;
  if (cycleEnd && cycleEnd > nowUnix) {
    return { sendsAtMs: cycleEnd * 1000, source: "cycle" };
  }
  return null;
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
    stripe.invoices.list({
      subscription: subscriptionId,
      limit: 12,
      // `payments` is expandable-only — needed below to tell a real
      // Stripe charge from an out-of-band payment record.
      expand: ["data.payments"],
    }),
  ]);

  // Refundable = money that moved THROUGH Stripe: a succeeded payment
  // backed by a PaymentIntent or Charge (the exact objects
  // `refundInvoice` refunds). Out-of-band check/cash payments appear
  // as a `payment_record` with neither, and $0 invoices (auto-paid at
  // creation for deferred-start subscriptions) carry no payment at
  // all — both are `status: "paid"`, which is how status alone put a
  // Refund button on families who never paid a cent. NOTE: the
  // `paid_out_of_band` invoice field is NOT usable here — Basil
  // removed it from the Invoice resource (it survives only as an
  // `invoices.pay` request param), so the payments list is the only
  // reliable discriminator on our pinned dahlia version.
  const lastPaidInvoice =
    invoiceList.data.find(
      (inv) =>
        inv.status === "paid" &&
        (inv.amount_paid ?? 0) > 0 &&
        (inv.payments?.data ?? []).some(
          (p) =>
            p.status === "paid" &&
            (p.payment?.payment_intent || p.payment?.charge)
        )
    ) ?? null;

  let statusLabel: BillingSnapshot["statusLabel"] = "Unknown";
  if (subscription.pause_collection) {
    statusLabel = "Paused";
  } else {
    switch (subscription.status) {
      case "active":
        statusLabel = "Active";
        break;
      case "trialing":
        // See `statusLabel` docstring — "Scheduled" reads more
        // accurately than Stripe's raw "Trialing" for the
        // "first invoice deferred until billing_start_date" state.
        statusLabel = "Scheduled";
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

/** Reverse a pending cancellation. Clears `cancel_at_period_end` so
 *  the subscription continues normally past the current period end.
 *  Only meaningful while the cancellation is still pending — once
 *  the period ends Stripe deletes the subscription and there's
 *  nothing to undo (admin must start a fresh subscription instead). */
export async function uncancelSubscription(
  subscriptionId: string
): Promise<Stripe.Subscription> {
  const stripe = getStripeClient();
  return stripe.subscriptions.update(subscriptionId, {
    cancel_at_period_end: false,
  });
}

/**
 * Refund a paid invoice in full. Partial refunds are out of scope for
 * the standard admin flow (admin can issue those via the Stripe
 * Dashboard directly).
 *
 * Payment resolution: on current API versions the invoice's payment
 * lives in the `payments` list (`invoice.payments.data[].payment`),
 * NOT the removed top-level `payment_intent` field — we expand the
 * list and refund the successful payment's PaymentIntent (or bare
 * Charge for out-of-band payments).
 *
 * `expectedSubscriptionId` is the ownership guard: the admin route
 * passes the family's own subscription id, and we refuse to refund an
 * invoice that belongs to any other subscription — otherwise a stale
 * or mistyped invoice id would silently refund ANOTHER family's
 * payment in full.
 */
export async function refundInvoice(
  invoiceId: string,
  opts?: { expectedSubscriptionId?: string }
): Promise<Stripe.Refund> {
  const stripe = getStripeClient();
  const invoice = await stripe.invoices.retrieve(invoiceId, {
    expand: ["payments"],
  });

  if (opts?.expectedSubscriptionId) {
    const owner = extractInvoiceSubscriptionId(invoice);
    if (owner !== opts.expectedSubscriptionId) {
      throw new Error(
        `Invoice ${invoiceId} belongs to subscription ${owner ?? "none"}, not this family's subscription — refusing to refund.`
      );
    }
  }

  const payments = invoice.payments?.data ?? [];
  // Only a SUCCEEDED payment is refundable — falling back to an
  // arbitrary first payment could target a canceled/failed attempt
  // and either error confusingly or refund the wrong object.
  const successful = payments.find((p) => p.status === "paid");
  const paymentIntentId = idOrObjectId(successful?.payment?.payment_intent);
  if (paymentIntentId) {
    return stripe.refunds.create({
      payment_intent: paymentIntentId,
      reason: "requested_by_customer",
    });
  }
  const chargeId = idOrObjectId(successful?.payment?.charge);
  if (chargeId) {
    return stripe.refunds.create({
      charge: chargeId,
      reason: "requested_by_customer",
    });
  }
  throw new Error(
    `Invoice ${invoiceId} has no refundable payment on record — nothing to refund.`
  );
}

/* ─────────────────────── Per-student subscription items ───────── */

/**
 * One per-student line on a family's monthly subscription. The
 * caller (Phase 2 wiring in `lib/billing.ts`) builds this from the
 * per-student tuition math + the student record.
 */
export interface StudentItemInput {
  /** Internal Xano student id — round-tripped through Stripe
   *  metadata so webhook handlers can map a Stripe line back to a
   *  student row without an extra round trip. */
  studentId: number;
  /** Display name on the parent's invoice line ("Hunter Thompson").
   *  Shows up as the line description; the named Price below carries
   *  a fuller "<Family> — <Student> — <Year>" string for the
   *  Stripe Dashboard. */
  studentName: string;
  /** Per-student monthly amount in cents. Each student gets a
   *  one-off `Price` at this amount — same student-by-student
   *  math the family-level total used to roll up. */
  monthlyCents: number;
}

interface CreatePerStudentSubscriptionInput {
  customerId: string;
  /** Used only to name the Price in the Stripe Dashboard so admin
   *  can scan the catalog. Format: `<Family> — <Student> — <Year>`. */
  familyName: string;
  yearName: string;
  /** Whichever students are active for this family-year at the
   *  moment the subscription is created. Order is preserved on the
   *  resulting `items` map so the caller can persist per-student
   *  ids by zipping arrays if it wants. */
  students: StudentItemInput[];
  /** Same `trial_end` semantics as `createInvoiceSubscription` —
   *  ISO date, defers the first invoice when in the future. */
  billingStartDate: string | null;
  /** The year's FIRST DAY OF SCHOOL (`school_years.start_date`, ISO
   *  date). The pivot for late enrollments once billing has begun:
   *  enrolled on/before this day → the family owes the current month
   *  and is invoiced immediately; enrolled after it → billing starts
   *  on the 1st of next month. */
  yearStartDate?: string | null;
  familyId: number;
  yearId: number;
  /** Defaults to 15 (SailFuture's standard net-15 terms). */
  daysUntilDue?: number;
  /** Stripe idempotency-key base. When set, every `prices.create` and
   *  the `subscriptions.create` carry deterministic idempotency keys
   *  derived from it — so two concurrent "Start Monthly Billing"
   *  clicks (double-click, two admins, retry-after-timeout) hit the
   *  same keys and Stripe returns the SAME objects instead of
   *  creating a second live subscription that double-bills the
   *  family. Caller derives the base from (family, year, prior
   *  subscription state) so a legitimate restart after a cancel gets
   *  fresh keys. */
  idempotencyKeyBase?: string;
}

/** Result of the per-student subscription create. The `items` array
 *  carries the studentId → subscriptionItemId mapping so the caller
 *  can persist `stripe_subscription_item_id` onto each student row. */
export interface PerStudentSubscriptionResult {
  subscription: Stripe.Subscription;
  items: Array<{
    studentId: number;
    subscriptionItemId: string;
    /** The dedicated Price created for this student. Stored on the
     *  result mostly for audit / debugging — callers don't currently
     *  need to persist it since the SubscriptionItem id alone is
     *  enough to remove the student from billing later. */
    priceId: string;
  }>;
}

/**
 * Create a family Stripe Subscription with one line item per
 * active student. Replaces the family-level single-item shape used
 * by `createInvoiceSubscription` — one customer, one subscription,
 * one invoice per month, but the invoice carries N itemized lines
 * so the parent sees per-student amounts.
 *
 * Each student gets a dedicated one-off `Price` (created inline
 * via `stripe.prices.create`, not catalogued — see the design
 * thread in the conversation history for why ad-hoc beats a
 * shared catalog for our use case). The price's `unit_amount` is
 * the per-student monthly cents from the caller's math, and its
 * `nickname` (`<Family> — <Student> — <Year>`) helps admins scan
 * the Dashboard.
 *
 * Student names land on the parent's invoice via the Price's
 * inline `product_data.name` (`<Student> — Monthly Tuition &
 * Fees`). Stripe derives each invoice line's text from the
 * product name — subscription items have no description field —
 * so a product per student is the only way to label the lines.
 * This mints a Stripe Product per student (and another on each
 * re-price), the same accumulation tradeoff we already accept for
 * one-off Prices.
 *
 * Side-effects on each student row are the caller's job: take the
 * returned `items` map and persist each
 * `subscriptionItemId` onto the matching
 * `registration_students.stripe_subscription_item_id`. We don't
 * touch Xano here so this helper stays pure-Stripe and reusable
 * from any orchestration site.
 */
/** Has the year's first day of school fully passed? "Enrolled ON the
 *  first day" still counts as before — the family attended from day
 *  one and owes the current month. Missing/unparsable start date
 *  reads as "not started", which falls back to invoice-now (the
 *  pre-start behavior) rather than silently deferring a month. */
function schoolYearHasStarted(yearStartDate: string | null | undefined): boolean {
  if (!yearStartDate) return false;
  const startMs = Date.parse(`${yearStartDate}T00:00:00Z`);
  if (!Number.isFinite(startMs)) return false;
  // End of that calendar day, Eastern (~05:00 UTC next day).
  return Date.now() > startMs + (24 + 5) * 60 * 60 * 1000;
}

/** Unix timestamp of the 1st of next month, on the SCHOOL's calendar
 *  (America/New_York) — so a family enrolled late in the evening of
 *  the 31st doesn't get pushed an extra month by the UTC date already
 *  having rolled over. 05:00 UTC ≈ midnight Eastern; the exact hour
 *  only needs to land on the right calendar day. */
function firstOfNextMonthUnix(): number {
  const nyNow = new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/New_York" })
  );
  return Math.floor(
    Date.UTC(nyNow.getFullYear(), nyNow.getMonth() + 1, 1, 5) / 1000
  );
}

export async function createSubscriptionWithStudentItems(
  input: CreatePerStudentSubscriptionInput
): Promise<PerStudentSubscriptionResult> {
  const stripe = getStripeClient();

  // First-invoice anchoring. Four regimes (the school's rule — the
  // pivot for late enrollments is the FIRST DAY OF SCHOOL, not the
  // billing date):
  //   - billing start > 48h out  → `trial_end` (proven path; Stripe
  //     requires trial_end comfortably in the future)
  //   - billing start in the future but ≤ 48h → `billing_cycle_anchor`
  //     + no proration. The old behavior silently DROPPED the anchor
  //     here, invoicing the family immediately (up to 2 days early)
  //     and anchoring all 12 invoices to the wrong day of month.
  //   - billing start PASSED, but school hasn't started yet (or
  //     starts today) → invoice IMMEDIATELY: the family is joining
  //     for the current month and owes it. (Their later invoices ride
  //     the enrollment day-of-month rather than the 1st — acceptable;
  //     invoicing the current month is the priority.)
  //   - billing start passed AND the first day of school has passed →
  //     anchor to the FIRST OF NEXT MONTH, no proration. They joined
  //     mid-term after the month's run, so they start with the next
  //     month, aligned to the 1sts with everyone else.
  //   - (billing start missing / unparsable → invoice now; there's no
  //     year billing policy to align to.)
  const { trialEndUnix, cycleAnchorUnix } = (() => {
    if (!input.billingStartDate) {
      return { trialEndUnix: null, cycleAnchorUnix: null };
    }
    const ms = Date.parse(`${input.billingStartDate}T00:00:00Z`);
    if (!Number.isFinite(ms)) {
      return { trialEndUnix: null, cycleAnchorUnix: null };
    }
    const unix = Math.floor(ms / 1000);
    const nowUnix = Math.floor(Date.now() / 1000);
    if (unix <= nowUnix) {
      return schoolYearHasStarted(input.yearStartDate)
        ? { trialEndUnix: null, cycleAnchorUnix: firstOfNextMonthUnix() }
        : { trialEndUnix: null, cycleAnchorUnix: null };
    }
    if (unix <= nowUnix + 48 * 60 * 60) {
      return { trialEndUnix: null, cycleAnchorUnix: unix };
    }
    return { trialEndUnix: unix, cycleAnchorUnix: null };
  })();

  if (input.students.length === 0) {
    throw new Error(
      "createSubscriptionWithStudentItems called with zero students — at least one is required."
    );
  }

  // Create one Price per student, sequentially, so we can attach a
  // nickname for the Stripe Dashboard. Parallelizing would be a
  // minor latency win but breaks the deterministic ordering we
  // want in the `items` result.
  const studentPrices: Array<{
    studentId: number;
    studentName: string;
    monthlyCents: number;
    priceId: string;
  }> = [];
  for (const s of input.students) {
    const price = await stripe.prices.create(
      {
        currency: "usd",
        unit_amount: s.monthlyCents,
        product_data: {
          name: `${s.studentName} — Monthly Tuition & Fees`,
          metadata: {
            family_id: String(input.familyId),
            year_id: String(input.yearId),
            student_id: String(s.studentId),
          },
        },
        recurring: { interval: "month" },
        nickname: `${input.familyName} — ${s.studentName} — ${input.yearName}`,
        metadata: {
          family_id: String(input.familyId),
          year_id: String(input.yearId),
          student_id: String(s.studentId),
        },
      },
      input.idempotencyKeyBase
        ? {
            idempotencyKey: `${input.idempotencyKeyBase}:price:s${s.studentId}:c${s.monthlyCents}`,
          }
        : undefined
    );
    studentPrices.push({
      studentId: s.studentId,
      studentName: s.studentName,
      monthlyCents: s.monthlyCents,
      priceId: price.id,
    });
  }

  const subscription = await stripe.subscriptions.create(
    {
      customer: input.customerId,
      collection_method: "send_invoice",
      days_until_due: input.daysUntilDue ?? 15,
      items: studentPrices.map((s) => ({
        price: s.priceId,
        quantity: 1,
        metadata: {
          student_id: String(s.studentId),
        },
      })),
      ...(trialEndUnix ? { trial_end: trialEndUnix } : {}),
      ...(cycleAnchorUnix
        ? {
            billing_cycle_anchor: cycleAnchorUnix,
            proration_behavior: "none" as const,
          }
        : {}),
      metadata: {
        family_id: String(input.familyId),
        year_id: String(input.yearId),
      },
      // Parent-visible: the customer portal ("Manage subscription")
      // renders this description verbatim, so it carries names only —
      // the internal Xano ids live in `metadata` below.
      description: `SailFuture Academy Monthly Tuition — ${input.familyName} (${input.yearName})`,
    },
    input.idempotencyKeyBase
      ? { idempotencyKey: `${input.idempotencyKeyBase}:sub` }
      : undefined
  );

  // Zip the created SubscriptionItems back onto the studentPrices
  // by matching on the metadata.student_id stamp we just set —
  // safer than relying on array index alignment in case Stripe
  // returns the items in a different order than we sent them.
  const itemsByStudentId = new Map<number, string>();
  for (const item of subscription.items.data) {
    const stamped = item.metadata?.student_id;
    if (!stamped) continue;
    const sid = Number(stamped);
    if (Number.isFinite(sid)) itemsByStudentId.set(sid, item.id);
  }

  const items = studentPrices.map((s) => {
    const subscriptionItemId = itemsByStudentId.get(s.studentId);
    if (!subscriptionItemId) {
      throw new Error(
        `Stripe returned no SubscriptionItem for student ${s.studentId} after create. ` +
          `Created subscription ${subscription.id} — admin should reconcile manually.`
      );
    }
    return {
      studentId: s.studentId,
      subscriptionItemId,
      priceId: s.priceId,
    };
  });

  return { subscription, items };
}

interface AddStudentItemInput {
  subscriptionId: string;
  /** Family/student/year naming for the Price nickname — same
   *  format the create flow uses so the Dashboard catalog stays
   *  consistent regardless of which entrypoint added the student. */
  familyName: string;
  studentName: string;
  yearName: string;
  /** Per-student monthly amount in cents. */
  monthlyCents: number;
  studentId: number;
  familyId: number;
  yearId: number;
}

/** Result of adding one student to an existing subscription. Caller
 *  persists `subscriptionItemId` onto the student row. */
export interface AddStudentItemResult {
  subscriptionItemId: string;
  priceId: string;
}

/**
 * Add a single student's recurring tuition line to an existing
 * family subscription. Used when a family adds a student mid-cycle
 * (new student joins after the subscription is already running) or
 * when an admin re-enrolls a previously-archived student.
 *
 * Defaults `proration_behavior: 'none'` — matches the user's spec
 * for mid-cycle additions: the new student doesn't pay this cycle,
 * joins billing on the next invoice. Caller can override if a
 * specific case warrants proration.
 */
export async function addStudentItemToSubscription(
  input: AddStudentItemInput
): Promise<AddStudentItemResult> {
  const stripe = getStripeClient();

  // Deterministic idempotency keys so two concurrent reconciles (the
  // Start button + an un-archive cascade racing, or two admins) get
  // the SAME item back from Stripe instead of double-adding — and
  // double-billing — the student. The hour bucket bounds the dedupe
  // window: retries/races within the hour collapse, while a genuine
  // remove-then-re-add days later gets fresh keys. (A re-add within
  // the same hour of a removal can hand back the deleted item's id —
  // rare admin flip-flop; the reconcile's stale-handle healing
  // converges it on the next pass.)
  const hourBucket = Math.floor(Date.now() / 3_600_000);
  const keyBase = `additem:${input.subscriptionId}:s${input.studentId}:c${input.monthlyCents}:h${hourBucket}`;

  const price = await stripe.prices.create(
    {
      currency: "usd",
      unit_amount: input.monthlyCents,
      product_data: {
        name: `${input.studentName} — Monthly Tuition & Fees`,
        metadata: {
          family_id: String(input.familyId),
          year_id: String(input.yearId),
          student_id: String(input.studentId),
        },
      },
      recurring: { interval: "month" },
      nickname: `${input.familyName} — ${input.studentName} — ${input.yearName}`,
      metadata: {
        family_id: String(input.familyId),
        year_id: String(input.yearId),
        student_id: String(input.studentId),
      },
    },
    { idempotencyKey: `${keyBase}:price` }
  );

  const item = await stripe.subscriptionItems.create(
    {
      subscription: input.subscriptionId,
      price: price.id,
      quantity: 1,
      proration_behavior: "none",
      metadata: {
        student_id: String(input.studentId),
      },
    },
    { idempotencyKey: `${keyBase}:item` }
  );

  return { subscriptionItemId: item.id, priceId: price.id };
}

interface UpdateStudentItemInput {
  subscriptionItemId: string;
  /** Family/student/year naming for the new Price's nickname — same
   *  format the create + add flows use so the Dashboard catalog
   *  stays consistent. */
  familyName: string;
  studentName: string;
  yearName: string;
  /** New per-student monthly amount in cents. */
  monthlyCents: number;
  studentId: number;
  familyId: number;
  yearId: number;
}

export interface UpdateStudentItemResult {
  subscriptionItemId: string;
  /** New Price id pointing the item at the updated monthly amount.
   *  Returned so callers can audit / persist if they want; the
   *  SubscriptionItem id itself doesn't change. */
  priceId: string;
}

/**
 * Re-price a single student's recurring tuition line. Used when
 * admin edits a per-student value on the Scholarship Determination
 * card and the packet's `monthly_amount` changes — we mint a new
 * one-off Stripe Price at the new amount and swap the
 * SubscriptionItem to point at it.
 *
 * Defaults `proration_behavior: 'none'` (matches the rest of the
 * per-student helpers): family pays the current month at the
 * existing amount; the new amount kicks in on the next invoice.
 *
 * The SubscriptionItem id itself doesn't change — only its underlying
 * Price — so the packet row's `stripe_subscription_item_id` stays
 * the same handle. The previous Price is left behind in the Stripe
 * Dashboard as a historical record; one-off Prices accumulate but
 * that's the tradeoff we picked when going ad-hoc instead of
 * cataloged. Each new Price gets a fresh `nickname` derived from
 * the same `<Family> — <Student> — <Year>` format so admin can
 * still scan the catalog.
 */
export async function updateStudentItemAmount(
  input: UpdateStudentItemInput
): Promise<UpdateStudentItemResult> {
  const stripe = getStripeClient();

  const price = await stripe.prices.create({
    currency: "usd",
    unit_amount: input.monthlyCents,
    product_data: {
      name: `${input.studentName} — Monthly Tuition & Fees`,
      metadata: {
        family_id: String(input.familyId),
        year_id: String(input.yearId),
        student_id: String(input.studentId),
      },
    },
    recurring: { interval: "month" },
    nickname: `${input.familyName} — ${input.studentName} — ${input.yearName}`,
    metadata: {
      family_id: String(input.familyId),
      year_id: String(input.yearId),
      student_id: String(input.studentId),
    },
  });

  await stripe.subscriptionItems.update(input.subscriptionItemId, {
    price: price.id,
    proration_behavior: "none",
  });

  return { subscriptionItemId: input.subscriptionItemId, priceId: price.id };
}

/** Outcome of removing a student's line — communicates whether the
 *  removal also retired the parent subscription (i.e. the student
 *  was the last one). Callers use this to decide whether to clear
 *  the family-level `stripe_subscription_id` too. */
export interface RemoveStudentItemResult {
  /** True when the subscription itself was cancelled because the
   *  removed item was the last one. */
  subscriptionCancelled: boolean;
  /** When `subscriptionCancelled === true`, the updated
   *  Subscription object so the caller can read `cancel_at` to
   *  populate UI. Null when only the item was removed and the
   *  subscription itself continues. */
  subscription: Stripe.Subscription | null;
}

/**
 * Remove a single student's recurring tuition line from a family's
 * subscription. Defaults `proration_behavior: 'none'` — per the
 * user's spec, the family pays the current month in full and the
 * student drops off the next invoice.
 *
 * When the removed item is the **last** item on the subscription,
 * this helper also cancels the subscription itself
 * (`cancel_at_period_end: true`) so the family doesn't sit on an
 * empty $0 subscription. Caller can use the `subscriptionCancelled`
 * flag to update the family-level Stripe column.
 */
export async function removeStudentItemFromSubscription({
  subscriptionId,
  subscriptionItemId,
}: {
  subscriptionId: string;
  subscriptionItemId: string;
}): Promise<RemoveStudentItemResult> {
  const stripe = getStripeClient();
  const isMissing = (err: unknown): boolean => {
    const code = (err as { code?: string; statusCode?: number }) ?? {};
    return code.code === "resource_missing" || code.statusCode === 404;
  };

  // Check sibling state BEFORE deciding how to remove. Two reasons:
  //   1. Stripe REFUSES to delete the last item on a subscription
  //      (invalid_request_error: a subscription must keep ≥1 item) —
  //      for the last student the only valid move is to cancel the
  //      subscription itself; the item retires with it. Deleting
  //      first and cancelling after (the old order) made the cancel
  //      branch unreachable and single-student families un-removable.
  //   2. If the item is ALREADY gone (removed via the Dashboard or a
  //      prior partly-failed attempt), that's success, not an error —
  //      treating 404 as fatal wedged the delete/archive flows
  //      permanently.
  let subscriptionBefore: Stripe.Subscription;
  try {
    subscriptionBefore = await stripe.subscriptions.retrieve(subscriptionId);
  } catch (err) {
    if (isMissing(err)) {
      // Subscription itself no longer exists — the item is gone with
      // it. Nothing to remove or cancel.
      return { subscriptionCancelled: false, subscription: null };
    }
    throw err;
  }
  if (["canceled", "incomplete_expired"].includes(subscriptionBefore.status)) {
    // Dead subscription — items died with it.
    return { subscriptionCancelled: false, subscription: null };
  }

  const liveItemIds = subscriptionBefore.items.data.map((i) => i.id);
  if (!liveItemIds.includes(subscriptionItemId)) {
    // Already removed (Dashboard cleanup, earlier retry) — success.
    return { subscriptionCancelled: false, subscription: null };
  }

  const isLastItem =
    liveItemIds.length === 1 && liveItemIds[0] === subscriptionItemId;

  if (isLastItem) {
    // Last student leaving — cancel the subscription at period end
    // (family keeps access through the cycle they already paid for;
    // matches the other cancel paths in this file). Do NOT attempt
    // the item delete: Stripe rejects deleting the only item.
    const cancelled = await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: true,
    });
    return { subscriptionCancelled: true, subscription: cancelled };
  }

  try {
    await stripe.subscriptionItems.del(subscriptionItemId, {
      proration_behavior: "none",
    });
  } catch (err) {
    // Raced with another remover — already gone counts as done.
    if (!isMissing(err)) throw err;
  }
  return { subscriptionCancelled: false, subscription: null };
}

/* ─────────────────────── Webhook helpers ─────────────────────── */

/** Normalize Stripe's `string | { id } | null | undefined` expandable
 *  fields to a plain id. */
function idOrObjectId(
  value: string | { id: string } | null | undefined
): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

/**
 * The subscription that generated an invoice, across API versions.
 *
 * Basil (2025-03) moved the invoice→subscription link from the
 * top-level `invoice.subscription` field to
 * `invoice.parent.subscription_details.subscription`. The webhook
 * endpoint's configured API version decides which shape events carry,
 * so we read the NEW location first and fall back to the legacy field
 * — reading only the legacy field silently classifies every modern
 * invoice event as "not a subscription invoice" and kills the mirror.
 */
export function extractInvoiceSubscriptionId(
  invoice: Stripe.Invoice
): string | null {
  const fromParent = idOrObjectId(
    invoice.parent?.subscription_details?.subscription ?? null
  );
  if (fromParent) return fromParent;
  const legacy = (
    invoice as Stripe.Invoice & {
      subscription?: string | { id: string } | null;
    }
  ).subscription;
  return idOrObjectId(legacy);
}

/**
 * The subscription metadata snapshot on an invoice, across API
 * versions — new `parent.subscription_details.metadata` first, legacy
 * top-level `subscription_details.metadata` fallback. Carries our
 * `family_id` / `year_id` stamps.
 */
export function extractInvoiceSubscriptionMetadata(
  invoice: Stripe.Invoice
): Record<string, string | undefined> | null {
  const fromParent = invoice.parent?.subscription_details?.metadata;
  if (fromParent && Object.keys(fromParent).length > 0) return fromParent;
  const legacy = (
    invoice as Stripe.Invoice & {
      subscription_details?: {
        metadata?: Record<string, string | undefined> | null;
      } | null;
    }
  ).subscription_details;
  return legacy?.metadata ?? null;
}

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

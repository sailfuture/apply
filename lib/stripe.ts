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
 *   NEXT_PUBLIC_APP_URL       — base URL (e.g. `https://apply.sailfuture.org`)
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
  /** Most recent invoice that ended `paid`, used for the "Refund last
   *  invoice" admin action. Null when no successful invoice exists yet. */
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
  familyId: number;
  yearId: number;
  /** Defaults to 15 (SailFuture's standard net-15 terms). */
  daysUntilDue?: number;
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
 * shared catalog for our use case). Each Price gets a
 * `nickname` so admins scanning the Stripe Dashboard can tell
 * which family/student/year the line belongs to. The price's
 * `unit_amount` is the per-student monthly cents from the
 * caller's math.
 *
 * `description` on the SubscriptionItem becomes the line text on
 * the hosted invoice the parent receives — set to "<Student> —
 * Monthly tuition" so the parent sees student names on their
 * receipt without admin/internal Family-Year decoration leaking
 * through.
 *
 * Side-effects on each student row are the caller's job: take the
 * returned `items` map and persist each
 * `subscriptionItemId` onto the matching
 * `registration_students.stripe_subscription_item_id`. We don't
 * touch Xano here so this helper stays pure-Stripe and reusable
 * from any orchestration site.
 */
export async function createSubscriptionWithStudentItems(
  input: CreatePerStudentSubscriptionInput
): Promise<PerStudentSubscriptionResult> {
  const stripe = getStripeClient();
  const productId = getTuitionProductId();

  // Same trial-end derivation as the legacy single-item flow —
  // mirrored exactly so the two paths behave the same on dates.
  const billingAnchorUnix = (() => {
    if (!input.billingStartDate) return null;
    const ms = Date.parse(`${input.billingStartDate}T00:00:00Z`);
    if (!Number.isFinite(ms)) return null;
    const unix = Math.floor(ms / 1000);
    const nowUnix = Math.floor(Date.now() / 1000);
    if (unix <= nowUnix + 48 * 60 * 60) return null;
    return unix;
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
    const price = await stripe.prices.create({
      currency: "usd",
      unit_amount: s.monthlyCents,
      product: productId,
      recurring: { interval: "month" },
      nickname: `${input.familyName} — ${s.studentName} — ${input.yearName}`,
      metadata: {
        family_id: String(input.familyId),
        year_id: String(input.yearId),
        student_id: String(s.studentId),
      },
    });
    studentPrices.push({
      studentId: s.studentId,
      studentName: s.studentName,
      monthlyCents: s.monthlyCents,
      priceId: price.id,
    });
  }

  const subscription = await stripe.subscriptions.create({
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
    ...(billingAnchorUnix ? { trial_end: billingAnchorUnix } : {}),
    metadata: {
      family_id: String(input.familyId),
      year_id: String(input.yearId),
    },
    description: `SailFuture Academy monthly tuition · family ${input.familyId} · year ${input.yearId}`,
  });

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
  const productId = getTuitionProductId();

  const price = await stripe.prices.create({
    currency: "usd",
    unit_amount: input.monthlyCents,
    product: productId,
    recurring: { interval: "month" },
    nickname: `${input.familyName} — ${input.studentName} — ${input.yearName}`,
    metadata: {
      family_id: String(input.familyId),
      year_id: String(input.yearId),
      student_id: String(input.studentId),
    },
  });

  const item = await stripe.subscriptionItems.create({
    subscription: input.subscriptionId,
    price: price.id,
    quantity: 1,
    proration_behavior: "none",
    metadata: {
      student_id: String(input.studentId),
    },
  });

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
  const productId = getTuitionProductId();

  const price = await stripe.prices.create({
    currency: "usd",
    unit_amount: input.monthlyCents,
    product: productId,
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

  // Check sibling count BEFORE deletion — if the item we're about
  // to remove is the only one, we'll cancel the subscription right
  // after the delete. Doing the count first avoids a race where a
  // concurrent admin adds another student between our delete and
  // our cancel-check.
  const subscriptionBefore = await stripe.subscriptions.retrieve(
    subscriptionId
  );
  const wasLastItem =
    subscriptionBefore.items.data.length === 1 &&
    subscriptionBefore.items.data[0]?.id === subscriptionItemId;

  await stripe.subscriptionItems.del(subscriptionItemId, {
    proration_behavior: "none",
  });

  if (!wasLastItem) {
    return { subscriptionCancelled: false, subscription: null };
  }

  // Last item just left — cancel the parent subscription at period
  // end so the family doesn't get billed $0 next cycle. We deliberately
  // pick `cancel_at_period_end` (not immediate cancel) so the
  // family still has access through the cycle they already paid
  // for, matching the rest of the cancel-paths in this file.
  const cancelled = await stripe.subscriptions.update(subscriptionId, {
    cancel_at_period_end: true,
  });
  return { subscriptionCancelled: true, subscription: cancelled };
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

import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { xano, STRIPE_SUB_CANCELED_PREFIX, activeStripeSubscriptionId } from "@/lib/xano";
import type { XanoPaymentTransaction } from "@/lib/xano";
import {
  getStripeClient,
  verifyWebhookSignature,
  extractInvoiceSubscriptionId,
  extractInvoiceSubscriptionMetadata,
} from "@/lib/stripe";
import { sendBillingAlert } from "@/lib/billing-alerts";
import { extractOrderCustomFields, parseStoreReference } from "@/lib/store";
import { buildFamilyByParentEmail } from "@/lib/store-server";

/**
 * Stripe webhook receiver. Stripe signs every event with a secret
 * shared via the Dashboard; we verify the signature before doing
 * anything else. A failed verification returns 400 — Stripe will
 * not retry (signature errors are caller-side problems, not transport
 * issues), but the failure shows in the Dashboard's webhook log.
 *
 * Retry contract — the load-bearing rule of this file:
 *   - TRANSIENT failure (Xano down, row not written yet, lookup
 *     errored) → THROW. The outer catch returns 500 and Stripe
 *     retries with backoff for up to ~3 days, by which time the race
 *     usually resolves (e.g. `startMonthlyBilling` finishes
 *     persisting the payment row).
 *   - PERMANENT no-op (event genuinely isn't ours: no metadata AND no
 *     matching row anywhere) → return normally so Stripe stops
 *     retrying.
 *   Swallowing a transient failure with a 200 permanently loses the
 *   event and silently desyncs the mirror.
 *
 * Idempotency: handlers upsert on natural keys
 * (`stripe_subscription_id` for the family-payment row,
 * `stripe_invoice_id` for the payment-transactions mirror), with a
 * status-rank guard so a late/retried event can never regress newer
 * state (e.g. a redelivered `invoice.finalized` arriving after
 * `invoice.paid` must not flip the row back to open).
 *
 * Field shapes: invoice→subscription linkage is read through
 * `extractInvoiceSubscriptionId` / `extractInvoiceSubscriptionMetadata`,
 * which handle both current (`invoice.parent.subscription_details`)
 * and legacy (top-level `subscription`) payload shapes — the webhook
 * endpoint's configured API version decides which one arrives.
 *
 * Events handled:
 *   - `customer.subscription.created` — persist ids to Xano (throws
 *     if the payment row isn't there yet → retry).
 *   - `customer.subscription.deleted` — write the `canceled:<id>`
 *     sentinel (NOT null — Xano PATCH ignores null/empty inputs, so a
 *     null write silently no-ops and the stale id blocks re-billing
 *     forever) + alert staff, since a Stripe-side dunning cancellation
 *     means the family silently stops being billed.
 *   - `invoice.finalized` / `invoice.paid` / `invoice.payment_failed`
 *     / `invoice.voided` / `invoice.marked_uncollectible` — mirror
 *     upsert. `payment_failed` also alerts staff.
 */

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
      case "invoice.marked_uncollectible":
        await upsertInvoiceFromEvent(event.type, event.data.object);
        break;
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        await recordStoreOrderFromSession(event.type, event.data.object);
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
  // Admin created the Subscription via the manual Start Billing
  // button. Read family + year off the metadata our create flow
  // stamped on.
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
 *
 * THROWS when the payment row can't be read or doesn't exist yet —
 * `startMonthlyBilling` may still be mid-flight persisting it (the
 * webhook can arrive within milliseconds of `subscriptions.create`),
 * and this persist is the backstop that code path explicitly relies
 * on when its own Xano write fails. A 500 → Stripe retry converges;
 * a swallowed 200 forfeits the backstop forever.
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
  const payment = await xano.familyPayments.getByFamilyAndYearStrict(
    familyId,
    yearId
  );
  if (!payment) {
    throw new Error(
      `no family_payment row yet for (family=${familyId}, year=${yearId}) — retrying persist of subscription ${subscriptionId}`
    );
  }

  const stored = payment.stripe_subscription_id ?? null;
  if (stored === subscriptionId) {
    // Already persisted — retry no-op.
  } else if (stored === `${STRIPE_SUB_CANCELED_PREFIX}${subscriptionId}`) {
    // A late-retried `subscription.created` for a subscription we've
    // ALREADY processed the cancellation of. Writing it back would
    // resurrect a dead id as live and block re-billing — skip.
    console.log(
      `[/api/webhooks/stripe] ignoring stale subscription.created for already-canceled ${subscriptionId}`
    );
  } else if (activeStripeSubscriptionId(stored)) {
    // The row holds a DIFFERENT live subscription id (a newer one —
    // e.g. billing was restarted and this event is a late redelivery
    // for the older sub). Keep the newer value; never clobber a live
    // id with an out-of-order event.
    console.warn(
      `[/api/webhooks/stripe] subscription.created for ${subscriptionId} but row already holds live ${stored} — keeping the stored id.`
    );
  } else {
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

  const payment = await xano.familyPayments.getByFamilyAndYearStrict(
    familyId,
    yearId
  );
  if (!payment) return;

  // Mark the subscription canceled with the `canceled:<id>` sentinel.
  // NOT null: Xano's edit endpoint drops null/empty inputs, so a null
  // write silently no-ops and the stale live-looking id would block
  // the family from ever being re-billed. The sentinel is a real
  // write; `activeStripeSubscriptionId` normalizes it back to null on
  // every read.
  if (payment.stripe_subscription_id === subscription.id) {
    await xano.familyPayments.update(payment.id, {
      stripe_subscription_id: `${STRIPE_SUB_CANCELED_PREFIX}${subscription.id}`,
    });
  }

  // A deleted subscription means the family stops being billed —
  // fine when admin canceled deliberately, catastrophic-but-silent
  // when Stripe's dunning gave up on a delinquent family. Either way
  // a human should see it.
  await sendBillingAlert(
    `Subscription ended for family #${familyId}`,
    [
      `Stripe subscription ${subscription.id} (family #${familyId}, year #${yearId}) was canceled/ended.`,
      `Cancellation source: ${subscription.cancellation_details?.reason ?? "unknown"}.`,
      `If this family should still be billed, use "Start Monthly Billing" on their admin billing card to create a fresh subscription.`,
    ]
  );
}

/* ─────────────────────── Invoice mirror ─────────────────────── */

/**
 * Rank invoice statuses for the monotonic-upsert guard. Higher rank =
 * further along the lifecycle. A late or redelivered event carrying a
 * LOWER-ranked status must not regress the mirrored row — the classic
 * case is a retried `invoice.finalized` (status `open`, amount_paid 0)
 * arriving after `invoice.paid` and flipping a paid invoice back to
 * open on every admin surface.
 */
const STATUS_RANK: Record<string, number> = {
  draft: 0,
  open: 1,
  uncollectible: 2,
  paid: 3,
  void: 3,
};

async function upsertInvoiceFromEvent(
  eventType: string,
  invoice: Stripe.Invoice
): Promise<void> {
  if (!invoice.id) {
    console.warn(`[/api/webhooks/stripe] ${eventType} missing invoice id`);
    return;
  }
  const subscriptionId = extractInvoiceSubscriptionId(invoice);
  if (!subscriptionId) {
    // No subscription on either payload shape — not a tuition
    // invoice (one-off, or pre-subscription). Nothing to mirror.
    console.log(
      `[/api/webhooks/stripe] ${eventType} for ${invoice.id} has no subscription — skipping mirror.`
    );
    return;
  }

  const resolved = await resolveFamilyYearForInvoice(invoice, subscriptionId);
  if (!resolved) {
    // Genuinely not ours (no metadata stamp AND no payment row
    // matches the subscription anywhere) — skip permanently.
    console.log(
      `[/api/webhooks/stripe] ${eventType}: invoice ${invoice.id} / sub ${subscriptionId} doesn't map to any family — skipping mirror.`
    );
    return;
  }
  const { familyId, yearId, paymentRowId } = resolved;

  const now = Date.now();
  const status = invoice.status ?? "open";
  const paidAt =
    eventType === "invoice.paid" || status === "paid" ? now : null;
  const finalizedAtFromEvent =
    eventType === "invoice.finalized" ? now : null;
  const periodStart = (invoice.period_start ?? 0) * 1000;
  const periodEnd = (invoice.period_end ?? 0) * 1000;
  const dueDate = invoice.due_date ? invoice.due_date * 1000 : null;

  // Strict lookup: a transient failure here must throw (→ Stripe
  // retry), because null means "never seen → CREATE" and a swallowed
  // error would duplicate the mirror row for this invoice.
  const existing = await xano.paymentTransactions.findByStripeIdStrict(
    invoice.id
  );

  // Preserve `finalized_at` on subsequent events — only the
  // `invoice.finalized` event should stamp it, but other events
  // (paid, payment_failed) may arrive without a prior finalized in
  // our log if the mirror is being backfilled or events arrived out
  // of order. Keep whatever timestamp we have.
  const finalizedAt =
    finalizedAtFromEvent ?? existing?.finalized_at ?? null;

  // Monotonic guard — never let an older/lower-ranked event regress
  // the status, paid timestamp, or paid amount of a row that's
  // already further along. Non-lifecycle fields (URLs, due date,
  // last_synced_at) still refresh.
  const incomingRank = STATUS_RANK[status] ?? 1;
  const existingRank = existing ? (STATUS_RANK[existing.status] ?? 1) : -1;
  const regressed = existing !== null && incomingRank < existingRank;

  const payload: Omit<XanoPaymentTransaction, "id" | "created_at"> = {
    registration_families_id: familyId,
    registration_school_years_id: yearId,
    registration_families_payment_id: paymentRowId,
    stripe_invoice_id: invoice.id,
    stripe_subscription_id: subscriptionId,
    period_start: periodStart,
    period_end: periodEnd,
    amount_due_cents: invoice.amount_due ?? 0,
    amount_paid_cents: regressed
      ? (existing?.amount_paid_cents ?? 0)
      : (invoice.amount_paid ?? 0),
    status: regressed ? existing!.status : status,
    hosted_invoice_url: invoice.hosted_invoice_url ?? null,
    invoice_pdf_url: invoice.invoice_pdf ?? null,
    due_date: dueDate,
    paid_at: regressed
      ? (existing?.paid_at ?? null)
      : (paidAt ?? existing?.paid_at ?? null),
    finalized_at: finalizedAt,
    last_synced_at: now,
  };

  if (existing) {
    await xano.paymentTransactions.update(existing.id, payload);
  } else {
    await xano.paymentTransactions.create(payload);
  }

  // A failed payment needs a human — Stripe keeps dunning on its
  // own, but staff should know the family's tuition didn't clear
  // rather than discovering it weeks later on the billing list.
  if (eventType === "invoice.payment_failed") {
    await sendBillingAlert(
      `Tuition payment failed for family #${familyId}`,
      [
        `Invoice ${invoice.id} (family #${familyId}, year #${yearId}) failed to collect.`,
        `Amount due: $${((invoice.amount_due ?? 0) / 100).toFixed(2)}.`,
        invoice.hosted_invoice_url
          ? `Hosted invoice: ${invoice.hosted_invoice_url}`
          : "",
        `Stripe will keep retrying per the dunning settings; check the family's billing card for status.`,
      ].filter(Boolean)
    );
  }
}

/**
 * Resolve (familyId, yearId, paymentRowId) for an invoice.
 *
 * Returns null ONLY for invoices that are genuinely not ours (no
 * metadata stamp and no payment row matching the subscription).
 * THROWS when the invoice claims to be ours (metadata present) but
 * the row lookup can't complete/find it — that's a transient race the
 * Stripe retry loop should absorb, not a permanent skip.
 */
async function resolveFamilyYearForInvoice(
  invoice: Stripe.Invoice,
  subscriptionId: string
): Promise<{
  familyId: number;
  yearId: number;
  paymentRowId: number;
} | null> {
  const meta = extractInvoiceSubscriptionMetadata(invoice);
  const familyId = meta ? Number(meta.family_id) : NaN;
  const yearId = meta ? Number(meta.year_id) : NaN;

  if (Number.isFinite(familyId) && Number.isFinite(yearId)) {
    // Metadata says this is ours — the payment row must exist. Strict
    // lookup + throw on missing so Stripe retries until
    // startMonthlyBilling's persist has landed.
    const paymentRow = await xano.familyPayments.getByFamilyAndYearStrict(
      familyId,
      yearId
    );
    if (!paymentRow) {
      throw new Error(
        `invoice ${invoice.id} carries metadata (family=${familyId}, year=${yearId}) but no family_payment row exists yet — retrying`
      );
    }
    return { familyId, yearId, paymentRowId: paymentRow.id };
  }

  // No metadata — fall back to scanning payment rows by subscription
  // id. Our own subscriptions always carry the metadata stamp (set at
  // creation), so this path only fires for foreign/legacy invoices —
  // where "no match" genuinely means "not ours" and a permanent skip
  // is correct.
  const paymentRow = await findFamilyPaymentBySubscriptionId(subscriptionId);
  if (!paymentRow) return null;
  return {
    familyId: Number(paymentRow.registration_families_id),
    yearId: Number(paymentRow.registration_school_years_id),
    paymentRowId: paymentRow.id,
  };
}

/**
 * Find the per-year family-payment row by its
 * `stripe_subscription_id`. No dedicated Xano endpoint for this —
 * we scan via the existing year-list endpoints. Inefficient but
 * only runs on the cold fallback path (metadata missing). Matches
 * the sentinel-aware live id so a canceled-then-restarted family
 * still resolves correctly.
 */
async function findFamilyPaymentBySubscriptionId(
  subscriptionId: string
): Promise<{
  id: number;
  registration_families_id: number;
  registration_school_years_id: number;
} | null> {
  const years = await xano.schoolYears.getAll();
  for (const year of years) {
    const rows = await xano.familyPayments.getAllByYear(year.id);
    const match = rows.find(
      (r) =>
        activeStripeSubscriptionId(r.stripe_subscription_id) ===
          subscriptionId ||
        r.stripe_subscription_id ===
          `${STRIPE_SUB_CANCELED_PREFIX}${subscriptionId}`
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
}

/* ─────────────────────── School-store orders ─────────────────────── */

/**
 * Mirror a Payment Link checkout into the `store_orders` table.
 * Fires on `checkout.session.completed` (card payments — already paid)
 * and `checkout.session.async_payment_succeeded` (delayed methods).
 *
 * Attribution comes from the `client_reference_id` the parent portal
 * appends to the store links (`family-<id>-year-<yid>`); sessions
 * without it (bare link shared elsewhere) are still recorded with
 * family 0 so staff see every purchase. Sessions with no
 * `payment_link` aren't ours to mirror — the tuition pipeline runs on
 * subscriptions/invoices, so payment links are the only checkout
 * sessions this account produces.
 *
 * Same retry contract as the invoice mirror: transient Xano failures
 * (including the table not existing yet) THROW so Stripe retries;
 * genuine no-ops return normally.
 */
async function recordStoreOrderFromSession(
  eventType: string,
  session: Stripe.Checkout.Session
): Promise<void> {
  const paymentLinkId = idOrString(session.payment_link);
  if (!paymentLinkId) {
    console.log(
      `[/api/webhooks/stripe] ${eventType}: session ${session.id} has no payment_link — skipping.`
    );
    return;
  }
  if (session.payment_status !== "paid") {
    // A completed session with an async payment method still pending —
    // the async_payment_succeeded event will land here again once the
    // money clears.
    console.log(
      `[/api/webhooks/stripe] ${eventType}: session ${session.id} payment_status=${session.payment_status} — waiting for payment.`
    );
    return;
  }

  // Idempotency — one row per Checkout Session; retries and the
  // completed/async-succeeded double-fire are no-ops.
  const existing = await xano.storeOrders.findBySessionIdStrict(session.id);
  if (existing) return;

  const { familyId: refFamilyId, yearId } = parseStoreReference(
    session.client_reference_id
  );

  // Attribution, two nets: the portal stamps `client_reference_id`
  // on links it opens, but a checkout launched from a shared/bare
  // link carries none — fall back to matching the purchaser's email
  // against the parent roster. Best-effort: an unmatched email still
  // records as unattributed (family 0).
  const purchaserEmail = (
    session.customer_details?.email ??
    session.customer_email ??
    ""
  ).trim();
  let familyId = refFamilyId;
  if (!familyId && purchaserEmail) {
    const familyByEmail = await buildFamilyByParentEmail();
    familyId = familyByEmail?.get(purchaserEmail.toLowerCase()) ?? 0;
  }

  // Shopper-entered size / student name from the link's custom
  // fields (configured on the Payment Link in the Stripe Dashboard).
  const customFields = extractOrderCustomFields(session.custom_fields);

  // Line items give the human-readable "what did they buy" summary.
  // Best-effort — a failed lookup falls back to a generic label
  // rather than losing the order.
  let item = "Store purchase";
  let quantity = 1;
  try {
    const stripe = getStripeClient();
    const lineItems = await stripe.checkout.sessions.listLineItems(
      session.id,
      { limit: 20 }
    );
    if (lineItems.data.length > 0) {
      item = lineItems.data
        .map((li) =>
          (li.quantity ?? 1) > 1
            ? `${li.description} ×${li.quantity}`
            : li.description
        )
        .filter(Boolean)
        .join(", ");
      quantity = lineItems.data.reduce(
        (sum, li) => sum + (li.quantity ?? 1),
        0
      );
    }
  } catch (err) {
    console.error(
      `[/api/webhooks/stripe] failed to list line items for ${session.id}:`,
      err
    );
  }

  // Resolve which catalog item this purchase was — the session only
  // carries the Payment Link id, so fetch its URL from Stripe and
  // match it against the catalog. Best-effort: 0 = unresolved (a
  // multi-product link, a deleted item, or a lookup failure); the
  // order still records with its text summary, it just stays outside
  // the per-product sold/awaiting rollups on the admin Store page.
  let storeItemId = 0;
  try {
    const stripe = getStripeClient();
    const [link, catalog] = await Promise.all([
      stripe.paymentLinks.retrieve(paymentLinkId),
      xano.storeItems.getAll(),
    ]);
    storeItemId =
      catalog.find((i) => i.payment_link_url === link.url)?.id ?? 0;
  } catch (err) {
    console.error(
      `[/api/webhooks/stripe] failed to resolve store item for ${paymentLinkId}:`,
      err
    );
  }

  await xano.storeOrders.create({
    registration_families_id: familyId,
    registration_school_years_id: yearId,
    registration_store_items_id: storeItemId,
    stripe_checkout_session_id: session.id,
    stripe_payment_link_id: paymentLinkId,
    item,
    quantity,
    total_amount_cents: session.amount_total ?? 0,
    purchaser_email: purchaserEmail,
    size: customFields.size,
    student_name: customFields.student_name,
    paid_at: (session.created ?? Math.floor(Date.now() / 1000)) * 1000,
    distributed: false,
    distributed_at: 0,
    distributed_by: " ",
  });
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

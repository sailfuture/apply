import type Stripe from "stripe";
import {
  extractInvoiceSubscriptionId,
  getNextInvoiceTiming,
  getStripeClient,
  TUITION_DAYS_UNTIL_DUE,
} from "@/lib/stripe";
import { xano, activeStripeSubscriptionId } from "@/lib/xano";
import { sendAutopayOnEmail } from "@/lib/emails/triggers";

/**
 * Tuition autopay: each monthly invoice is charged to a saved card or
 * bank account instead of being emailed for the family to pay.
 *
 * Every family subscription starts as `send_invoice` (lib/stripe.ts):
 * Stripe emails the invoice and the parent pays it on the hosted page.
 * Autopay switches the subscription to `charge_automatically`, and
 * Stripe then charges the customer's default payment method when each
 * invoice finalizes.
 *
 * ON BY DEFAULT (user decision, 2026-10-02). Any family whose Stripe
 * customer has a default payment method gets switched on unless a
 * parent or admin turned it off. That choice lives in the CUSTOMER's
 * metadata (`autopay: "off"`), not the subscription's: the customer
 * outlives each year's subscription, so the choice carries into next
 * year. The default is applied in three places:
 *   - when a parent comes back from adding a payment method
 *     (/api/billing/autopay),
 *   - in the daily reminder cron (`runAutopaySweep`), which catches
 *     cards saved any other way, such as the old "Manage billing &
 *     autopay" portal button, and
 *   - in `startMonthlyBilling`, for a returning family whose card is
 *     already on file.
 *
 * Switching on also CHARGES every open invoice on the subscription
 * (user decision, 2026-10-02: families who saved a card expected it to
 * pay what they owe). Stripe applies a new collection method only to
 * invoices created after the change, so open invoices are paid
 * explicitly and pending drafts are converted.
 *
 * The payment method stays on the customer
 * (`invoice_settings.default_payment_method`) and is never set as a
 * subscription override. The portal's add-a-payment-method flow writes
 * the customer default, so a parent replacing an expired card keeps
 * autopay working without us touching the subscription.
 */

/** Customer metadata key for the family's choice: "on", "off", or
 *  unset (never chosen, so the default applies). */
const AUTOPAY_KEY = "autopay";

export type AutopaySource = "parent" | "admin" | "default";

export interface AutopayStatus {
  /** The family has a live subscription for the year to put on
   *  autopay. False means billing isn't running. */
  available: boolean;
  /** Invoices charge automatically. */
  enabled: boolean;
  /** A parent or admin turned autopay off, so the default leaves the
   *  family alone. */
  optedOut: boolean;
  /** The saved card or bank autopay charges (or would charge), e.g.
   *  "Visa ending in 4242". Null when none is saved. */
  paymentMethodLabel: string | null;
  /** What's owed on open invoices right now. Switching on charges it. */
  openBalanceCents: number;
}

export interface AutopayCharge {
  invoiceId: string;
  amountCents: number;
  /** Unix ms, or null when the invoice has none. */
  dueDate: number | null;
  /** "processing": a bank payment that takes a few business days. */
  outcome: "paid" | "processing" | "failed";
  /** Stripe's message when the charge failed. */
  error?: string;
}

export type EnableAutopayResult =
  | {
      ok: true;
      /** False when autopay was already on, so nothing was charged. */
      changed: boolean;
      paymentMethodLabel: string;
      /** Open invoices charged by this switch. */
      charges: AutopayCharge[];
    }
  | {
      ok: false;
      reason: "no-subscription" | "no-payment-method" | "opted-out";
    };

export type DisableAutopayResult =
  | { ok: true; changed: boolean }
  | { ok: false; reason: "no-subscription" };

const CARD_BRANDS: Record<string, string> = {
  amex: "American Express",
  diners: "Diners Club",
  discover: "Discover",
  jcb: "JCB",
  mastercard: "Mastercard",
  unionpay: "UnionPay",
  visa: "Visa",
};

/** "Visa ending in 4242", "Chase account ending in 6789", "Link". */
export function describePaymentMethod(
  pm: Stripe.PaymentMethod | null | undefined
): string | null {
  if (!pm) return null;
  switch (pm.type) {
    case "card": {
      const brand = CARD_BRANDS[pm.card?.brand ?? ""] ?? "Card";
      return pm.card?.last4 ? `${brand} ending in ${pm.card.last4}` : brand;
    }
    case "us_bank_account": {
      const bank = pm.us_bank_account?.bank_name?.trim() || "Bank";
      return pm.us_bank_account?.last4
        ? `${bank} account ending in ${pm.us_bank_account.last4}`
        : `${bank} account`;
    }
    case "link":
      return "Link";
    case "cashapp":
      return "Cash App Pay";
    default:
      return pm.type.replace(/_/g, " ");
  }
}

function asPaymentMethod(
  value: string | Stripe.PaymentMethod | null | undefined
): Stripe.PaymentMethod | null {
  return value && typeof value === "object" ? value : null;
}

function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

interface AutopayContext {
  subscription: Stripe.Subscription;
  customer: Stripe.Customer;
  /** Subscription override first, then the customer default: the same
   *  order Stripe charges in. */
  paymentMethod: Stripe.PaymentMethod | null;
}

/** The family's live subscription for the year, its customer, and the
 *  payment method autopay would charge. Null when billing isn't
 *  running. */
async function loadAutopayContext(
  familyId: number,
  yearId: number
): Promise<AutopayContext | null> {
  // STRICT read: a swallowed Xano error would read as "no
  // subscription" and silently skip the family.
  const payment = await xano.familyPayments.getByFamilyAndYearStrict(
    familyId,
    yearId
  );
  const subscriptionId = activeStripeSubscriptionId(
    payment?.stripe_subscription_id
  );
  if (!subscriptionId) return null;

  const subscription = await getStripeClient().subscriptions.retrieve(
    subscriptionId,
    {
      expand: [
        "customer",
        "customer.invoice_settings.default_payment_method",
        "default_payment_method",
      ],
    }
  );
  if (["canceled", "incomplete_expired"].includes(subscription.status)) {
    return null;
  }
  const customer = subscription.customer;
  if (typeof customer !== "object" || customer.deleted) return null;

  return {
    subscription,
    customer,
    paymentMethod:
      asPaymentMethod(subscription.default_payment_method) ??
      asPaymentMethod(customer.invoice_settings?.default_payment_method),
  };
}

export async function getAutopayStatus(
  familyId: number,
  yearId: number
): Promise<AutopayStatus> {
  const ctx = await loadAutopayContext(familyId, yearId);
  if (!ctx) {
    return {
      available: false,
      enabled: false,
      optedOut: false,
      paymentMethodLabel: null,
      openBalanceCents: 0,
    };
  }
  const open = await getStripeClient().invoices.list({
    subscription: ctx.subscription.id,
    status: "open",
    limit: 24,
  });
  return {
    available: true,
    enabled: ctx.subscription.collection_method === "charge_automatically",
    optedOut: ctx.customer.metadata?.[AUTOPAY_KEY] === "off",
    paymentMethodLabel: describePaymentMethod(ctx.paymentMethod),
    openBalanceCents: open.data.reduce(
      (sum, inv) => sum + (inv.amount_remaining ?? 0),
      0
    ),
  };
}

/**
 * One operation at a time per (family, year), so a parent's click, an
 * admin's click and the cron can't interleave a switch. In-process
 * only. The Stripe idempotency keys on the catch-up charges cover the
 * cross-instance case, which is the one that could cost a family money.
 */
const queues = new Map<string, Promise<unknown>>();

function serialized<T>(key: string, run: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.then(run, run);
  const settled = next.catch(() => undefined);
  queues.set(key, settled);
  void settled.then(() => {
    if (queues.get(key) === settled) queues.delete(key);
  });
  return next;
}

/** Turn autopay on for the family's subscription for the year, charge
 *  every open invoice to the saved payment method, and email the
 *  parents. `source: "default"` respects a family's earlier "off". */
export function enableAutopay(args: {
  familyId: number;
  yearId: number;
  source: AutopaySource;
}): Promise<EnableAutopayResult> {
  return serialized(`${args.familyId}:${args.yearId}`, () =>
    enableAutopayInner(args)
  );
}

async function enableAutopayInner({
  familyId,
  yearId,
  source,
}: {
  familyId: number;
  yearId: number;
  source: AutopaySource;
}): Promise<EnableAutopayResult> {
  const ctx = await loadAutopayContext(familyId, yearId);
  if (!ctx) return { ok: false, reason: "no-subscription" };
  const { subscription, customer, paymentMethod } = ctx;
  if (!paymentMethod) return { ok: false, reason: "no-payment-method" };
  if (source === "default" && customer.metadata?.[AUTOPAY_KEY] === "off") {
    return { ok: false, reason: "opted-out" };
  }

  const stripe = getStripeClient();
  const label =
    describePaymentMethod(paymentMethod) ?? "your saved payment method";
  if (customer.metadata?.[AUTOPAY_KEY] !== "on") {
    await stripe.customers.update(customer.id, {
      metadata: {
        [AUTOPAY_KEY]: "on",
        autopay_changed_at: new Date().toISOString(),
        autopay_changed_by: source,
      },
    });
  }
  if (subscription.collection_method === "charge_automatically") {
    return { ok: true, changed: false, paymentMethodLabel: label, charges: [] };
  }

  // `days_until_due` must be left out: it's only valid on send_invoice,
  // and Stripe clears it on this switch.
  await stripe.subscriptions.update(subscription.id, {
    collection_method: "charge_automatically",
  });
  await convertDraftInvoices(subscription.id, "charge_automatically");
  const charges = await chargeOpenInvoices(subscription.id, paymentMethod.id);

  let nextChargeAt: number | null = null;
  try {
    nextChargeAt = (await getNextInvoiceTiming(subscription.id))?.sendsAtMs ?? null;
  } catch (err) {
    console.error(
      `[autopay] couldn't read the next invoice date for ${subscription.id}:`,
      err
    );
  }
  const email = await sendAutopayOnEmail({
    familyId,
    yearId,
    source,
    paymentMethodLabel: label,
    nextChargeAt,
    charges,
  });
  if (!email.ok) {
    console.error(
      `[autopay] on for family ${familyId}, but the confirmation email didn't send: ${email.error}`
    );
  }

  console.log(
    `[autopay] on for family ${familyId} year ${yearId} (${source}): ${label}; ` +
      `${charges.length} open invoice(s) charged — ${charges.map((c) => `${c.invoiceId} ${c.outcome}`).join(", ") || "none"}`
  );
  return { ok: true, changed: true, paymentMethodLabel: label, charges };
}

/** Back to emailed invoices. Remembered on the customer, so the
 *  on-by-default sweep leaves the family alone from now on. */
export function disableAutopay(args: {
  familyId: number;
  yearId: number;
  source: Exclude<AutopaySource, "default">;
}): Promise<DisableAutopayResult> {
  return serialized(`${args.familyId}:${args.yearId}`, async () => {
    const ctx = await loadAutopayContext(args.familyId, args.yearId);
    if (!ctx) return { ok: false, reason: "no-subscription" } as const;
    const stripe = getStripeClient();
    await stripe.customers.update(ctx.customer.id, {
      metadata: {
        [AUTOPAY_KEY]: "off",
        autopay_changed_at: new Date().toISOString(),
        autopay_changed_by: args.source,
      },
    });
    if (ctx.subscription.collection_method === "send_invoice") {
      return { ok: true, changed: false } as const;
    }
    // Switching back requires a due window.
    await stripe.subscriptions.update(ctx.subscription.id, {
      collection_method: "send_invoice",
      days_until_due: TUITION_DAYS_UNTIL_DUE,
    });
    await convertDraftInvoices(ctx.subscription.id, "send_invoice");
    console.log(
      `[autopay] off for family ${args.familyId} year ${args.yearId} (${args.source})`
    );
    return { ok: true, changed: true } as const;
  });
}

/** A draft keeps the collection method it was created with, so a draft
 *  Stripe made just before a switch (they sit ~24h before finalizing)
 *  would be emailed instead of charged, or the reverse. Best-effort:
 *  the sweep charges an emailed leftover on an autopay family. */
async function convertDraftInvoices(
  subscriptionId: string,
  to: "charge_automatically" | "send_invoice"
): Promise<void> {
  const stripe = getStripeClient();
  const drafts = await stripe.invoices.list({
    subscription: subscriptionId,
    status: "draft",
    limit: 10,
  });
  for (const draft of drafts.data) {
    if (!draft.id || draft.collection_method === to) continue;
    try {
      await stripe.invoices.update(
        draft.id,
        to === "send_invoice"
          ? { collection_method: "send_invoice", days_until_due: TUITION_DAYS_UNTIL_DUE }
          : { collection_method: "charge_automatically" }
      );
    } catch (err) {
      console.error(
        `[autopay] couldn't switch draft ${draft.id} to ${to}:`,
        err
      );
    }
  }
}

/** Charge every open invoice on the subscription to `paymentMethodId`,
 *  oldest first. Idempotency keys make a retried or racing call return
 *  Stripe's first answer instead of charging twice. */
async function chargeOpenInvoices(
  subscriptionId: string,
  paymentMethodId: string
): Promise<AutopayCharge[]> {
  const stripe = getStripeClient();
  const open = await stripe.invoices.list({
    subscription: subscriptionId,
    status: "open",
    limit: 24,
  });
  const charges: AutopayCharge[] = [];
  for (const invoice of [...open.data].sort((a, b) => a.created - b.created)) {
    if (!invoice.id) continue;
    charges.push(await chargeInvoice(invoice, paymentMethodId));
  }
  return charges;
}

async function chargeInvoice(
  invoice: Stripe.Invoice,
  paymentMethodId: string
): Promise<AutopayCharge> {
  const charge = {
    invoiceId: invoice.id!,
    amountCents: invoice.amount_remaining ?? invoice.amount_due ?? 0,
    dueDate: invoice.due_date ? invoice.due_date * 1000 : null,
  };
  try {
    const paid = await getStripeClient().invoices.pay(
      invoice.id!,
      { payment_method: paymentMethodId, off_session: true },
      { idempotencyKey: `autopay-pay:${invoice.id}:${paymentMethodId}` }
    );
    // A bank debit comes back still open while it settles.
    return { ...charge, outcome: paid.status === "paid" ? "paid" : "processing" };
  } catch (err) {
    console.error(`[autopay] charging ${invoice.id} failed:`, err);
    return { ...charge, outcome: "failed", error: errorMessage(err) };
  }
}

export interface AutopaySweepResult {
  /** Families the default switched on in this run. */
  switchedOn: Array<{
    familyId: number;
    paymentMethodLabel: string;
    charges: AutopayCharge[];
  }>;
  /** Invoices charged in this run (paid or processing). Today's
   *  reminders skip them; the mirror catches up from the webhook. */
  chargedInvoiceIds: Set<string>;
  errors: Array<{ familyId: number | null; error: string }>;
}

/**
 * The daily on-by-default pass (reminder cron), over the families the
 * school is billing this year:
 *   1. still on emailed invoices with a payment method saved and no
 *      "off" on file → switch on (which charges their open invoices
 *      and emails them), and
 *   2. already on autopay with an emailed invoice Stripe never tried to
 *      charge (a draft that finalized the old way) → charge it once.
 *      One Stripe already attempted is left to the past-due reminders.
 */
export async function runAutopaySweep({
  yearId,
  subscriptionByFamily,
}: {
  yearId: number;
  /** familyId → that family's live subscription id for the year. */
  subscriptionByFamily: Map<number, string>;
}): Promise<AutopaySweepResult> {
  const result: AutopaySweepResult = {
    switchedOn: [],
    chargedInvoiceIds: new Set(),
    errors: [],
  };
  if (subscriptionByFamily.size === 0) return result;
  const familyBySubscription = new Map(
    [...subscriptionByFamily].map(([familyId, subId]) => [subId, familyId])
  );
  const stripe = getStripeClient();

  const candidates: number[] = [];
  for await (const sub of stripe.subscriptions.list({
    collection_method: "send_invoice",
    limit: 100,
    expand: ["data.customer"],
  })) {
    const familyId = familyBySubscription.get(sub.id);
    if (familyId === undefined) continue;
    const customer = sub.customer;
    if (typeof customer !== "object" || customer.deleted) continue;
    if (customer.metadata?.[AUTOPAY_KEY] === "off") continue;
    if (
      !sub.default_payment_method &&
      !customer.invoice_settings?.default_payment_method
    ) {
      continue;
    }
    candidates.push(familyId);
  }
  for (const familyId of candidates) {
    try {
      const switched = await enableAutopay({ familyId, yearId, source: "default" });
      if (switched.ok && switched.changed) {
        result.switchedOn.push({
          familyId,
          paymentMethodLabel: switched.paymentMethodLabel,
          charges: switched.charges,
        });
        for (const c of switched.charges) {
          if (c.outcome !== "failed") result.chargedInvoiceIds.add(c.invoiceId);
        }
      }
    } catch (err) {
      result.errors.push({ familyId, error: errorMessage(err) });
    }
  }

  // Payment method each autopay subscription charges, by subscription.
  const autopayMethod = new Map<string, string>();
  for await (const sub of stripe.subscriptions.list({
    collection_method: "charge_automatically",
    limit: 100,
    expand: ["data.customer"],
  })) {
    if (!familyBySubscription.has(sub.id)) continue;
    const customer = typeof sub.customer === "object" && !sub.customer.deleted
      ? sub.customer
      : null;
    const pm =
      idOf(sub.default_payment_method) ??
      idOf(customer?.invoice_settings?.default_payment_method);
    if (pm) autopayMethod.set(sub.id, pm);
  }
  if (autopayMethod.size === 0) return result;
  try {
    for await (const invoice of stripe.invoices.list({
      status: "open",
      collection_method: "send_invoice",
      limit: 100,
    })) {
      const subId = extractInvoiceSubscriptionId(invoice);
      const pm = subId ? autopayMethod.get(subId) : undefined;
      if (!pm || !invoice.id || (invoice.attempt_count ?? 0) > 0) continue;
      const charge = await chargeInvoice(invoice, pm);
      if (charge.outcome !== "failed") result.chargedInvoiceIds.add(charge.invoiceId);
      console.log(
        `[autopay] charged leftover emailed invoice ${invoice.id} on autopay subscription ${subId}: ${charge.outcome}`
      );
    }
  } catch (err) {
    result.errors.push({ familyId: null, error: errorMessage(err) });
  }
  return result;
}

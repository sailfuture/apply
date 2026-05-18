import type Stripe from "stripe";
import { xano } from "@/lib/xano";
import {
  createInvoiceSubscription,
  getOrCreateCustomer,
} from "@/lib/stripe";

/**
 * Server-side billing orchestration. Called from two places:
 *
 *   1. Admin family billing route — when admin clicks "Start Monthly
 *      Billing" on the Billing card (manual override path).
 *   2. Admin registration-progress route — auto-cascade on
 *      `isRegistrationConfirmed=true`. Confirming a family's
 *      registration also kicks off billing without an extra click.
 *
 * Idempotent: returns the existing Subscription if one already lives
 * on the family-payment row. So repeated cascade firings (admin
 * unconfirms + reconfirms) don't double-bill.
 *
 * Resolves family + primary parent + the per-year payment snapshot,
 * fetches-or-creates the Stripe Customer (shared across years on the
 * family record), persists the customer id back to Xano, then creates
 * the Subscription in `send_invoice` mode. The webhook handler also
 * persists the subscription id (on `customer.subscription.created`),
 * but we do an immediate write here too so the calling UI has the
 * id available without waiting on the webhook round-trip.
 *
 * Throws `BillingPreconditionError` for fixable caller-side issues
 * (missing tuition amount, no primary parent email). The route /
 * cascade catches and surfaces these to admin.
 */

export class BillingPreconditionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BillingPreconditionError";
  }
}

export interface StartBillingResult {
  subscription: Stripe.Subscription;
  /** True if we created a new subscription on this call. False if a
   *  subscription already existed on the family-payment row and we
   *  returned it unchanged. */
  created: boolean;
}

export async function startMonthlyBilling({
  familyId,
  yearId,
}: {
  familyId: number;
  yearId: number;
}): Promise<StartBillingResult> {
  const [family, payment, year, parents, regProgress] = await Promise.all([
    xano.families.getById(familyId),
    xano.familyPayments.getByFamilyAndYear(familyId, yearId),
    xano.schoolYears.getById(yearId),
    xano.parents.getAll(),
    xano.studentRegistrationProgress.getByFamilyAndYear(familyId, yearId),
  ]);

  if (!family) {
    throw new BillingPreconditionError(`Family ${familyId} not found.`);
  }
  if (!year) {
    throw new BillingPreconditionError(`School year ${yearId} not found.`);
  }
  // Registration must be confirmed before billing starts — billing
  // commits the family to a recurring Stripe charge, and we don't
  // want that side-effect firing on a family who hasn't completed
  // the registration packet + been admin-confirmed yet. UI gates
  // the button too (BillingCard receives the same flag), but
  // enforcing it server-side closes the manual-API loophole.
  if (regProgress?.isRegistrationConfirmed !== true) {
    throw new BillingPreconditionError(
      "Family registration isn't confirmed yet — confirm registration before starting monthly billing."
    );
  }
  if (!payment) {
    throw new BillingPreconditionError(
      "No family-payment row on file. Complete the Approve flow first so the monthly tuition amount is snapshotted."
    );
  }
  const monthlyTuition = payment.monthly_tuition_payment;
  if (monthlyTuition == null || monthlyTuition <= 0) {
    throw new BillingPreconditionError(
      "Monthly tuition amount isn't set on the family-payment row yet."
    );
  }

  // Idempotency: if the row already carries a subscription id, return
  // it. This catches:
  //   - Admin clicked Start Billing twice (race condition)
  //   - Admin unconfirmed then reconfirmed registration — cascade
  //     fires again, but we don't create a parallel subscription
  if (payment.stripe_subscription_id) {
    const { getBillingSnapshot } = await import("@/lib/stripe");
    const snapshot = await getBillingSnapshot(payment.stripe_subscription_id);
    return { subscription: snapshot.subscription, created: false };
  }

  // Primary parent — lowest id wins, matching how every other admin
  // surface picks a primary for display + invoice email routing.
  const familyParentIds = xano.families.getParentIds(family);
  const familyParents = parents
    .filter((p) => familyParentIds.includes(p.id))
    .sort((a, b) => a.id - b.id);
  const primaryParent = familyParents[0] ?? null;
  if (!primaryParent?.email) {
    throw new BillingPreconditionError(
      "No primary parent email on file. Stripe needs an address to email the invoice."
    );
  }
  const primaryParentName =
    `${primaryParent.first_name ?? ""} ${primaryParent.last_name ?? ""}`.trim() ||
    family.family_name;

  // Get-or-create Customer (one per family, shared across years).
  // Persist new ids back to Xano immediately so a retry-after-failure
  // path doesn't double-create.
  const { customer, created: customerCreated } = await getOrCreateCustomer({
    customerId: family.stripe_customer_id ?? null,
    familyName: family.family_name,
    primaryParentEmail: primaryParent.email,
    primaryParentName,
    familyId,
  });
  if (customerCreated) {
    try {
      await xano.families.update(familyId, {
        stripe_customer_id: customer.id,
      });
    } catch (err) {
      // Best-effort — webhook handler also persists this on
      // subscription.created. Log + continue.
      console.error(
        `[startMonthlyBilling] failed to persist stripe_customer_id on family ${familyId}:`,
        err
      );
    }
  }

  const subscription = await createInvoiceSubscription({
    customerId: customer.id,
    monthlyTuitionCents: Math.round(monthlyTuition * 100),
    billingStartDate: year.billing_start_date ?? null,
    familyId,
    yearId,
  });

  // Persist subscription id immediately so the calling UI has it.
  // Webhook handler also persists on `customer.subscription.created`;
  // doing both keeps the row consistent regardless of which write
  // wins the race.
  try {
    await xano.familyPayments.update(payment.id, {
      stripe_subscription_id: subscription.id,
    });
  } catch (err) {
    // Subscription was created in Stripe — if the Xano write fails
    // we'd be in an inconsistent state. Log loudly so admin sees it;
    // the webhook will retry the persist on its end.
    console.error(
      `[startMonthlyBilling] failed to persist stripe_subscription_id ${subscription.id} on payment row ${payment.id}:`,
      err
    );
  }

  return { subscription, created: true };
}

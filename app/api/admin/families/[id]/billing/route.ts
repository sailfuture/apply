import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano, activeStripeSubscriptionId } from "@/lib/xano";
import {
  cancelSubscriptionAtPeriodEnd,
  getBillingSnapshot,
  refundInvoice,
  uncancelSubscription,
} from "@/lib/stripe";
import { startMonthlyBilling, BillingPreconditionError } from "@/lib/billing";
import { sendBillingAlert } from "@/lib/billing-alerts";

/**
 * Admin billing endpoint — one route, action-dispatched.
 *
 *   GET  /api/admin/families/:id/billing?yearId=Y
 *     Returns a billing snapshot when a Subscription exists, or
 *     `{ subscription: null, ... }` when billing hasn't been started
 *     yet (so the admin Billing card renders its "Start Monthly
 *     Billing" empty state instead of erroring). Reads live from
 *     Stripe each call — no Xano cache.
 *
 *   POST /api/admin/families/:id/billing?yearId=Y
 *     Body: `{ action: "start" | "cancel" | "uncancel" | "refund", ...payload }`
 *     Runs the action and returns a refreshed snapshot. Errors
 *     surface as 4xx for caller-fixable issues, 502 for Stripe
 *     transport.
 *
 * The legacy `"update-amount"` action is gone — per-student
 * `monthly_amount` is the source of truth now, and changes to it
 * land via `/api/admin/student-registration/[id]` (which calls
 * `updateStudentItemAmount` on the relevant Stripe item).
 *
 * Billing mode: subscriptions run with `collection_method: send_invoice`
 * — Stripe generates a hosted invoice each month and emails the link
 * to the family. No card on file required up front. So actions like
 * `pause`/`resume` (which control auto-charge behavior) are dropped
 * — the equivalent in invoice mode is just cancel.
 */

interface BillingActionBody {
  action: "start" | "cancel" | "uncancel" | "refund";
  /** Legacy field kept on the type to tolerate older clients sending
   *  it; the route ignores the value now. */
  monthlyTuition?: number;
  /** Required when `action === "refund"`. Invoice id to refund. */
  invoiceId?: string;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const { id } = await params;
    const familyId = Number(id);
    if (!Number.isFinite(familyId)) {
      return NextResponse.json({ error: "Invalid family id" }, { status: 400 });
    }
    const yearId = Number(req.nextUrl.searchParams.get("yearId"));
    if (!Number.isFinite(yearId) || yearId <= 0) {
      return NextResponse.json({ error: "yearId is required" }, { status: 400 });
    }
    // Fetch the family's Stripe customer id in parallel with the
    // subscription lookup. Returned on the snapshot so the admin
    // Billing card can deep-link "View in Stripe" to the customer
    // page (which lists invoices/subscriptions/payments) even when
    // no subscription has been started yet — `stripe_customer_id`
    // can exist on the family row before the first subscription is
    // created (e.g. customer was provisioned for a prior year).
    const [subscriptionId, family] = await Promise.all([
      resolveSubscriptionId(familyId, yearId),
      xano.families.getById(familyId).catch(() => null),
    ]);
    const customerId = family?.stripe_customer_id ?? null;
    if (!subscriptionId) {
      return NextResponse.json({
        subscription: null,
        invoices: [],
        lastPaidInvoice: null,
        statusLabel: "Not Started" as const,
        customerId,
      });
    }
    const snapshot = await getBillingSnapshot(subscriptionId);
    return NextResponse.json({ ...snapshot, customerId });
  } catch (err) {
    return handleAdminError(err);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const { id } = await params;
    const familyId = Number(id);
    if (!Number.isFinite(familyId)) {
      return NextResponse.json({ error: "Invalid family id" }, { status: 400 });
    }
    const yearId = Number(req.nextUrl.searchParams.get("yearId"));
    if (!Number.isFinite(yearId) || yearId <= 0) {
      return NextResponse.json({ error: "yearId is required" }, { status: 400 });
    }

    const body = (await req.json().catch(() => null)) as BillingActionBody | null;
    if (!body?.action) {
      return NextResponse.json(
        { error: "Missing `action` in body." },
        { status: 400 }
      );
    }

    // `start` doesn't need an existing subscription — it creates one.
    // Every other action does. Resolve up front + branch.
    if (body.action === "start") {
      try {
        const result = await startMonthlyBilling({ familyId, yearId });
        const snapshot = await getBillingSnapshot(result.subscription.id);
        return NextResponse.json(snapshot);
      } catch (err) {
        if (err instanceof BillingPreconditionError) {
          return NextResponse.json({ error: err.message }, { status: 409 });
        }
        throw err;
      }
    }

    const subscriptionId = await resolveSubscriptionId(familyId, yearId);
    if (!subscriptionId) {
      return NextResponse.json(
        { error: "No Stripe Subscription on file. Click Start Monthly Billing first." },
        { status: 404 }
      );
    }

    switch (body.action) {
      case "cancel":
        await cancelSubscriptionAtPeriodEnd(subscriptionId);
        break;
      case "uncancel":
        // Reverse a pending cancellation. Only valid while the
        // subscription is still alive (admin clicked Cancel and
        // hasn't waited for the period end). Once the period ends
        // and Stripe deletes the subscription, the row's
        // stripe_subscription_id gets cleared and admin uses the
        // Start Monthly Billing button instead.
        await uncancelSubscription(subscriptionId);
        break;
      case "refund": {
        if (!body.invoiceId) {
          return NextResponse.json(
            { error: "`invoiceId` is required for refunds." },
            { status: 400 }
          );
        }
        // Ownership guard rides along: refundInvoice refuses any
        // invoice that doesn't belong to THIS family's subscription,
        // so a stale/mistyped id can't refund another family's
        // payment.
        const refund = await refundInvoice(body.invoiceId, {
          expectedSubscriptionId: subscriptionId,
        });
        // Reflect the refund in the payment-transactions mirror
        // immediately so the schedule flips without waiting on the
        // `charge.refunded` webhook (which converges the row to the
        // charge's actual captured-minus-refunded truth). Stripe
        // doesn't change the invoice's `paid` status on refund, so
        // this + the webhook are the only correctors. Best-effort
        // with an alert — the refund itself already succeeded.
        // `refundInvoice` always returns the FULL remaining balance
        // of the payment, so post-refund the invoice is fully
        // refunded — status flips to our `refunded` terminal state.
        try {
          const row = await xano.paymentTransactions.findByStripeIdStrict(
            body.invoiceId
          );
          if (row) {
            await xano.paymentTransactions.update(row.id, {
              amount_paid_cents: Math.max(
                (row.amount_paid_cents ?? 0) - (refund.amount ?? 0),
                0
              ),
              status: "refunded",
              last_synced_at: Date.now(),
            });
          }
        } catch (err) {
          console.error(
            `[/api/admin/families/${familyId}/billing] refund succeeded but mirror update failed for invoice ${body.invoiceId}:`,
            err
          );
          await sendBillingAlert(
            `Refund not reflected in billing mirror (family #${familyId})`,
            [
              `Invoice ${body.invoiceId} was refunded ($${((refund.amount ?? 0) / 100).toFixed(2)}) but the local mirror update failed — the family's "paid to date" will overstate until corrected.`,
              `Adjust the transaction row's amount_paid_cents in Xano directly. (Do NOT rely on the backfill here — Stripe's invoice amount_paid doesn't subtract refunds, so a re-sync re-overstates it.)`,
              `Error: ${err instanceof Error ? err.message : String(err)}`,
            ]
          );
        }
        break;
      }
      default:
        return NextResponse.json(
          { error: `Unknown action: ${body.action}` },
          { status: 400 }
        );
    }

    // Always return a fresh snapshot so the admin card updates without
    // a follow-up GET.
    const snapshot = await getBillingSnapshot(subscriptionId);
    return NextResponse.json(snapshot);
  } catch (err) {
    return handleAdminError(err);
  }
}

/* ─────────────────────── helpers ─────────────────────── */

// NOTE: family/year validation is inlined in each handler now — the
// previous helpers threw a raw `Response`, which `handleAdminError`
// doesn't recognize, so every validation failure surfaced as a 500
// "Internal error" instead of its 400.

async function resolveSubscriptionId(
  familyId: number,
  yearId: number
): Promise<string | null> {
  const payment = await xano.familyPayments.getByFamilyAndYearOnAdminGroup(
    familyId,
    yearId
  );
  // Sentinel-aware: a `canceled:<id>` marker means no live
  // subscription — the GET renders the "Start Monthly Billing" empty
  // state and the cancel/uncancel/refund actions 404 instead of
  // operating on a dead subscription.
  return activeStripeSubscriptionId(payment?.stripe_subscription_id);
}

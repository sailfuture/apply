import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano, activeStripeSubscriptionId } from "@/lib/xano";
import {
  cancelSubscriptionAtPeriodEnd,
  getBillingSnapshot,
  uncancelSubscription,
} from "@/lib/stripe";
import { startMonthlyBilling, BillingPreconditionError } from "@/lib/billing";
import {
  disableAutopay,
  enableAutopay,
  getAutopayStatus,
  type AutopayStatus,
  type EnableAutopayResult,
} from "@/lib/autopay";

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
 *     Body: `{ action: "start" | "cancel" | "uncancel" | "autopay_on"
 *     | "autopay_off" }`
 *     Runs the action and returns a refreshed snapshot. Errors
 *     surface as 4xx for caller-fixable issues, 502 for Stripe
 *     transport. `autopay_on` charges the family's open invoices
 *     (lib/autopay.ts) and returns what it charged as `autopayResult`.
 *
 * Both return `autopay` (lib/autopay.ts `AutopayStatus`) beside the
 * snapshot.
 *
 * The in-app `"refund"` action was removed (2026-08-30) — refunds are
 * issued directly in the Stripe Dashboard, and the `charge.refunded`
 * webhook mirrors them back (status "refunded" + net collected).
 *
 * The legacy `"update-amount"` action is gone — per-student
 * `monthly_amount` is the source of truth now, and changes to it
 * land via `/api/admin/student-registration/[id]` (which calls
 * `updateStudentItemAmount` on the relevant Stripe item).
 *
 * Billing mode: subscriptions start on `collection_method: send_invoice`
 * — Stripe generates a hosted invoice each month and emails the link
 * to the family — and switch to `charge_automatically` when autopay
 * turns on. `pause`/`resume` stay dropped; the stop action is cancel.
 */

interface BillingActionBody {
  action: "start" | "cancel" | "uncancel" | "autopay_on" | "autopay_off";
  /** Legacy field kept on the type to tolerate older clients sending
   *  it; the route ignores the value now. */
  monthlyTuition?: number;
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
        statusLabel: "Not Started" as const,
        customerId,
      });
    }
    const [snapshot, autopay] = await Promise.all([
      getBillingSnapshot(subscriptionId),
      readAutopay(familyId, yearId),
    ]);
    return NextResponse.json({ ...snapshot, customerId, autopay });
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
        const [snapshot, autopay] = await Promise.all([
          getBillingSnapshot(result.subscription.id),
          readAutopay(familyId, yearId),
        ]);
        return NextResponse.json({ ...snapshot, autopay });
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

    let autopayResult: EnableAutopayResult | null = null;
    switch (body.action) {
      case "autopay_on":
        autopayResult = await enableAutopay({ familyId, yearId, source: "admin" });
        if (!autopayResult.ok) {
          return NextResponse.json(
            {
              error:
                autopayResult.reason === "no-payment-method"
                  ? "This family has no card or bank account saved. They can add one from their Tuition & Fees page, or you can add one in the customer portal."
                  : "No live subscription to put on autopay.",
            },
            { status: 409 }
          );
        }
        break;
      case "autopay_off": {
        const off = await disableAutopay({ familyId, yearId, source: "admin" });
        if (!off.ok) {
          return NextResponse.json(
            { error: "No live subscription to take off autopay." },
            { status: 409 }
          );
        }
        break;
      }
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
      default:
        return NextResponse.json(
          { error: `Unknown action: ${body.action}` },
          { status: 400 }
        );
    }

    // Always return a fresh snapshot so the admin card updates without
    // a follow-up GET.
    const [snapshot, autopay] = await Promise.all([
      getBillingSnapshot(subscriptionId),
      readAutopay(familyId, yearId),
    ]);
    return NextResponse.json({ ...snapshot, autopay, autopayResult });
  } catch (err) {
    return handleAdminError(err);
  }
}

/** Autopay status for the card, or null when Stripe can't say, so the
 *  rest of the card still renders. */
async function readAutopay(
  familyId: number,
  yearId: number
): Promise<AutopayStatus | null> {
  try {
    return await getAutopayStatus(familyId, yearId);
  } catch (err) {
    console.error(
      `[admin billing] autopay status failed for family ${familyId}:`,
      err
    );
    return null;
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

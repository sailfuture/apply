import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano, activeStripeSubscriptionId } from "@/lib/xano";
import { cancelSubscriptionAtPeriodEnd } from "@/lib/stripe";

/**
 * Close out a school year's billing: set cancel-at-period-end on
 * EVERY live tuition subscription for the year. Subscriptions are
 * open-ended monthly — Stripe doesn't know when the school year ends
 * — so without this, July's invoices would roll into an August
 * nobody's enrolled for.
 *
 * Deliberately cancel-at-period-end, not immediate cancel: each
 * family's current invoice/period plays out normally (nothing is cut
 * off mid-cycle), no further invoices are generated, and Stripe
 * deletes the subscription when the period lapses (the webhook then
 * writes the `canceled:` sentinel on the payment row). Until a
 * family's period actually ends, the per-family Uncancel button
 * reverses it — so a mistaken click is recoverable family-by-family.
 *
 * Idempotent: re-running sets the same flag again, which Stripe
 * treats as a no-op. Per-family failures don't stop the sweep; they
 * come back in `failures` so admin knows exactly who to handle by
 * hand.
 */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = await req.json().catch(() => null);
    const yearId = Number(body?.yearId);
    if (!Number.isFinite(yearId) || yearId <= 0) {
      return NextResponse.json(
        { error: "yearId is required" },
        { status: 400 }
      );
    }

    const payments = await xano.familyPayments.getAllByYear(yearId);
    const live = payments
      .map((p) => ({
        familyId: Number(p.registration_families_id) || 0,
        subscriptionId: activeStripeSubscriptionId(p.stripe_subscription_id),
      }))
      .filter(
        (p): p is { familyId: number; subscriptionId: string } =>
          p.subscriptionId !== null
      );

    let canceled = 0;
    const failures: Array<{ familyId: number; error: string }> = [];
    for (const p of live) {
      try {
        await cancelSubscriptionAtPeriodEnd(p.subscriptionId);
        canceled++;
      } catch (err) {
        console.error(
          `[/api/admin/billing/close-year] cancel failed for family ${p.familyId} (${p.subscriptionId}):`,
          err
        );
        failures.push({
          familyId: p.familyId,
          error: err instanceof Error ? err.message : "Unknown Stripe error",
        });
      }
    }

    return NextResponse.json({ total: live.length, canceled, failures });
  } catch (err) {
    return handleAdminError(err);
  }
}

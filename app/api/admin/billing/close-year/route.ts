import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano, activeStripeSubscriptionId } from "@/lib/xano";
import { cancelSubscriptionAtPeriodEnd, getCloseOutState } from "@/lib/stripe";
import { billingYearEndMs } from "@/lib/payment-plan";

/**
 * Close out a school year's billing: set cancel-at-period-end on the
 * live tuition subscriptions for the year. Subscriptions are
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
 * The guard. Canceling at period end means the invoice due at the end
 * of the CURRENT period is never created. Families aren't all
 * invoiced on the 1st: one that enrolled mid-year is invoiced on the
 * day they started (the 10th, say), and one whose first payment is a
 * later month sits with its first invoice held. Run on July 5, a
 * blanket sweep would cancel the 10th's family on July 10 — before
 * their last payment of the year — and a held one before its first.
 * So each subscription is read first, and one whose next invoice
 * still falls inside this billing year is LEFT RUNNING and reported
 * back in `waiting` with the date. Admin runs the close-out again once
 * those invoices have gone out; it only acts on what's still open.
 *
 * A subscription that is already on its way out (a pending cancel
 * from an earlier run, or a family that left) is left alone too.
 *
 * With no billing start date on the year there is no year end to
 * compare with, and every live subscription is set to cancel as
 * before.
 *
 * Idempotent: re-running skips what's already ending. Per-family
 * failures don't stop the sweep; they come back in `failures` so admin
 * knows exactly who to handle by hand. A subscription that can't be
 * READ is a failure, not a cancel — canceling blind is exactly what
 * the guard exists to prevent.
 */

/** Stripe reads + writes in flight at once. Keeps a 40-family sweep
 *  to a few seconds without leaning on Stripe's rate limit. */
const CONCURRENCY = 4;

type Outcome =
  | { kind: "canceled" }
  | { kind: "already_ending" }
  | { kind: "waiting"; nextInvoiceAt: number }
  | { kind: "failed"; error: string };

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

    const [payments, year] = await Promise.all([
      xano.familyPayments.getAllByYear(yearId),
      // The year only supplies the guard's cut-off. If it can't be
      // read, fail the request rather than sweep without the guard.
      xano.schoolYears.getById(yearId),
    ]);
    const yearEndMs = billingYearEndMs(year?.billing_start_date);

    const live = payments
      .map((p) => ({
        familyId: Number(p.registration_families_id) || 0,
        subscriptionId: activeStripeSubscriptionId(p.stripe_subscription_id),
      }))
      .filter(
        (p): p is { familyId: number; subscriptionId: string } =>
          p.subscriptionId !== null
      );

    async function closeOut(subscriptionId: string): Promise<Outcome> {
      if (yearEndMs != null) {
        const state = await getCloseOutState(subscriptionId);
        if (state.alreadyEnding) return { kind: "already_ending" };
        if (state.nextInvoiceMs != null && state.nextInvoiceMs < yearEndMs) {
          return { kind: "waiting", nextInvoiceAt: state.nextInvoiceMs };
        }
      }
      await cancelSubscriptionAtPeriodEnd(subscriptionId);
      return { kind: "canceled" };
    }

    let canceled = 0;
    let alreadyEnding = 0;
    const waiting: Array<{ familyId: number; nextInvoiceAt: number }> = [];
    const failures: Array<{ familyId: number; error: string }> = [];
    for (let i = 0; i < live.length; i += CONCURRENCY) {
      const batch = live.slice(i, i + CONCURRENCY);
      const outcomes = await Promise.all(
        batch.map(async (p): Promise<Outcome> => {
          try {
            return await closeOut(p.subscriptionId);
          } catch (err) {
            console.error(
              `[/api/admin/billing/close-year] close-out failed for family ${p.familyId} (${p.subscriptionId}):`,
              err
            );
            return {
              kind: "failed",
              error: err instanceof Error ? err.message : "Unknown Stripe error",
            };
          }
        })
      );
      outcomes.forEach((outcome, j) => {
        const { familyId } = batch[j];
        if (outcome.kind === "canceled") canceled++;
        else if (outcome.kind === "already_ending") alreadyEnding++;
        else if (outcome.kind === "waiting") {
          waiting.push({ familyId, nextInvoiceAt: outcome.nextInvoiceAt });
        } else failures.push({ familyId, error: outcome.error });
      });
    }
    waiting.sort((a, b) => a.nextInvoiceAt - b.nextInvoiceAt);

    return NextResponse.json({
      total: live.length,
      canceled,
      alreadyEnding,
      waiting,
      failures,
      yearEndsAt: yearEndMs,
    } satisfies CloseYearResponse);
  } catch (err) {
    return handleAdminError(err);
  }
}

export interface CloseYearResponse {
  /** Live subscriptions found for the year. */
  total: number;
  /** Newly set to cancel at the end of their current period. */
  canceled: number;
  /** Already had a cancellation pending — left as they were. */
  alreadyEnding: number;
  /** Left running because their next invoice still belongs to this
   *  billing year (canceling now would skip it). Soonest first. */
  waiting: Array<{ familyId: number; nextInvoiceAt: number }>;
  failures: Array<{ familyId: number; error: string }>;
  /** End of the billing year (unix ms) the guard compared against;
   *  null when the year has no billing start date and the guard
   *  didn't run. */
  yearEndsAt: number | null;
}

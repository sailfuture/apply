import { auth, currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { xano, activeStripeSubscriptionId } from "@/lib/xano";
import {
  fetchActiveFamilyApplications,
  sumFamilyBillingTotals,
} from "@/lib/per-student-billing";
import {
  parseAnchorDate,
  buildMonthSlots,
  monthKey,
  indexTransactionsByMonth,
  stripeStatusToUi,
} from "@/lib/billing-schedule";

/**
 * Parent-side billing schedule. Same shape as the admin schedule
 * endpoint (`/api/admin/families/[id]/billing/schedule`) but gated
 * to the authenticated parent's own family — no path parameter so a
 * parent can't request someone else's data.
 *
 *   GET /api/billing/schedule?yearId=Y
 *
 * Returns a 12-row schedule anchored to the school year's
 * `billing_start_date`. Each slot is either filled from a real
 * invoice in the payment-transactions mirror or marked
 * `not_started` for future months that haven't been billed yet.
 *
 * Reads exclusively from Xano — no Stripe calls per request.
 */
export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const familyId = user.publicMetadata.registration_families_id as
    | number
    | undefined;
  if (!familyId) {
    return NextResponse.json({ error: "No family on file" }, { status: 400 });
  }

  const yearIdParam = req.nextUrl.searchParams.get("yearId");
  const yearId = Number(yearIdParam);
  if (!Number.isFinite(yearId) || yearId <= 0) {
    return NextResponse.json(
      { error: "yearId is required" },
      { status: 400 }
    );
  }

  const [payment, year, transactions, activeApps] = await Promise.all([
    xano.familyPayments.getByFamilyAndYear(familyId, yearId),
    xano.schoolYears.getById(yearId),
    xano.paymentTransactions.getByFamilyAndYear(familyId, yearId),
    fetchActiveFamilyApplications(familyId, yearId),
  ]);

  // Family monthly total = Σ per-student `monthly_amount` on the
  // active application rows. Matches the admin schedule route's
  // derivation so the parent + admin surfaces show the same number.
  const totals = sumFamilyBillingTotals(activeApps);
  const monthlyAmountCents =
    totals.monthlyTotal > 0 ? Math.round(totals.monthlyTotal * 100) : null;
  const billingStartDate = year?.billing_start_date ?? null;

  const anchor = parseAnchorDate(billingStartDate);
  const slots = buildMonthSlots(anchor);

  // Shared helper maps each invoice to its billing-cycle month
  // (period_end — see lib/billing-schedule.ts for why period_start
  // put every invoice one month early).
  const txByMonthKey = indexTransactionsByMonth(transactions);

  const enrichedSlots = slots.map((slot) => {
    const k = monthKey(new Date(slot.periodStart));
    const tx = txByMonthKey.get(k) ?? null;
    if (!tx) {
      return {
        ...slot,
        status: "not_started" as const,
        invoice: null,
      };
    }
    const status = stripeStatusToUi(tx.status);
    return {
      ...slot,
      status,
      invoice: {
        stripeInvoiceId: tx.stripe_invoice_id,
        amountDueCents: tx.amount_due_cents,
        amountPaidCents: tx.amount_paid_cents,
        hostedInvoiceUrl: tx.hosted_invoice_url,
        invoicePdfUrl: tx.invoice_pdf_url,
        dueDate: tx.due_date,
        paidAt: tx.paid_at,
        finalizedAt: tx.finalized_at,
      },
    };
  });

  const yearTotalCents =
    monthlyAmountCents != null ? monthlyAmountCents * 12 : null;
  const paidCents = transactions.reduce(
    (acc, t) => acc + (t.amount_paid_cents ?? 0),
    0
  );
  const outstandingCents = transactions.reduce((acc, t) => {
    if (t.status === "open" || t.status === "uncollectible") {
      return acc + Math.max((t.amount_due_cents ?? 0) - (t.amount_paid_cents ?? 0), 0);
    }
    return acc;
  }, 0);

  /** True when the family has a LIVE Stripe subscription on file for
   *  the year — sentinel-aware, so a canceled subscription doesn't
   *  keep showing billing controls that would 404. */
  const hasBilling = !!activeStripeSubscriptionId(
    payment?.stripe_subscription_id
  );

  return NextResponse.json({
    monthlyAmountCents,
    billingStartDate,
    yearTotalCents,
    paidCents,
    outstandingCents,
    hasBilling,
    slots: enrichedSlots,
  } satisfies ParentScheduleResponse);
}

export interface ParentScheduleResponse {
  monthlyAmountCents: number | null;
  billingStartDate: string | null;
  yearTotalCents: number | null;
  paidCents: number;
  outstandingCents: number;
  hasBilling: boolean;
  slots: ParentScheduleSlot[];
}

export interface ParentScheduleSlot {
  slotIndex: number;
  periodStart: number;
  periodEndExclusive: number;
  monthLabel: string;
  status: "not_started" | "open" | "paid" | "failed" | "void";
  invoice: {
    stripeInvoiceId: string;
    amountDueCents: number;
    amountPaidCents: number;
    hostedInvoiceUrl: string | null;
    invoicePdfUrl: string | null;
    dueDate: number | null;
    paidAt: number | null;
    finalizedAt: number | null;
  } | null;
}

// Slot/mapping helpers live in lib/billing-schedule.ts, shared with
// the admin schedule route so the two surfaces can't drift.

import { auth, currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { xano } from "@/lib/xano";
import {
  fetchActiveFamilyPackets,
  sumFamilyBillingTotals,
} from "@/lib/per-student-billing";

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

  const [payment, year, transactions, activePackets] = await Promise.all([
    xano.familyPayments.getByFamilyAndYear(familyId, yearId),
    xano.schoolYears.getById(yearId),
    xano.paymentTransactions.getByFamilyAndYear(familyId, yearId),
    fetchActiveFamilyPackets(familyId, yearId),
  ]);

  // Family monthly total = Σ per-student `monthly_amount`. Matches
  // the admin schedule route's derivation so the parent + admin
  // surfaces show the same number.
  const totals = sumFamilyBillingTotals(activePackets);
  const monthlyAmountCents =
    totals.monthlyTotal > 0 ? Math.round(totals.monthlyTotal * 100) : null;
  const billingStartDate = year?.billing_start_date ?? null;

  const anchor = parseAnchorDate(billingStartDate);
  const slots = buildMonthSlots(anchor);

  const txByMonthKey = new Map<string, (typeof transactions)[number]>();
  for (const t of transactions) {
    const k = monthKey(new Date(t.period_start));
    const existing = txByMonthKey.get(k);
    if (!existing || (t.period_start ?? 0) > (existing.period_start ?? 0)) {
      txByMonthKey.set(k, t);
    }
  }

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

  /** True when the family has a Stripe subscription on file for the
   *  year — drives the "Manage billing" / "Set up autopay" button
   *  visibility. Without a subscription the portal would 404. */
  const hasBilling = !!payment?.stripe_subscription_id;

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

/* ─────────────────────── helpers ─────────────────────── */

function parseAnchorDate(billingStartDate: string | null): Date {
  if (billingStartDate) {
    const ms = Date.parse(`${billingStartDate}T00:00:00Z`);
    if (Number.isFinite(ms)) return new Date(ms);
  }
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function buildMonthSlots(anchor: Date): Array<{
  slotIndex: number;
  periodStart: number;
  periodEndExclusive: number;
  monthLabel: string;
}> {
  const out: Array<{
    slotIndex: number;
    periodStart: number;
    periodEndExclusive: number;
    monthLabel: string;
  }> = [];
  for (let i = 0; i < 12; i += 1) {
    const start = new Date(
      Date.UTC(
        anchor.getUTCFullYear(),
        anchor.getUTCMonth() + i,
        anchor.getUTCDate()
      )
    );
    const end = new Date(
      Date.UTC(
        anchor.getUTCFullYear(),
        anchor.getUTCMonth() + i + 1,
        anchor.getUTCDate()
      )
    );
    const label = start.toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
    out.push({
      slotIndex: i,
      periodStart: start.getTime(),
      periodEndExclusive: end.getTime(),
      monthLabel: label,
    });
  }
  return out;
}

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function stripeStatusToUi(
  status: string
): "open" | "paid" | "failed" | "void" {
  switch (status) {
    case "paid":
      return "paid";
    case "void":
      return "void";
    case "uncollectible":
      return "failed";
    case "open":
    case "draft":
    default:
      return "open";
  }
}

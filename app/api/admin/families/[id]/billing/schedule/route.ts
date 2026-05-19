import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import {
  fetchActiveFamilyApplications,
  sumFamilyBillingTotals,
} from "@/lib/per-student-billing";

/**
 * Per-family 12-month billing schedule for the admin billing
 * detail page.
 *
 *   GET /api/admin/families/:id/billing/schedule?yearId=Y
 *
 * Returns a 12-row schedule anchored to the school year's
 * `billing_start_date` (e.g. Aug 1 → 12 monthly slots through the
 * following July). Each slot is either filled from a real invoice
 * in the payment-transactions mirror (if Stripe has generated one
 * for that month) or marked `not_started` for future months that
 * haven't been billed yet.
 *
 * Reads exclusively from Xano — no Stripe calls per request. The
 * mirror is webhook-fed and backfilled, so it's authoritative for
 * historical state. Each row carries the Stripe invoice id +
 * hosted URL so the UI can deep-link without a follow-up call.
 *
 * Response shape:
 *   {
 *     monthlyAmountCents: number | null,
 *     billingStartDate: string | null,  // YYYY-MM-DD
 *     yearTotalCents: number | null,
 *     paidCents: number,
 *     outstandingCents: number,
 *     slots: Array<{
 *       slotIndex: 0..11,
 *       periodStart: number,          // unix ms (UTC midnight)
 *       periodEndExclusive: number,
 *       monthLabel: "Aug 2026",
 *       status: "not_started" | "open" | "paid" | "failed" | "void",
 *       invoice: { ... } | null,      // hydrated when status !== "not_started"
 *     }>
 *   }
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const { id } = await params;
    const familyId = Number(id);
    const yearIdParam = req.nextUrl.searchParams.get("yearId");
    const yearId = Number(yearIdParam);
    if (!Number.isFinite(familyId) || familyId <= 0) {
      return NextResponse.json(
        { error: "Invalid family id" },
        { status: 400 }
      );
    }
    if (!Number.isFinite(yearId) || yearId <= 0) {
      return NextResponse.json(
        { error: "yearId is required" },
        { status: 400 }
      );
    }

    const [year, transactions, activeApps] = await Promise.all([
      xano.schoolYears.getById(yearId),
      xano.paymentTransactions.getByFamilyAndYear(familyId, yearId),
      fetchActiveFamilyApplications(familyId, yearId),
    ]);

    // Family monthly total is derived from per-student
    // `monthly_amount` on each active application row — the
    // application row is the per-student source of truth for
    // billing math.
    const totals = sumFamilyBillingTotals(activeApps);
    const monthlyAmountCents =
      totals.monthlyTotal > 0 ? Math.round(totals.monthlyTotal * 100) : null;
    const billingStartDate = year?.billing_start_date ?? null;

    // Build 12 month slots anchored to billing_start_date. If admin
    // hasn't set the date yet, slots are anchored to the first day
    // of the current calendar month so the UI still has something to
    // render — the empty state for the date itself is surfaced as a
    // separate banner on the page.
    const anchor = parseAnchorDate(billingStartDate);
    const slots = buildMonthSlots(anchor);

    // Match each slot to its invoice by period_start month. Stripe
    // billing periods may not start on the 1st (depends on
    // trial_end behavior), so we match by year+month rather than
    // exact day. One invoice per slot under normal operation; if
    // Stripe ever issues two invoices in the same month (manual
    // out-of-cycle invoice), we pick the most recent one.
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

    // Aggregations across the year — used in the summary header.
    const yearTotalCents =
      monthlyAmountCents != null ? monthlyAmountCents * 12 : null;
    const paidCents = transactions.reduce(
      (acc, t) => acc + (t.amount_paid_cents ?? 0),
      0
    );
    // Outstanding = sum of amount_due on open/uncollectible invoices.
    // Future months that haven't generated an invoice yet aren't
    // counted as "outstanding" — they're not yet billed.
    const outstandingCents = transactions.reduce((acc, t) => {
      if (t.status === "open" || t.status === "uncollectible") {
        return acc + Math.max((t.amount_due_cents ?? 0) - (t.amount_paid_cents ?? 0), 0);
      }
      return acc;
    }, 0);

    return NextResponse.json({
      monthlyAmountCents,
      billingStartDate,
      yearTotalCents,
      paidCents,
      outstandingCents,
      slots: enrichedSlots,
    } satisfies ScheduleResponse);
  } catch (err) {
    return handleAdminError(err);
  }
}

export interface ScheduleResponse {
  monthlyAmountCents: number | null;
  billingStartDate: string | null;
  yearTotalCents: number | null;
  paidCents: number;
  outstandingCents: number;
  slots: ScheduleSlot[];
}

export interface ScheduleSlot {
  slotIndex: number;
  /** Unix ms for the UTC midnight start of this month slot. */
  periodStart: number;
  /** Unix ms for the start of the NEXT month — exclusive end. */
  periodEndExclusive: number;
  /** Human label ("Aug 2026") for the row. */
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
    // Treat as UTC midnight to match the convention in
    // createInvoiceSubscription. Date.parse interprets "YYYY-MM-DD"
    // as UTC midnight per the spec.
    const ms = Date.parse(`${billingStartDate}T00:00:00Z`);
    if (Number.isFinite(ms)) return new Date(ms);
  }
  // Fallback: first day of the current calendar month at UTC midnight.
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

/**
 * Map Stripe's invoice status to the friendlier UI label.
 *   - `paid` → `paid`
 *   - `open` (with a recent failed payment attempt) is still `open`
 *     in Stripe; we surface `failed` only when the invoice is in
 *     `uncollectible` (Stripe's terminal failure state). For
 *     in-flight failures, the open status with a non-zero
 *     `attempt_count` is what the per-invoice details view will
 *     surface.
 *   - `uncollectible` → `failed`
 *   - `void` → `void`
 *   - `draft` is treated as `open` — drafts shouldn't appear in our
 *     mirror under normal operation (we only mirror post-finalize),
 *     but if one slipped through we surface it as pending.
 */
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

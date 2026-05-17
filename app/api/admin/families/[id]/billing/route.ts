import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import {
  cancelSubscriptionAtPeriodEnd,
  getBillingSnapshot,
  pauseSubscription,
  refundInvoice,
  resumeSubscription,
  updateSubscriptionMonthlyAmount,
} from "@/lib/stripe";

/**
 * Admin billing endpoint — one route, action-dispatched.
 *
 *   GET  /api/admin/families/:id/billing?yearId=Y
 *     Returns a billing snapshot: subscription + last 12 invoices
 *     + a derived `statusLabel` pill. Reads live from Stripe each
 *     call — no Xano cache, no stale state. Used by the Billing
 *     card on the family registration detail page.
 *
 *   POST /api/admin/families/:id/billing?yearId=Y
 *     Body: `{ action: "pause" | "resume" | "cancel" | "update-amount" | "refund", ...payload }`
 *     Runs the action against the family's Subscription (resolved
 *     via the per-(family, year) `family_payment.stripe_subscription_id`)
 *     and returns a refreshed snapshot. Errors surface as 4xx for
 *     missing inputs, 502 for Stripe transport.
 *
 * The `id` URL param is the Xano `registration_families.id`. We use
 * it + `yearId` to find the right `family_payment` row, and pull
 * `stripe_subscription_id` from there. Returning a snapshot after
 * every action keeps the admin card consistent without a separate
 * follow-up GET.
 */

interface BillingActionBody {
  action:
    | "pause"
    | "resume"
    | "cancel"
    | "update-amount"
    | "refund";
  /** Required when `action === "update-amount"`. New monthly amount
   *  in DOLLARS (matching `monthly_tuition_payment` storage). We
   *  convert to cents before calling Stripe. */
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
    const familyId = await resolveFamilyId(params);
    const yearId = resolveYearId(req);
    const subscriptionId = await resolveSubscriptionId(familyId, yearId);
    if (!subscriptionId) {
      return NextResponse.json(
        {
          error:
            "No Stripe Subscription on file for this family + year. " +
            "Has the parent completed payment setup?",
        },
        { status: 404 }
      );
    }
    const snapshot = await getBillingSnapshot(subscriptionId);
    return NextResponse.json(snapshot);
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
    const familyId = await resolveFamilyId(params);
    const yearId = resolveYearId(req);
    const subscriptionId = await resolveSubscriptionId(familyId, yearId);
    if (!subscriptionId) {
      return NextResponse.json(
        { error: "No Stripe Subscription on file." },
        { status: 404 }
      );
    }

    const body = (await req.json().catch(() => null)) as BillingActionBody | null;
    if (!body?.action) {
      return NextResponse.json(
        { error: "Missing `action` in body." },
        { status: 400 }
      );
    }

    switch (body.action) {
      case "pause":
        await pauseSubscription(subscriptionId);
        break;
      case "resume":
        await resumeSubscription(subscriptionId);
        break;
      case "cancel":
        await cancelSubscriptionAtPeriodEnd(subscriptionId);
        break;
      case "update-amount": {
        const dollars = Number(body.monthlyTuition);
        if (!Number.isFinite(dollars) || dollars <= 0) {
          return NextResponse.json(
            { error: "`monthlyTuition` must be a positive number." },
            { status: 400 }
          );
        }
        await updateSubscriptionMonthlyAmount({
          subscriptionId,
          newMonthlyCents: Math.round(dollars * 100),
        });
        // Mirror the new amount on the per-year family_payment row
        // so admin tuition cards + receipts stay in sync with
        // Stripe. Failures here don't block the Stripe update —
        // admin can sync manually if needed.
        try {
          const payment = await xano.familyPayments.getByFamilyAndYear(
            familyId,
            yearId
          );
          if (payment) {
            await xano.familyPayments.update(payment.id, {
              monthly_tuition_payment: dollars,
            });
          }
        } catch (err) {
          console.error(
            `[/api/admin/families/${familyId}/billing] update-amount Xano mirror failed:`,
            err
          );
        }
        break;
      }
      case "refund": {
        if (!body.invoiceId) {
          return NextResponse.json(
            { error: "`invoiceId` is required for refunds." },
            { status: 400 }
          );
        }
        await refundInvoice(body.invoiceId);
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

async function resolveFamilyId(
  params: Promise<{ id: string }>
): Promise<number> {
  const { id } = await params;
  const familyId = Number(id);
  if (!Number.isFinite(familyId)) {
    throw new Response(JSON.stringify({ error: "Invalid family id" }), {
      status: 400,
    });
  }
  return familyId;
}

function resolveYearId(req: NextRequest): number {
  const yearIdParam = req.nextUrl.searchParams.get("yearId");
  const yearId = Number(yearIdParam);
  if (!Number.isFinite(yearId) || yearId <= 0) {
    throw new Response(
      JSON.stringify({ error: "yearId is required" }),
      { status: 400 }
    );
  }
  return yearId;
}

async function resolveSubscriptionId(
  familyId: number,
  yearId: number
): Promise<string | null> {
  const payment = await xano.familyPayments.getByFamilyAndYearOnAdminGroup(
    familyId,
    yearId
  );
  return payment?.stripe_subscription_id ?? null;
}

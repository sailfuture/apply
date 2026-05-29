"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { toast } from "sonner";
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  CreditCard,
  ExternalLink,
  Loader2,
  Play,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { adminFetcher } from "@/lib/admin-fetcher";
import {
  STRIPE_INVOICES_DASHBOARD_URL,
  stripeCustomerDashboardUrl,
} from "@/lib/stripe-dashboard";
import { cn } from "@/lib/utils";

/**
 * Admin Billing card for the family registration detail page. Reads
 * live from Stripe via `/api/admin/families/:id/billing?yearId=Y` —
 * no Xano mirror, every page load hits the Stripe API. Acceptable for
 * a low-volume admin surface; trades a few hundred ms of latency for
 * always-fresh state.
 *
 * Billing model: subscriptions run with `collection_method: send_invoice`
 * — Stripe generates a hosted invoice each month and emails the link
 * to the family. No card-on-file required, no parent setup step.
 * Billing is triggered server-side when admin clicks Confirm Family
 * Registration (cascade in the registration-progress route), or
 * manually from the "Start Monthly Billing" button on this card if
 * the cascade hit a precondition error (missing tuition amount,
 * etc.).
 *
 * Surfaced data:
 *   - Status pill (Not Started / Active / Scheduled / Past Due /
 *     Paused / Canceled). "Scheduled" is our rename of Stripe's
 *     `trialing` status — in our flow that just means "first
 *     invoice deferred until billing_start_date," not a free trial.
 *   - Monthly amount + next invoice date
 *   - "View in Stripe Dashboard" deep link to the Customer view
 *   - Last 12 invoices in a small table (date, amount, status,
 *     hosted invoice URL)
 *
 * Actions (POST to the same endpoint with `{ action }` body):
 *   - Start Monthly Billing (only shown when no subscription yet)
 *   - Cancel at period end (preserves access through the
 *     paid-for period; confirmation dialog)
 *   - Refund Last Invoice (confirmation dialog, full refund of the
 *     most recent paid invoice; partial refunds via the Stripe
 *     Dashboard if needed)
 *
 * Monthly amount edits no longer live here — per-student
 * `monthly_amount` is the source of truth, edited on the
 * Scholarship Determination card; the per-student PATCH route
 * automatically re-prices the matching Stripe SubscriptionItem via
 * `updateStudentItemAmount`.
 */

interface BillingSnapshot {
  subscription: {
    id: string;
    status: string;
    customer: string | { id: string };
    pause_collection: unknown | null;
    cancel_at_period_end: boolean;
    current_period_end: number;
    items: {
      data: Array<{
        id: string;
        quantity?: number;
        price: {
          unit_amount: number | null;
          currency: string;
          recurring?: { interval: string };
        };
      }>;
    };
  } | null;
  invoices: Array<{
    id: string;
    created: number;
    amount_paid: number;
    amount_due: number;
    currency: string;
    status: string;
    hosted_invoice_url: string | null;
    invoice_pdf: string | null;
  }>;
  lastPaidInvoice: { id: string } | null;
  statusLabel:
    | "Not Started"
    | "Active"
    | "Scheduled"
    | "Past Due"
    | "Paused"
    | "Canceled"
    | "Incomplete"
    | "Unknown";
  /** Family's Stripe customer id, surfaced even when no subscription
   *  has been started yet so "View invoices in Stripe" can deep-link
   *  to the family's customer page (which lists invoices/subs/
   *  payments) instead of the global invoices view. Null when the
   *  family has never had a Stripe customer provisioned. */
  customerId?: string | null;
}

interface Props {
  familyId: number;
  yearId: number;
  /** Current monthly tuition from Xano — pre-fills the Update Amount
   *  dialog so admin sees the existing value before changing. Also
   *  surfaced inside the Start Monthly Billing button so admin sees
   *  what they're about to commit to without leaving the card. */
  currentMonthlyTuition: number | null;
  /** Year's `billing_start_date` (YYYY-MM-DD) — shown in the empty
   *  state so admin knows when the first invoice will fire if they
   *  click Start Monthly Billing. */
  billingStartDate: string | null;
  /** Whether the family's registration has been admin-confirmed for
   *  this year (`isRegistrationConfirmed` on the registration-progress
   *  row). Billing is gated on this — Start Monthly Billing stays
   *  disabled with an inline explanation until confirmation lands.
   *  The server-side `startMonthlyBilling` helper enforces the same
   *  gate so a direct API call can't bypass the UI. */
  registrationConfirmed: boolean;
}

type BillingAction = "start" | "cancel" | "uncancel" | "refund";

export function BillingCard({
  familyId,
  yearId,
  currentMonthlyTuition,
  billingStartDate,
  registrationConfirmed,
}: Props) {
  const endpoint = `/api/admin/families/${familyId}/billing?yearId=${yearId}`;
  const { data, error, isLoading, mutate } = useSWR<BillingSnapshot>(
    endpoint,
    adminFetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 10000,
      // Don't retry on error — when STRIPE_SECRET_KEY is missing or
      // Stripe returns 500, SWR's default 5-attempt exponential
      // backoff hammers the failing endpoint and pollutes dev logs.
      // One attempt is enough; admin can hit Refresh manually if
      // the failure was transient.
      shouldRetryOnError: false,
    }
  );

  const [pending, setPending] = useState<BillingAction | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmRefund, setConfirmRefund] = useState(false);

  // Per-family payment schedule deep link — shown alongside the
  // Stripe-side action buttons so admin can pivot to the historical
  // payment schedule view without losing context on the registration
  // detail page.
  const paymentScheduleHref = `/admin/families/${familyId}/billing?yearId=${yearId}`;

  async function runAction(
    action: BillingAction,
    payload?: Record<string, unknown>
  ): Promise<void> {
    setPending(action);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...(payload ?? {}) }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(body?.error ?? `Action failed (${res.status})`);
      }
      await mutate(body, { revalidate: false });
      toast.success(actionSuccessMessage(action));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed");
    } finally {
      setPending(null);
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center rounded-md border bg-muted/10 p-12">
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden="true" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-md border bg-red-50 border-red-200 p-4">
        <div className="flex items-start gap-2 text-sm text-red-800">
          <AlertCircle className="size-4 mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-medium">Couldn&rsquo;t load billing details.</p>
            <p className="text-xs text-red-700 mt-0.5">
              {error instanceof Error ? error.message : "Stripe transport error"}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2 bg-white"
              onClick={() => mutate()}
            >
              <RefreshCw className="size-3 mr-1.5" aria-hidden="true" />
              Retry
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // No subscription yet — render the Start Monthly Billing empty
  // state. Happens when admin hasn't manually clicked Start yet.
  // Auto-cascade was removed — billing is admin-triggered only now.
  if (!data.subscription) {
    const hasAmount =
      currentMonthlyTuition != null && currentMonthlyTuition > 0;
    const monthlyLabel = hasAmount
      ? `$${currentMonthlyTuition!.toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}/mo`
      : null;
    const billingStartLabel = billingStartDate
      ? formatStartDate(billingStartDate)
      : null;
    // Start button is gated on TWO preconditions and we surface
    // whichever is blocking first below the action row:
    //   1. Registration must be admin-confirmed for the year
    //      (avoids committing a family to recurring Stripe charges
    //      before the packet is fully reviewed). Tuition gate
    //      sits below because the natural admin flow confirms the
    //      packet first, then snapshots the amount via Approve.
    //   2. Monthly tuition amount must be set on the family-payment
    //      row (Stripe needs a price to subscribe to).
    // Both are also enforced server-side in `startMonthlyBilling`
    // so a direct API call can't bypass the UI gate.
    const blockReason: string | null = !registrationConfirmed
      ? "Confirm this family's registration above before starting billing."
      : !hasAmount
        ? "Monthly tuition amount isn't set on the family payment row yet — admin must complete the Approve flow first."
        : null;
    const startDisabled = pending !== null || blockReason !== null;
    return (
      <div className="rounded-md border bg-muted/10 p-6 space-y-4">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted/50">
            <CreditCard className="size-5 text-muted-foreground" aria-hidden="true" />
          </div>
          <div className="space-y-2 min-w-0 flex-1">
            <p className="text-sm font-medium">Monthly billing not started</p>
            <p className="text-xs text-muted-foreground">
              Confirm this family&rsquo;s registration in the
              Confirmation card below, then click Start Monthly
              Billing to create the subscription in Stripe.
            </p>
            {billingStartLabel ? (
              <p className="text-xs text-muted-foreground">
                Invoicing starts:{" "}
                <span className="font-medium text-foreground">
                  {billingStartLabel}
                </span>
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Invoicing start date isn&rsquo;t set on the school
                year yet — add it before billing can begin.
              </p>
            )}
          </div>
        </div>
        {/* Action row — Start Monthly Billing (primary, shows amount
            when set), View invoices in Stripe, View payment
            schedule. Three actions live on one line so admin can
            scan their options at a glance instead of hunting between
            a header-tucked link and a body button. The Start button
            stays disabled until BOTH preconditions are met; the
            message below the row explains which one is blocking. */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            disabled={startDisabled}
            onClick={() => runAction("start")}
            title={blockReason ?? undefined}
          >
            {pending === "start" ? (
              <Loader2 className="size-3.5 mr-1.5 animate-spin" aria-hidden="true" />
            ) : (
              <Play className="size-3.5 mr-1.5" aria-hidden="true" />
            )}
            Start Monthly Billing
            {monthlyLabel ? (
              <span className="ml-1.5 opacity-90">— {monthlyLabel}</span>
            ) : null}
          </Button>
          <Button asChild variant="outline" className="bg-white">
            {/* Prefer the family's customer page (lists their invoices,
                subscriptions, and payment history) when we have a
                `stripe_customer_id` on file. Falls back to the global
                invoices view only when no customer has been provisioned
                — at which point there's nothing customer-scoped to
                link to. */}
            <a
              href={
                data?.customerId
                  ? stripeCustomerDashboardUrl(data.customerId)
                  : STRIPE_INVOICES_DASHBOARD_URL
              }
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink className="size-3.5 mr-1.5" aria-hidden="true" />
              View invoices in Stripe
            </a>
          </Button>
          <Button asChild variant="outline" className="bg-white">
            <Link href={paymentScheduleHref}>
              <Calendar className="size-3.5 mr-1.5" aria-hidden="true" />
              View payment schedule
            </Link>
          </Button>
        </div>
        {blockReason ? (
          <p className="text-xs text-muted-foreground">{blockReason}</p>
        ) : null}
      </div>
    );
  }

  const sub = data.subscription;
  // The family's monthly total is the sum of every per-student
  // SubscriptionItem, not just the first. Reading only items.data[0]
  // showed a single student's amount on multi-student families.
  const monthlyCents = (sub.items?.data ?? []).reduce(
    (total, it) => total + (it.price?.unit_amount ?? 0) * (it.quantity ?? 1),
    0
  );
  const monthlyDollars = monthlyCents / 100;
  const isCanceled = sub.status === "canceled";
  const cancelingAtPeriodEnd = sub.cancel_at_period_end;
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const stripeDashboardUrl = stripeCustomerDashboardUrl(customerId);
  const nextInvoiceDate = sub.current_period_end
    ? new Date(sub.current_period_end * 1000).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : "—";

  return (
    <div className="rounded-md border bg-muted/10 p-4 space-y-5">
      {/* Header — status pill + amount + next invoice */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
            Subscription
          </p>
          <StatusPill label={data.statusLabel} />
          {cancelingAtPeriodEnd && !isCanceled ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 text-amber-800 ring-1 ring-amber-200 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide">
              Cancels {nextInvoiceDate}
            </span>
          ) : null}
        </div>
        <p className="text-lg font-semibold">
          ${monthlyDollars.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / month
        </p>
        <p className="text-xs text-muted-foreground">
          {sub.status === "trialing"
            ? `First invoice ${nextInvoiceDate}`
            : isCanceled
              ? "Subscription canceled"
              : `Next invoice ${nextInvoiceDate}`}
        </p>
      </div>

      {/* Actions — every button on one row, inline with Cancel at period
          end. The View links always render (still useful after the
          subscription is canceled); the refund / undo / cancel actions
          only apply while it's live, so they stay gated on !isCanceled.
          (The legacy "Update amount" button is gone — per-student
          `monthly_amount` is edited on the Scholarship Determination
          card; see the file docblock.) */}
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="outline" size="sm" className="bg-white">
          <Link href={paymentScheduleHref}>
            <Calendar className="size-3.5 mr-1.5" aria-hidden="true" />
            View payment schedule
          </Link>
        </Button>
        <Button asChild variant="outline" size="sm" className="bg-white">
          <a href={stripeDashboardUrl} target="_blank" rel="noreferrer">
            <ExternalLink className="size-3.5 mr-1.5" aria-hidden="true" />
            View in Stripe
          </a>
        </Button>
        {!isCanceled ? (
          <>
            {data.lastPaidInvoice ? (
              <Button
                variant="outline"
                size="sm"
                className="bg-white"
                disabled={pending !== null}
                onClick={() => setConfirmRefund(true)}
              >
                <RefreshCw className="size-3.5 mr-1.5" aria-hidden="true" />
                Refund last payment
              </Button>
            ) : null}
            {cancelingAtPeriodEnd ? (
              // Undo the pending cancellation. Only valid while the
              // subscription is still alive (we're inside the grace
              // window before period_end). Once Stripe deletes the
              // subscription, the row's stripe_subscription_id clears
              // and the empty state takes over.
              <Button
                variant="outline"
                size="sm"
                className="bg-white"
                disabled={pending !== null}
                onClick={() => runAction("uncancel")}
              >
                {pending === "uncancel" ? (
                  <Loader2 className="size-3.5 mr-1.5 animate-spin" aria-hidden="true" />
                ) : (
                  <RefreshCw className="size-3.5 mr-1.5" aria-hidden="true" />
                )}
                Undo cancellation
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="bg-white text-red-700 hover:text-red-800 hover:bg-red-50"
                disabled={pending !== null}
                onClick={() => setConfirmCancel(true)}
              >
                <XCircle className="size-3.5 mr-1.5" aria-hidden="true" />
                Cancel at period end
              </Button>
            )}
          </>
        ) : null}
      </div>

      {/* Invoice history table removed — admins use the per-family
          payment schedule page (`/admin/families/[id]/billing`) for
          the full invoice list. Keeps the billing card focused on
          subscription state + actions instead of duplicating the
          history table that has its own deep-link button above. */}

      {/* Cancel-at-period-end confirmation */}
      <AlertDialog open={confirmCancel} onOpenChange={(o) => !pending && setConfirmCancel(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel subscription at period end?</AlertDialogTitle>
            <AlertDialogDescription>
              The family keeps access through {nextInvoiceDate}. After that
              date, no further invoices generate and the subscription ends.
              You can re-enroll the family later if needed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending !== null}>Keep active</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending !== null}
              className="bg-red-600 hover:bg-red-700"
              onClick={(e) => {
                e.preventDefault();
                void runAction("cancel").then(() => setConfirmCancel(false));
              }}
            >
              {pending === "cancel" ? "Canceling…" : "Cancel at period end"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Refund confirmation */}
      <AlertDialog open={confirmRefund} onOpenChange={(o) => !pending && setConfirmRefund(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Refund last payment?</AlertDialogTitle>
            <AlertDialogDescription>
              Issues a full refund for the most recent paid invoice. The family
              sees the refund on their original payment method in 5-10
              business days. Partial refunds can be issued via the Stripe
              Dashboard.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending !== null}>Keep payment</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending !== null || !data.lastPaidInvoice}
              className="bg-red-600 hover:bg-red-700"
              onClick={(e) => {
                e.preventDefault();
                if (!data.lastPaidInvoice) return;
                void runAction("refund", {
                  invoiceId: data.lastPaidInvoice.id,
                }).then(() => setConfirmRefund(false));
              }}
            >
              {pending === "refund" ? "Refunding…" : "Issue refund"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}

function StatusPill({ label }: { label: BillingSnapshot["statusLabel"] }) {
  const tone = useMemo(() => {
    switch (label) {
      case "Active":
      case "Scheduled":
        return "bg-emerald-50 text-emerald-700 ring-emerald-200";
      case "Past Due":
        return "bg-red-50 text-red-700 ring-red-200";
      case "Paused":
        return "bg-amber-50 text-amber-700 ring-amber-200";
      case "Not Started":
      case "Canceled":
      case "Incomplete":
        return "bg-muted text-muted-foreground ring-border";
      default:
        return "bg-muted text-muted-foreground ring-border";
    }
  }, [label]);
  const Icon =
    label === "Active" || label === "Scheduled"
      ? CheckCircle2
      : label === "Past Due"
        ? AlertCircle
        : XCircle;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ring-1",
        tone
      )}
    >
      <Icon className="size-3" aria-hidden="true" />
      {label}
    </span>
  );
}

/** Format an ISO date (YYYY-MM-DD) as a long date for the empty
 *  state. Treats the input as UTC midnight to match the
 *  createInvoiceSubscription / Stripe trial_end convention so we
 *  don't drift by a day in the admin's local timezone. */
function formatStartDate(iso: string): string {
  const ms = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(ms)) return iso;
  return new Date(ms).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function actionSuccessMessage(action: BillingAction): string {
  switch (action) {
    case "start":
      return "Monthly billing started. Stripe will email the first invoice on the billing start date.";
    case "cancel":
      return "Subscription will cancel at the end of the current billing period.";
    case "uncancel":
      return "Cancellation reversed. Monthly billing continues as scheduled.";
    case "refund":
      return "Refund issued. The family will see it on their original payment method in 5-10 business days.";
  }
}

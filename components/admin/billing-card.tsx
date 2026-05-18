"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import {
  AlertCircle,
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
 *   - Update Monthly Amount (dialog with input — also mirrors back
 *     to `family_payment.monthly_tuition_payment` for receipt parity)
 *   - Refund Last Invoice (confirmation dialog, full refund of the
 *     most recent paid invoice; partial refunds via the Stripe
 *     Dashboard if needed)
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
   *  start billing now (or when the cascade fires after Confirm
   *  Registration). */
  billingStartDate: string | null;
  /** Called after admin sets the monthly tuition amount inline from
   *  the empty state. The parent page revalidates its family-payment
   *  SWR cache so `currentMonthlyTuition` flips from `null` to the
   *  new value and re-enables Start Monthly Billing. */
  onTuitionAmountSet?: () => void | Promise<unknown>;
}

type BillingAction =
  | "start"
  | "cancel"
  | "uncancel"
  | "update-amount"
  | "refund";

export function BillingCard({
  familyId,
  yearId,
  currentMonthlyTuition,
  billingStartDate,
  onTuitionAmountSet,
}: Props) {
  const endpoint = `/api/admin/families/${familyId}/billing?yearId=${yearId}`;
  const { data, error, isLoading, mutate } = useSWR<BillingSnapshot>(
    endpoint,
    adminFetcher,
    { revalidateOnFocus: false, dedupingInterval: 10000 }
  );

  const [pending, setPending] = useState<BillingAction | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmRefund, setConfirmRefund] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [updateAmount, setUpdateAmount] = useState(
    currentMonthlyTuition != null ? String(currentMonthlyTuition) : ""
  );

  // Inline "Set tuition amount" form for the empty state — the
  // billing cascade fails the precondition when monthly_tuition_payment
  // isn't set on the family-payment row, so we give admin a way to
  // fix that right here instead of bouncing them to the apply-flow
  // page. Local state because the snapshot-amount POST is a one-shot
  // — once it lands, the parent re-fetches and the empty state flips.
  const [tuitionInput, setTuitionInput] = useState("");
  const [savingTuition, setSavingTuition] = useState(false);

  async function saveTuitionAmount() {
    const dollars = Number(tuitionInput);
    if (!Number.isFinite(dollars) || dollars <= 0) {
      toast.error("Enter a positive amount.");
      return;
    }
    setSavingTuition(true);
    try {
      const res = await fetch(`/api/admin/family-payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          familyId,
          yearId,
          monthly_tuition_payment: dollars,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(body?.error ?? `Save failed (${res.status})`);
      }
      toast.success("Monthly tuition amount saved.");
      // Tell the parent to refresh its family-payment SWR cache so
      // `currentMonthlyTuition` flips from null to the new value and
      // re-enables the Start Monthly Billing button.
      await onTuitionAmountSet?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSavingTuition(false);
    }
  }

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
  // state. Happens when:
  //   - Admin hasn't confirmed registration yet (cascade hasn't
  //     fired), or
  //   - The cascade fired but hit a precondition error (missing
  //     tuition amount, missing parent email). Admin can fix the
  //     precondition + click Start here to retry.
  if (!data.subscription) {
    const monthlyLabel =
      currentMonthlyTuition != null && currentMonthlyTuition > 0
        ? `$${currentMonthlyTuition.toLocaleString("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}/mo`
        : null;
    const billingStartLabel = billingStartDate
      ? formatStartDate(billingStartDate)
      : null;
    const startDisabled =
      pending !== null ||
      currentMonthlyTuition == null ||
      currentMonthlyTuition <= 0;
    return (
      <div className="rounded-md border bg-muted/10 p-6 space-y-4">
        {/* Full-width text block — no max-w-lg cap. Header + body
            stack vertically so the copy can use the full card width
            without competing with the icon column for space. */}
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted/50">
            <CreditCard className="size-5 text-muted-foreground" aria-hidden="true" />
          </div>
          <div className="space-y-2 min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <p className="text-sm font-medium">Monthly billing not started</p>
              {/* Always-available link out to Stripe — useful even
                  before a customer exists (admin can spot-check
                  whether another invoice already exists for this
                  family in Stripe before starting a new
                  subscription). The customer-scoped link below
                  becomes available once `data.subscription` is set. */}
              <Button asChild variant="outline" size="sm" className="bg-white">
                <a
                  href={STRIPE_INVOICES_DASHBOARD_URL}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink className="size-3.5 mr-1.5" aria-hidden="true" />
                  View invoices in Stripe
                </a>
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Confirm this family&rsquo;s registration in the
              Confirmation card below — that automatically starts
              monthly invoicing. Or click the button below to start
              it manually.
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
        {/* Precondition: monthly tuition amount must exist on the
            family-payment row before Stripe will accept a price for
            the subscription. Normally set by the apply-flow Approve
            button; surface an inline form here so admin can fix the
            precondition without leaving the page when the snapshot
            never landed (or got cleared). */}
        {currentMonthlyTuition == null || currentMonthlyTuition <= 0 ? (
          <div className="rounded-md border bg-white p-3 space-y-2">
            <p className="text-xs font-medium">
              Set monthly tuition amount
            </p>
            <p className="text-xs text-muted-foreground">
              No amount on the family-payment row yet. Set it here, or
              complete the Approve flow on the family detail page to
              snapshot it from the scholarship totals.
            </p>
            <div className="flex items-stretch gap-2">
              <div className="relative flex-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  $
                </span>
                <Input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  value={tuitionInput}
                  onChange={(e) => setTuitionInput(e.target.value)}
                  placeholder="0.00"
                  className="pl-7"
                />
              </div>
              <Button
                size="sm"
                disabled={savingTuition || !tuitionInput.trim()}
                onClick={() => void saveTuitionAmount()}
              >
                {savingTuition ? (
                  <Loader2 className="size-3.5 mr-1.5 animate-spin" aria-hidden="true" />
                ) : null}
                Save
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <Button
              size="sm"
              disabled={startDisabled}
              onClick={() => runAction("start")}
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
          </div>
        )}
      </div>
    );
  }

  const sub = data.subscription;
  const item = sub.items?.data?.[0] ?? null;
  const monthlyCents = item?.price?.unit_amount ?? 0;
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
      <div className="flex items-start justify-between gap-4 flex-wrap">
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
        <Button asChild variant="outline" size="sm" className="bg-white">
          <a href={stripeDashboardUrl} target="_blank" rel="noreferrer">
            <ExternalLink className="size-3.5 mr-1.5" aria-hidden="true" />
            View in Stripe
          </a>
        </Button>
      </div>

      {/* Actions — laid out in a flex row, hidden when canceled */}
      {!isCanceled ? (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            className="bg-white"
            disabled={pending !== null}
            onClick={() => setUpdateOpen(true)}
          >
            <RefreshCw className="size-3.5 mr-1.5" aria-hidden="true" />
            Update amount
          </Button>
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
        </div>
      ) : null}

      {/* Invoice history table */}
      <div>
        <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-2">
          Recent invoices
        </p>
        {data.invoices.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No invoices yet — the first invoice goes out on {nextInvoiceDate}.
          </p>
        ) : (
          <div className="rounded-md border bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 border-b">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Date</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Amount</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Status</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.invoices.map((inv) => (
                  <tr key={inv.id}>
                    <td className="px-3 py-2">
                      {new Date(inv.created * 1000).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      $
                      {((inv.amount_paid || inv.amount_due) / 100).toLocaleString(
                        "en-US",
                        { minimumFractionDigits: 2, maximumFractionDigits: 2 }
                      )}
                    </td>
                    <td className="px-3 py-2 capitalize">{inv.status}</td>
                    <td className="px-3 py-2 text-right">
                      {inv.hosted_invoice_url ? (
                        <a
                          href={inv.hosted_invoice_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-primary hover:underline"
                        >
                          View
                        </a>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

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

      {/* Update-amount dialog */}
      <Dialog open={updateOpen} onOpenChange={(o) => !pending && setUpdateOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update monthly amount</DialogTitle>
            <DialogDescription>
              The new amount will be reflected on the next monthly
              invoice.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-4">
            <label
              htmlFor="billing-update-amount"
              className="text-xs uppercase tracking-wider text-muted-foreground font-medium"
            >
              Monthly amount
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                $
              </span>
              <Input
                id="billing-update-amount"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={updateAmount}
                onChange={(e) => setUpdateAmount(e.target.value)}
                className="pl-7"
                placeholder="0.00"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={pending !== null}
              onClick={() => setUpdateOpen(false)}
            >
              Cancel
            </Button>
            <Button
              disabled={pending !== null || !updateAmount.trim()}
              onClick={() => {
                const dollars = Number(updateAmount);
                if (!Number.isFinite(dollars) || dollars <= 0) {
                  toast.error("Enter a positive amount.");
                  return;
                }
                void runAction("update-amount", { monthlyTuition: dollars }).then(
                  () => setUpdateOpen(false)
                );
              }}
            >
              {pending === "update-amount" ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
    case "update-amount":
      return "Monthly amount updated. The new amount will be reflected on the next monthly invoice.";
    case "refund":
      return "Refund issued. The family will see it on their original payment method in 5-10 business days.";
  }
}

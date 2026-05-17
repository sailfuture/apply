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
  PauseCircle,
  PlayCircle,
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
import { cn } from "@/lib/utils";

/**
 * Admin Billing card for the family registration detail page. Reads
 * live from Stripe via `/api/admin/families/:id/billing?yearId=Y` —
 * no Xano mirror, every page load hits the Stripe API. Acceptable for
 * a low-volume admin surface; trades a few hundred ms of latency for
 * always-fresh state.
 *
 * Surfaced data:
 *   - Status pill (Active / Trialing / Past Due / Paused / Canceled)
 *   - Monthly amount + next billing date
 *   - "View in Stripe Dashboard" deep link to the Customer view
 *   - Last 12 invoices in a small table (date, amount, status,
 *     hosted invoice URL)
 *
 * Actions (POST to the same endpoint with `{ action }` body):
 *   - Pause / Resume (toggles based on `pause_collection`)
 *   - Cancel at period end (preserves access through the paid-for
 *     period; confirmation dialog)
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
  };
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
    | "Active"
    | "Trialing"
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
   *  dialog so admin sees the existing value before changing. */
  currentMonthlyTuition: number | null;
  /** Set when the parent hasn't completed payment setup yet —
   *  drives the empty state instead of an error toast on 404. */
  isSetup: boolean;
}

export function BillingCard({
  familyId,
  yearId,
  currentMonthlyTuition,
  isSetup,
}: Props) {
  const endpoint = `/api/admin/families/${familyId}/billing?yearId=${yearId}`;
  const { data, error, isLoading, mutate } = useSWR<BillingSnapshot>(
    isSetup ? endpoint : null,
    adminFetcher,
    { revalidateOnFocus: false, dedupingInterval: 10000 }
  );

  const [pending, setPending] = useState<
    null | "pause" | "resume" | "cancel" | "update-amount" | "refund"
  >(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmRefund, setConfirmRefund] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [updateAmount, setUpdateAmount] = useState(
    currentMonthlyTuition != null ? String(currentMonthlyTuition) : ""
  );

  async function runAction(
    action: "pause" | "resume" | "cancel" | "update-amount" | "refund",
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

  if (!isSetup) {
    return (
      <div className="rounded-md border bg-muted/10 p-6">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted/50">
            <CreditCard className="size-5 text-muted-foreground" aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium">No payment method on file</p>
            <p className="text-xs text-muted-foreground max-w-lg">
              The parent hasn&rsquo;t completed the Payment Setup step yet.
              Once they finish Stripe Checkout, this card will show the
              subscription + invoice history.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="rounded-md border bg-muted/10 p-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Loading billing details from Stripe…
        </div>
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

  const sub = data.subscription;
  const item = sub.items?.data?.[0] ?? null;
  const monthlyCents = item?.price?.unit_amount ?? 0;
  const monthlyDollars = monthlyCents / 100;
  const isPaused = !!sub.pause_collection;
  const isCanceled = sub.status === "canceled";
  const cancelingAtPeriodEnd = sub.cancel_at_period_end;
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const stripeDashboardUrl = `https://dashboard.stripe.com/customers/${customerId}`;
  const nextBillingDate = sub.current_period_end
    ? new Date(sub.current_period_end * 1000).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : "—";

  return (
    <div className="rounded-md border bg-muted/10 p-4 space-y-5">
      {/* Header — status pill + amount + next billing */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
              Subscription
            </p>
            <StatusPill label={data.statusLabel} />
            {cancelingAtPeriodEnd && !isCanceled ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 text-amber-800 ring-1 ring-amber-200 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide">
                Cancels {nextBillingDate}
              </span>
            ) : null}
          </div>
          <p className="text-lg font-semibold">
            ${monthlyDollars.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / month
          </p>
          <p className="text-xs text-muted-foreground">
            {sub.status === "trialing"
              ? `First charge ${nextBillingDate}`
              : isCanceled
                ? "Subscription canceled"
                : `Next charge ${nextBillingDate}`}
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
          {isPaused ? (
            <Button
              variant="outline"
              size="sm"
              className="bg-white"
              disabled={pending !== null}
              onClick={() => runAction("resume")}
            >
              {pending === "resume" ? (
                <Loader2 className="size-3.5 mr-1.5 animate-spin" aria-hidden="true" />
              ) : (
                <PlayCircle className="size-3.5 mr-1.5" aria-hidden="true" />
              )}
              Resume billing
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="bg-white"
              disabled={pending !== null}
              onClick={() => runAction("pause")}
            >
              {pending === "pause" ? (
                <Loader2 className="size-3.5 mr-1.5 animate-spin" aria-hidden="true" />
              ) : (
                <PauseCircle className="size-3.5 mr-1.5" aria-hidden="true" />
              )}
              Pause billing
            </Button>
          )}
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
          {!cancelingAtPeriodEnd ? (
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
          ) : null}
        </div>
      ) : null}

      {/* Invoice history table */}
      <div>
        <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-2">
          Recent invoices
        </p>
        {data.invoices.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No invoices yet — the first charge will run on {nextBillingDate}.
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
              The family keeps access through {nextBillingDate}. After that
              date, no further charges run and the subscription ends. You can
              re-enroll the family later if needed.
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
              Changes apply to the next invoice. Stripe prorates the
              difference for the current period.
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
      case "Trialing":
        return "bg-emerald-50 text-emerald-700 ring-emerald-200";
      case "Past Due":
        return "bg-red-50 text-red-700 ring-red-200";
      case "Paused":
        return "bg-amber-50 text-amber-700 ring-amber-200";
      case "Canceled":
      case "Incomplete":
        return "bg-muted text-muted-foreground ring-border";
      default:
        return "bg-muted text-muted-foreground ring-border";
    }
  }, [label]);
  const Icon =
    label === "Active" || label === "Trialing"
      ? CheckCircle2
      : label === "Past Due"
        ? AlertCircle
        : label === "Paused"
          ? PauseCircle
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

function actionSuccessMessage(
  action: "pause" | "resume" | "cancel" | "update-amount" | "refund"
): string {
  switch (action) {
    case "pause":
      return "Billing paused. Future invoices won't generate until you resume.";
    case "resume":
      return "Billing resumed.";
    case "cancel":
      return "Subscription will cancel at the end of the current billing period.";
    case "update-amount":
      return "Monthly amount updated. Stripe will prorate on the next invoice.";
    case "refund":
      return "Refund issued. The family will see it on their original payment method in 5-10 business days.";
  }
}

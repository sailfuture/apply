"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import {
  ArrowLeft,
  Banknote,
  CheckCircle2,
  Circle,
  ExternalLink,
  FileText,
  Loader2,
  XCircle,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BillingCard } from "@/components/admin/billing-card";
import { FamilyStudentsNav, StageNav } from "@/components/admin/stage-nav";
import { TuitionBreakdownTable } from "@/components/admin/tuition-breakdown-table";
import { adminFetcher } from "@/lib/admin-fetcher";
import { cn } from "@/lib/utils";
import type {
  ScheduleResponse,
  ScheduleSlot,
} from "@/app/api/admin/families/[id]/billing/schedule/route";
import type { AdminFamilyRegistrationResponse } from "@/app/api/admin/registrations/[id]/route";

/**
 * Per-family billing detail page — 12-month schedule view backed
 * by the payment-transactions mirror. Reached from the row click
 * on `/admin/billing`.
 *
 * Shows the year's invoice schedule one row per calendar month
 * anchored to the school year's `billing_start_date`. Months
 * Stripe has issued an invoice for show actual data (status +
 * amount + hosted URL); future months show a "Not started"
 * placeholder.
 *
 * Read path is the mirror table only — no live Stripe API hits on
 * page load. Webhook keeps the mirror current; admin can run the
 * `/api/admin/billing/backfill` endpoint if it drifts.
 *
 * URL: `/admin/families/[id]/billing?yearId=Y`
 */
export default function FamilyBillingPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const familyId = Number(params.id);
  const yearIdRaw = searchParams.get("yearId");
  const yearId = yearIdRaw ? Number(yearIdRaw) : null;

  const swrKey =
    Number.isFinite(familyId) && yearId
      ? `/api/admin/families/${familyId}/billing/schedule?yearId=${yearId}`
      : null;
  const { data, isLoading, error, mutate } = useSWR<ScheduleResponse>(
    swrKey,
    adminFetcher
  );

  // "Record an outside payment" (check/cash) — the slot whose invoice
  // is being marked paid out-of-band, null when the dialog is closed.
  const [markPaidSlot, setMarkPaidSlot] = useState<ScheduleSlot | null>(
    null
  );

  // Same payload the registration detail page renders from — reused
  // here for the per-student tuition breakdown receipt. Loaded
  // independently of the schedule so a slow Stripe-mirror query
  // doesn't hold the receipt hostage.
  const regKey =
    Number.isFinite(familyId) && yearId
      ? `/api/admin/registrations/${familyId}?yearId=${yearId}`
      : null;
  const { data: regData } = useSWR<AdminFamilyRegistrationResponse>(
    regKey,
    adminFetcher
  );

  const backHref = yearId
    ? `/admin/billing?yearId=${yearId}`
    : "/admin/billing";

  // The nav band renders in EVERY state — familyId comes from the
  // URL — so moving between family / billing / student surfaces keeps
  // the navigation fixed in place while the content loads below.
  // Layout mirrors the enrolled student page and the family overview.
  const navBand = Number.isFinite(familyId) ? (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-4">
      <FamilyStudentsNav
        familyId={familyId}
        yearId={yearId}
        currentSection="billing"
      />
      <StageNav current="none" familyId={familyId} yearId={yearId} />
    </div>
  ) : null;

  if (!yearId) {
    return (
      <div className="p-6 space-y-6">
        <BackLink href={backHref} />
        {navBand}
        <div className="rounded-lg border bg-white px-6 py-12 text-center text-sm text-muted-foreground">
          Missing <code>yearId</code> in the URL.
        </div>
      </div>
    );
  }

  if (isLoading && !data) {
    return (
      <div className="p-6 space-y-6">
        <BackLink href={backHref} />
        <div className="space-y-1">
          <Skeleton className="h-8 w-72" />
          <Skeleton className="h-4 w-96" />
        </div>
        {navBand}
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6 space-y-6">
        <BackLink href={backHref} />
        {navBand}
        <div className="rounded-lg border bg-white px-6 py-12 text-center text-sm text-muted-foreground">
          {error instanceof Error
            ? error.message
            : "Couldn’t load this family’s billing schedule."}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <BackLink href={backHref} />

      <div className="space-y-1">
        {/* Family name bullet-joined into the primary title so admin
            always knows whose schedule they're looking at — this page
            is reached from both the Billing list and the registration
            detail page, and the table itself carries no family label. */}
        <h1 className="text-2xl font-semibold">
          Billing schedule
          <span className="text-muted-foreground font-normal"> · </span>
          {data.familyName}
        </h1>
        <p className="text-sm text-muted-foreground">
          12-month invoice schedule for the year. Stripe issues one
          invoice per month starting on the billing start date — paid
          invoices clear, open invoices stay billable, future months
          haven&rsquo;t generated an invoice yet.
        </p>
      </div>

      {navBand}

      {/* Subscription state + lifecycle actions — the same BillingCard
          the registration detail page renders, so Start Monthly
          Billing (no subscription yet) or Cancel / Undo-cancel /
          Refund (live subscription) are available right here without
          bouncing back to the registration page. The card fetches its
          own live-Stripe snapshot; `showScheduleLink=false` because
          its schedule deep-link would point at this very page. */}
      <BillingCard
        familyId={familyId}
        yearId={yearId}
        currentMonthlyTuition={
          data.monthlyAmountCents != null
            ? data.monthlyAmountCents / 100
            : null
        }
        billingStartDate={data.billingStartDate}
        registrationConfirmed={data.registrationConfirmed}
        showScheduleLink={false}
      />

      <SummaryCard data={data} />

      {/* Per-student tuition receipt — the exact same table the
          registration detail page renders under its Tuition card
          (shared component), so the billing math admin sees here
          always matches what the family signed for. Sits directly
          under the year summary so the derivation of the monthly
          amount reads top-to-bottom. */}
      {regData && regData.students.length > 0 ? (
        <Card className="overflow-hidden gap-0 py-0 bg-white">
          <CardHeader className="py-3 !pb-3 border-b">
            <CardTitle className="text-base">Tuition breakdown</CardTitle>
          </CardHeader>
          <CardContent className="px-4 py-4 bg-white">
            <TuitionBreakdownTable
              students={regData.students}
              schoolYear={regData.school_year}
              scholarship={regData.scholarship}
            />
          </CardContent>
        </Card>
      ) : null}

      <ScheduleCard slots={data.slots} onMarkPaid={setMarkPaidSlot} />

      {/* Keyed by invoice so reopening for a different month starts
          with fresh form state instead of the previous entry's. */}
      {markPaidSlot ? (
        <MarkPaidDialog
          key={markPaidSlot.invoice?.stripeInvoiceId ?? markPaidSlot.slotIndex}
          familyId={familyId}
          slot={markPaidSlot}
          onClose={() => setMarkPaidSlot(null)}
          onRecorded={() => {
            setMarkPaidSlot(null);
            void mutate();
          }}
        />
      ) : null}
    </div>
  );
}

function SummaryCard({ data }: { data: ScheduleResponse }) {
  const monthlyDollars =
    data.monthlyAmountCents != null
      ? data.monthlyAmountCents / 100
      : null;
  const yearTotalDollars =
    data.yearTotalCents != null ? data.yearTotalCents / 100 : null;
  const paidDollars = data.paidCents / 100;
  const outstandingDollars = data.outstandingCents / 100;
  const billingStartLabel = useMemo(() => {
    if (!data.billingStartDate) return "Not set";
    const ms = Date.parse(`${data.billingStartDate}T00:00:00Z`);
    if (!Number.isFinite(ms)) return data.billingStartDate;
    return new Date(ms).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
  }, [data.billingStartDate]);

  return (
    <Card className="overflow-hidden gap-0 py-0 bg-white">
      <CardHeader className="py-3 !pb-3 border-b">
        <CardTitle className="text-base">Year summary</CardTitle>
      </CardHeader>
      <CardContent className="px-4 py-4 bg-white">
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <SummaryStat
            label="Monthly amount"
            value={monthlyDollars != null ? formatUsd(monthlyDollars) : "—"}
          />
          <SummaryStat
            label="Year total"
            value={
              yearTotalDollars != null ? formatUsd(yearTotalDollars) : "—"
            }
          />
          <SummaryStat
            label="Paid YTD"
            value={formatUsd(paidDollars)}
            tone="positive"
          />
          <SummaryStat
            label="Outstanding"
            value={formatUsd(outstandingDollars)}
            tone={outstandingDollars > 0 ? "negative" : "muted"}
          />
        </dl>
        <p className="text-xs text-muted-foreground mt-4">
          First invoice: <span className="font-medium">{billingStartLabel}</span>
        </p>
      </CardContent>
    </Card>
  );
}

function SummaryStat({
  label,
  value,
  tone = "muted",
}: {
  label: string;
  value: string;
  tone?: "muted" | "positive" | "negative";
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
        {label}
      </dt>
      <dd
        className={cn(
          "text-lg font-semibold tabular-nums mt-1",
          tone === "positive" && "text-emerald-700",
          tone === "negative" && "text-red-700"
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function ScheduleCard({
  slots,
  onMarkPaid,
}: {
  slots: ScheduleSlot[];
  /** "Mark paid" click on an open/failed row — opens the
   *  outside-payment dialog for that slot's invoice. */
  onMarkPaid: (slot: ScheduleSlot) => void;
}) {
  return (
    <Card className="overflow-hidden gap-0 py-0 bg-white">
      <CardHeader className="py-3 !pb-3 border-b">
        <CardTitle className="text-base">Monthly invoices</CardTitle>
      </CardHeader>
      <CardContent className="px-3 pb-3 bg-white">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="text-[10px] text-muted-foreground w-[14%]">
                Month
              </TableHead>
              <TableHead className="text-[10px] text-muted-foreground w-[16%]">
                Invoice Sent
              </TableHead>
              <TableHead className="text-[10px] text-muted-foreground w-[16%]">
                Due By
              </TableHead>
              <TableHead className="text-[10px] text-muted-foreground w-[12%] text-right">
                Amount
              </TableHead>
              <TableHead className="text-[10px] text-muted-foreground w-[12%] text-right">
                Paid
              </TableHead>
              <TableHead className="text-[10px] text-muted-foreground w-[14%]">
                Status
              </TableHead>
              <TableHead className="text-[10px] text-muted-foreground w-[16%] text-right">
                Invoice
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {slots.map((slot) => (
              <ScheduleRow
                key={slot.slotIndex}
                slot={slot}
                onMarkPaid={onMarkPaid}
              />
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

/** Row-action pill — inline badge-style button/link (rounded, bordered,
 *  hover wash + pointer) matching the table's pill vocabulary, instead
 *  of underlined text links. */
const ACTION_BADGE =
  "inline-flex cursor-pointer items-center gap-1 rounded-full border bg-white px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";

function ScheduleRow({
  slot,
  onMarkPaid,
}: {
  slot: ScheduleSlot;
  onMarkPaid: (slot: ScheduleSlot) => void;
}) {
  const inv = slot.invoice;
  // Server-computed from the RAW mirror status (open/uncollectible —
  // the same check the mark-paid route enforces). The folded UI
  // status can't stand in for it: "open" includes pre-finalization
  // drafts, which neither Stripe nor the route can mark paid.
  const canMarkPaid = inv?.canMarkPaid === true;
  // "Invoice sent" = the day Stripe finalized + emailed the invoice
  // (`finalized_at` from the mirror, set on invoice.finalized
  // webhook). "Due by" = Stripe's `due_date`, calculated server-side
  // as sent + 15 days because the subscription was created with
  // `days_until_due: 15`. We render Stripe's calculated date rather
  // than recomputing client-side so we stay aligned with whatever
  // Stripe actually told the family on the hosted invoice.
  const sentLabel = inv?.finalizedAt ? formatDate(inv.finalizedAt) : "—";
  const dueLabel = inv?.dueDate ? formatDate(inv.dueDate) : "—";
  const amountDue = inv ? inv.amountDueCents / 100 : null;
  const amountPaid = inv ? inv.amountPaidCents / 100 : null;
  return (
    <TableRow className={cn(slot.status === "not_started" && "opacity-70")}>
      <TableCell className="font-medium">{slot.monthLabel}</TableCell>
      <TableCell className="text-muted-foreground tabular-nums">
        {sentLabel}
      </TableCell>
      <TableCell className="text-muted-foreground tabular-nums">
        {dueLabel}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {amountDue != null ? formatUsd(amountDue) : "—"}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {amountPaid != null && amountPaid > 0 ? formatUsd(amountPaid) : "—"}
      </TableCell>
      <TableCell>
        {/* The out-of-band method rides INSIDE the pill ("Complete ·
            via Check") rather than on a second line; the full value
            with the check # sits in the tooltip. Gated on paid: the
            label can't be cleared by syncs (they omit the key), so if
            the payment record is voided in the Stripe Dashboard and
            the invoice reopens, an unguarded label would mislabel an
            Open pill. */}
        <StatusPill
          status={slot.status}
          paymentMethod={slot.status === "paid" ? inv?.paymentMethod : null}
        />
      </TableCell>
      <TableCell className="text-right">
        {inv ? (
          <span className="inline-flex items-center gap-1.5">
            {canMarkPaid ? (
              // Record a payment that happened OUTSIDE Stripe (check
              // or cash) — opens the confirm dialog; the API marks
              // the Stripe invoice paid out-of-band.
              <button
                type="button"
                onClick={() => onMarkPaid(slot)}
                className={ACTION_BADGE}
                title="Record a check or cash payment — marks the Stripe invoice paid without charging anyone"
              >
                <Banknote className="size-3" aria-hidden="true" />
                Mark paid
              </button>
            ) : null}
            {inv.hostedInvoiceUrl ? (
              // Stripe's unauthenticated pay-this-exact-invoice page —
              // anyone holding the link can view and pay it, so admin
              // can open it and enter a card on the family's behalf.
              <a
                href={inv.hostedInvoiceUrl}
                target="_blank"
                rel="noreferrer"
                className={ACTION_BADGE}
                title="Open the payment page — anyone with the link can view and pay, no login needed"
              >
                <ExternalLink className="size-3" aria-hidden="true" />
                View
              </a>
            ) : inv.invoicePdfUrl ? (
              <a
                href={inv.invoicePdfUrl}
                target="_blank"
                rel="noreferrer"
                className={ACTION_BADGE}
              >
                <FileText className="size-3" aria-hidden="true" />
                PDF
              </a>
            ) : null}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
    </TableRow>
  );
}

function StatusPill({
  status,
  paymentMethod,
}: {
  status: ScheduleSlot["status"];
  /** Out-of-band collection method ("Check — #1042") — the method
   *  word renders inside the pill ("· via Check"); the full value,
   *  reference number included, lives in the tooltip. */
  paymentMethod?: string | null;
}) {
  const config = (() => {
    switch (status) {
      case "paid":
        return {
          label: "Complete",
          tone: "bg-emerald-50 text-emerald-700 ring-emerald-200",
          Icon: CheckCircle2,
        };
      case "open":
        return {
          label: "Pending",
          tone: "bg-amber-50 text-amber-700 ring-amber-200",
          Icon: Circle,
        };
      case "failed":
        return {
          label: "Failed",
          tone: "bg-red-50 text-red-700 ring-red-200",
          Icon: XCircle,
        };
      case "void":
        return {
          label: "Void",
          tone: "bg-muted text-muted-foreground ring-border",
          Icon: XCircle,
        };
      case "scheduled":
        // Live subscription, invoice not generated yet (future-dated
        // billing) — Stripe will bill this month automatically.
        return {
          label: "Scheduled",
          tone: "bg-blue-50 text-blue-700 ring-blue-200",
          Icon: Circle,
        };
      case "not_started":
      default:
        return {
          label: "Not started",
          tone: "bg-muted text-muted-foreground ring-border",
          Icon: Circle,
        };
    }
  })();
  const { label, tone, Icon } = config;
  const methodWord = paymentMethod ? paymentMethod.split(" — ")[0] : null;
  return (
    <span
      title={paymentMethod ?? undefined}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ring-1",
        tone
      )}
    >
      <Icon className="size-2.5" aria-hidden="true" />
      {label}
      {methodWord ? (
        <span className="font-normal opacity-80">· via {methodWord}</span>
      ) : null}
    </span>
  );
}

function BackLink({ href }: { href: string }) {
  return (
    <Button asChild variant="outline" size="sm" className="bg-white w-fit">
      <Link href={href}>
        <ArrowLeft className="size-3.5 mr-1.5" />
        Back to billing
      </Link>
    </Button>
  );
}

const PAYMENT_METHODS = [
  { key: "check", label: "Check" },
  { key: "cash", label: "Cash" },
  { key: "other", label: "Other" },
] as const;
type PaymentMethodKey = (typeof PAYMENT_METHODS)[number]["key"];

/**
 * Confirm dialog for recording a payment made OUTSIDE Stripe (check /
 * cash). Posts to the mark-paid route, which marks the Stripe invoice
 * paid out-of-band — nobody's card is charged, Stripe's reminders
 * stop, and the webhook + immediate mirror write flip the month to
 * Complete. Caller keys this component by invoice so form state
 * resets between months.
 */
function MarkPaidDialog({
  familyId,
  slot,
  onClose,
  onRecorded,
}: {
  familyId: number;
  slot: ScheduleSlot;
  onClose: () => void;
  onRecorded: () => void;
}) {
  const inv = slot.invoice;
  const [method, setMethod] = useState<PaymentMethodKey>("check");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const amountLabel = inv ? formatUsd(inv.amountDueCents / 100) : "";

  async function submit() {
    if (!inv || saving) return;
    setSaving(true);
    try {
      const res = await fetch(
        `/api/admin/families/${familyId}/billing/mark-paid`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            invoiceId: inv.stripeInvoiceId,
            method,
            note: note.trim() || undefined,
          }),
        }
      );
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(body?.error ?? `Failed to record (${res.status})`);
      }
      toast.success(
        `${slot.monthLabel} marked paid — ${body?.payment_method ?? "recorded"}.`
      );
      onRecorded();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't record the payment"
      );
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !saving && !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record an outside payment</DialogTitle>
          <DialogDescription>
            Marks the {slot.monthLabel} invoice ({amountLabel}) as paid
            out-of-band in Stripe — no card is charged and payment
            reminders stop. Use this when the family paid by check or
            cash. Reversing it later is a Stripe Dashboard operation.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label
              htmlFor="mark-paid-method"
              className="block text-xs font-medium text-muted-foreground mb-1.5"
            >
              Payment type
            </label>
            <Select
              value={method}
              onValueChange={(v) => setMethod(v as PaymentMethodKey)}
              disabled={saving}
            >
              <SelectTrigger id="mark-paid-method" className="w-full bg-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_METHODS.map((m) => (
                  <SelectItem key={m.key} value={m.key}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label
              htmlFor="mark-paid-note"
              className="block text-xs font-medium text-muted-foreground mb-1.5"
            >
              Reference (optional)
            </label>
            <Input
              id="mark-paid-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Check #1042"
              disabled={saving}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            className="bg-white"
            disabled={saving}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button type="button" disabled={saving || !inv} onClick={submit}>
            {saving ? (
              <>
                <Loader2 className="size-3.5 mr-1.5 animate-spin" aria-hidden="true" />
                Recording…
              </>
            ) : (
              `Mark ${amountLabel} paid`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatUsd(dollars: number): string {
  return `$${dollars.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

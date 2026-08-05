"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import useSWR from "swr";
import {
  ArrowLeft,
  CheckCircle2,
  Circle,
  ExternalLink,
  FileText,
  XCircle,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
  const { data, isLoading, error } = useSWR<ScheduleResponse>(
    swrKey,
    adminFetcher
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

  if (!yearId) {
    return (
      <div className="p-6 space-y-4">
        <BackLink href={backHref} />
        <div className="rounded-lg border bg-white px-6 py-12 text-center text-sm text-muted-foreground">
          Missing <code>yearId</code> in the URL.
        </div>
      </div>
    );
  }

  if (isLoading && !data) {
    return (
      <div className="p-6 space-y-4">
        <BackLink href={backHref} />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6 space-y-4">
        <BackLink href={backHref} />
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

      <ScheduleCard slots={data.slots} familyId={familyId} />
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
  familyId,
}: {
  slots: ScheduleSlot[];
  familyId: number;
}) {
  void familyId; // kept for parity with future per-row actions
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
              <ScheduleRow key={slot.slotIndex} slot={slot} />
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function ScheduleRow({ slot }: { slot: ScheduleSlot }) {
  const inv = slot.invoice;
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
        <StatusPill status={slot.status} />
      </TableCell>
      <TableCell className="text-right">
        {inv?.hostedInvoiceUrl ? (
          <a
            href={inv.hostedInvoiceUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <ExternalLink className="size-3" aria-hidden="true" />
            View
          </a>
        ) : inv?.invoicePdfUrl ? (
          <a
            href={inv.invoicePdfUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <FileText className="size-3" aria-hidden="true" />
            PDF
          </a>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
    </TableRow>
  );
}

function StatusPill({ status }: { status: ScheduleSlot["status"] }) {
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
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ring-1",
        tone
      )}
    >
      <Icon className="size-2.5" aria-hidden="true" />
      {label}
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

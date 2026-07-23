"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import {
  ChevronRight,
  CreditCard,
  Download,
  ExternalLink,
  Search,
} from "lucide-react";
import { ActivityLogSheet } from "@/components/admin/activity-log-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { STRIPE_INVOICES_DASHBOARD_URL } from "@/lib/stripe-dashboard";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { adminFetcher } from "@/lib/admin-fetcher";
import type {
  BillingListResponse,
  BillingRow,
  BillingRowStatus,
  NotStartedRow,
} from "@/app/api/admin/billing/route";
import { exportBillingXlsx } from "@/lib/billing-export";

/**
 * Admin Billing list — every family with a Stripe subscription on
 * file for the selected school year. Each row shows the year-level
 * billing totals (monthly amount, year total, paid YTD, outstanding)
 * computed from the payment-transactions mirror — no Stripe API
 * calls per row.
 *
 * Row click → `/admin/families/[id]/billing?yearId=Y`, which renders
 * the 12-month invoice schedule for that specific family.
 *
 * Data source: `/api/admin/billing?yearId=Y` — joins
 * `registration_families_payment` (for the subscription pointer +
 * monthly amount) with `registration_payment_transactions` (for the
 * paid/outstanding aggregations).
 */
export default function AdminBillingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const yearId = searchParams.get("yearId");

  const { data, isLoading, error } = useSWR<BillingListResponse>(
    yearId ? `/api/admin/billing?yearId=${yearId}` : null,
    adminFetcher
  );

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const notStarted = useMemo(() => data?.notStarted ?? [], [data]);

  // Status counts for the summary strip.
  const statusCounts = useMemo(() => {
    const counts = { active: 0, scheduled: 0, past_due: 0, no_invoices: 0 };
    for (const r of rows) counts[r.status] += 1;
    return counts;
  }, [rows]);
  const totalMonthly = useMemo(
    () => rows.reduce((acc, r) => acc + (r.monthly_tuition ?? 0), 0),
    [rows]
  );

  // Client-side .xlsx export of the whole paying-families list for the
  // year (not the search-filtered subset) — `exceljs` is lazy-loaded
  // inside the helper so it only ships on demand.
  const [exporting, setExporting] = useState(false);
  // Row-click billing activity sheet — the stream filtered to Stripe
  // subscription/invoice/payment events only.
  const [billingActivityFamily, setBillingActivityFamily] = useState<
    number | null
  >(null);
  async function handleExport() {
    if (rows.length === 0 || exporting) return;
    setExporting(true);
    try {
      await exportBillingXlsx(rows);
    } catch (err) {
      console.error("Billing export failed:", err);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Billing</h1>
          <p className="text-sm text-muted-foreground">
            Every enrolled family with a Stripe subscription for the
            selected year. Monthly amount, full-year total, and paid
            / outstanding balances all reflect the payment-transactions
            mirror (webhook-fed from Stripe). Click a row to see that
            family&rsquo;s 12-month invoice schedule.
          </p>
        </div>
        {/* Direct link to Stripe's global invoices view for the
            SailFuture account. Useful for cross-checking against the
            local mirror, refunds we issued out-of-band, or
            invoice-level edits that Stripe is the authority on. */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="bg-white"
            disabled={rows.length === 0 || exporting}
            onClick={handleExport}
          >
            <Download className="size-3.5 mr-1.5" aria-hidden="true" />
            {exporting ? "Exporting…" : "Export"}
          </Button>
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
      </div>

      {/* Row-click billing activity — the family stream filtered to
          Stripe subscription/invoice/payment events. */}
      {billingActivityFamily && yearId ? (
        <ActivityLogSheet
          familyId={billingActivityFamily}
          yearId={Number(yearId)}
          open
          filterScope="billing"
          noteSection="billing"
          contextLabel="Billing"
          onOpenChange={(o) => {
            if (!o) setBillingActivityFamily(null);
          }}
        />
      ) : null}

      {error ? (
        <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
          Failed to load billing list:{" "}
          {error instanceof Error ? error.message : "unknown error"}
        </div>
      ) : null}

      {!yearId ? (
        <div className="rounded-lg border bg-white px-6 py-12 text-center text-sm text-muted-foreground">
          Pick a school year above to view billing.
        </div>
      ) : isLoading && !data ? (
        <BillingListSkeleton />
      ) : rows.length === 0 && notStarted.length === 0 ? (
        <BillingEmptyState />
      ) : (
        <>
          {/* Summary strip — one glance at the health of the year's
              billing: how many subscriptions are in each state, how
              many confirmed families still need billing started, and
              the program-wide monthly total. */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <SummaryChip
              label="Active"
              count={statusCounts.active}
              className="border-emerald-200 bg-emerald-50 text-emerald-700"
            />
            <SummaryChip
              label="Scheduled"
              count={statusCounts.scheduled}
              className="border-blue-200 bg-blue-50 text-blue-700"
            />
            <SummaryChip
              label="Past due"
              count={statusCounts.past_due}
              className="border-red-200 bg-red-50 text-red-700"
            />
            <SummaryChip
              label="No invoices"
              count={statusCounts.no_invoices}
              className="border-amber-200 bg-amber-50 text-amber-700"
            />
            <SummaryChip
              label="Not started"
              count={notStarted.length}
              className="border-amber-300 bg-amber-100 text-amber-800"
            />
            <span className="ml-auto rounded-full border bg-white px-2.5 py-1 tabular-nums text-muted-foreground">
              Total monthly: {formatMonthly(totalMonthly || null)}
            </span>
          </div>

          {/* Pending setups first — these are actionable (a confirmed
              family isn't being billed until someone clicks Start),
              so they outrank the already-running list. Hidden when
              empty. */}
          {notStarted.length > 0 ? (
            <NotStartedTable
              rows={notStarted}
              onRowClick={(row) =>
                router.push(
                  `/admin/families/${row.family_id}/billing?yearId=${row.year_id}`
                )
              }
            />
          ) : null}

          {rows.length > 0 ? (
            <BillingTable
              rows={rows}
              onOpenFamily={(row) =>
                router.push(
                  `/admin/families/${row.family_id}/billing?yearId=${row.year_id}`
                )
              }
              onRowClick={(row) =>
                setBillingActivityFamily(row.family_id)
              }
            />
          ) : null}
        </>
      )}
    </div>
  );
}

function SummaryChip({
  label,
  count,
  className,
}: {
  label: string;
  count: number;
  className: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium",
        // Zero-count chips fade back so the non-zero states pop.
        count === 0 && "opacity-45",
        className
      )}
    >
      {label}
      <span className="tabular-nums">{count}</span>
    </span>
  );
}

/** Status pill for one billing row — colors match the summary chips. */
function StatusPill({ status }: { status: BillingRowStatus }) {
  const config: Record<
    BillingRowStatus,
    { label: string; className: string; title?: string }
  > = {
    active: {
      label: "Active",
      className: "border-emerald-200 bg-emerald-50 text-emerald-700",
    },
    scheduled: {
      label: "Scheduled",
      className: "border-blue-200 bg-blue-50 text-blue-700",
      title: "Subscription is live; the first invoice lands on the billing start date.",
    },
    past_due: {
      label: "Past due",
      className: "border-red-200 bg-red-50 text-red-700",
      title: "An unpaid invoice is past its due date.",
    },
    no_invoices: {
      label: "No invoices",
      className: "border-amber-200 bg-amber-50 text-amber-700",
      title:
        "Live subscription but no invoices recorded well past billing start — check the Stripe webhook or run the backfill.",
    },
  };
  const c = config[status];
  return (
    <span
      title={c.title}
      className={cn(
        "inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium",
        c.className
      )}
    >
      {c.label}
    </span>
  );
}

/**
 * Confirmed families with no live subscription — billing work waiting
 * for the Start click. Row click lands on the family's billing card
 * where the "Start Monthly Billing" button lives.
 */
function NotStartedTable({
  rows,
  onRowClick,
}: {
  rows: NotStartedRow[];
  onRowClick: (row: NotStartedRow) => void;
}) {
  return (
    <Card className="overflow-hidden border-amber-200 bg-white py-0 gap-0">
      <CardHeader className="py-4 border-b border-amber-200 bg-amber-50/50">
        <div className="flex items-baseline gap-3">
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-amber-800">
            Billing not started
          </CardTitle>
          <span className="text-xs tabular-nums text-amber-800/70">
            ({rows.length})
          </span>
          <p className="text-xs text-amber-800/70">
            Registration confirmed, but no subscription exists yet — these
            families aren&rsquo;t being billed. Click one to start billing.
          </p>
        </div>
      </CardHeader>
      <CardContent className="p-4 bg-white">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="text-[10px] uppercase tracking-wider text-muted-foreground w-[30%]">
                Family
              </TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider text-muted-foreground w-[34%]">
                Primary Contact
              </TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider text-muted-foreground w-[18%] text-right">
                Monthly (once started)
              </TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider text-muted-foreground w-[14%]">
                Readiness
              </TableHead>
              <TableHead className="w-[4%]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow
                key={row.family_id}
                onClick={() => onRowClick(row)}
                className="cursor-pointer"
              >
                <TableCell className="text-sm font-medium">
                  {row.family_name}
                </TableCell>
                <TableCell className="text-sm">
                  <span className="block truncate">
                    {row.primary_email || row.primary_name || "—"}
                  </span>
                </TableCell>
                <TableCell className="text-sm text-right tabular-nums">
                  {formatMonthly(row.monthly_tuition)}
                </TableCell>
                <TableCell className="text-xs">
                  {row.monthly_tuition != null ? (
                    <span className="text-emerald-700">Ready to start</span>
                  ) : (
                    <span
                      className="text-amber-700"
                      title="Set each student's tuition on the Scholarship Determination card first."
                    >
                      Tuition not set
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <ChevronRight className="size-4 text-muted-foreground inline" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function BillingTable({
  rows,
  onRowClick,
  onOpenFamily,
}: {
  rows: BillingRow[];
  /** Row click — opens the billing-scoped activity sheet. */
  onRowClick: (row: BillingRow) => void;
  /** Family-name click — navigates to the family's billing page. */
  onOpenFamily: (row: BillingRow) => void;
}) {
  const [search, setSearch] = useState("");
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      `${r.family_name} ${r.primary_email ?? ""} ${r.primary_name ?? ""}`
        .toLowerCase()
        .includes(q)
    );
  }, [rows, search]);

  return (
    <Card className="overflow-hidden bg-white py-0 gap-0">
      <CardHeader className="py-4 border-b bg-white">
        <div className="flex items-baseline gap-3">
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Subscriptions on file
          </CardTitle>
          <span className="text-xs tabular-nums text-muted-foreground">
            ({rows.length})
          </span>
        </div>
      </CardHeader>
      <CardContent className="p-4 bg-white space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground/60" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search families…"
            className="pl-9 bg-white"
          />
        </div>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="text-[10px] uppercase tracking-wider text-muted-foreground w-[16%]">
                Family
              </TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider text-muted-foreground w-[16%]">
                Primary Contact
              </TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider text-muted-foreground w-[10%]">
                Status
              </TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider text-muted-foreground w-[10%] text-right">
                Monthly
              </TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider text-muted-foreground w-[10%] text-right">
                Year total
              </TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider text-muted-foreground w-[10%] text-right">
                Paid
              </TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider text-muted-foreground w-[12%] text-right">
                Outstanding
              </TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider text-muted-foreground w-[12%] text-right">
                Next invoice
              </TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider text-muted-foreground w-[4%] text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell
                  colSpan={9}
                  className="py-8 text-center text-sm italic text-muted-foreground"
                >
                  No families match &ldquo;{search}&rdquo;.
                </TableCell>
              </TableRow>
            ) : (
              visible.map((row) => (
                <TableRow
                  key={row.id}
                  onClick={() => onRowClick(row)}
                  className="cursor-pointer"
                >
                  <TableCell className="text-sm font-medium">
                    {/* Name click = full billing page; the ROW click
                        opens the billing activity sheet. */}
                    <button
                      type="button"
                      className="block max-w-full truncate text-left font-medium hover:underline"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenFamily(row);
                      }}
                    >
                      {row.family_name}
                    </button>
                  </TableCell>
                  <TableCell className="text-sm">
                    <span className="block truncate">
                      {row.primary_email || row.primary_name || "—"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <StatusPill status={row.status} />
                  </TableCell>
                  <TableCell className="text-sm text-right tabular-nums">
                    {formatMonthly(row.monthly_tuition)}
                  </TableCell>
                  <TableCell className="text-sm text-right tabular-nums">
                    {formatMonthly(row.year_total)}
                  </TableCell>
                  <TableCell className="text-sm text-right tabular-nums text-emerald-700">
                    {formatCents(row.paid_cents)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-sm text-right tabular-nums",
                      row.outstanding_cents > 0
                        ? "text-red-700 font-medium"
                        : "text-muted-foreground"
                    )}
                  >
                    {formatCents(row.outstanding_cents)}
                  </TableCell>
                  <TableCell
                    className="text-sm text-right tabular-nums text-muted-foreground"
                    title="Projected from the year's billing anchor — Stripe owns the exact cycle date."
                  >
                    {formatUpcoming(row.next_invoice_at)}
                  </TableCell>
                  <TableCell className="text-right">
                    <ChevronRight className="size-4 text-muted-foreground inline" />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function BillingListSkeleton() {
  return (
    <Card className="overflow-hidden bg-white py-0 gap-0">
      <CardHeader className="py-4 border-b bg-white">
        <Skeleton className="h-4 w-32" />
      </CardHeader>
      <CardContent className="p-4 space-y-2">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </CardContent>
    </Card>
  );
}

function BillingEmptyState() {
  return (
    <Card className="bg-white">
      <CardContent className="py-16 px-6 text-center">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-muted">
          <CreditCard className="size-6 text-muted-foreground" />
        </div>
        <h3 className="text-base font-semibold">No subscriptions yet</h3>
        <p className="mt-1 text-sm text-muted-foreground max-w-md mx-auto">
          A family appears here once admin confirms their registration —
          that cascade auto-starts the monthly billing subscription.
          Check the <strong>Registrations</strong> queue for in-progress
          families.
        </p>
      </CardContent>
    </Card>
  );
}

/** Format a dollars value (monthly amount, year total) consistently
 *  with the Outstanding / Paid columns below — same "$X,XXX.XX"
 *  shape. Null becomes em-dash. */
function formatMonthly(dollars: number | null): string {
  if (dollars == null) return "—";
  return `$${dollars.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Short date for the projected next-invoice column ("Aug 1, 2026").
 *  Null (no anchor set / year window over) becomes em-dash. */
function formatUpcoming(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Format a cents value (paid_cents, outstanding_cents) for display.
 *  Zero renders as "$0.00" rather than em-dash because zero is
 *  meaningful here ("paid nothing yet" vs "unknown"). */
function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

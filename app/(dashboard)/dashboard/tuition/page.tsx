"use client";

import { Fragment, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import {
  useStudents,
  useApplications,
  useSchoolYears,
  useFamily,
  useScholarship,
} from "@/hooks/use-api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  CheckCircle2,
  Circle,
  CreditCard,
  ExternalLink,
  FileText,
  HelpCircle,
  Loader2,
  XCircle,
} from "lucide-react";
import { DashboardPageHeader } from "@/components/dashboard-page-header";
import { cn } from "@/lib/utils";
import type {
  ParentScheduleResponse,
  ParentScheduleSlot,
} from "@/app/api/billing/schedule/route";

const SUFS_LABELS: Record<string, string> = {
  fes_eo_8: "FES-EO · Grade 8",
  fes_eo_9: "FES-EO · Grade 9",
  ftc_8: "FTC · Grade 8",
  ftc_9: "FTC · Grade 9",
  fes_ua_8_ese_1_3: "FES-UA · ESE 1-3 · Grade 8",
  fes_ua_9_ese_1_3: "FES-UA · ESE 1-3 · Grade 9",
  fes_ua_ese_4: "FES-UA · ESE 4",
  fes_ua_ese_5: "FES-UA · ESE 5",
};

interface StudentRow {
  studentName: string;
  tuition: number;
  stepUpStatus: string;
  stepUpType: string;
  stepUpAmount: number;
  /** OS coverage (what the scholarship pays). Displayed as a negative
   *  discount on the breakdown. */
  scholarshipAmount: number | null;
  remaining: number;
  adminFees: number;
  /** Per-student tuition portion the family pays under the
   *  Opportunity Scholarship determination — surfaced as its own
   *  line when the family is on the OS path. Same value baked into
   *  `subtotal`. */
  familyPaysForTuition: number;
  /** True when this row has an OS determination — either the
   *  family is flagged on OS / SNAP or admin has entered a
   *  per-student award amount. Gates both the OS Award coverage
   *  line and the OS Cost Per Student breakout. */
  hasOSDetermination: boolean;
  subtotal: number;
}

function formatCurrency(value: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function getStatusBadge(status: string) {
  if (!status) return null;
  const lower = status.toLowerCase();
  if (lower === "verified" || lower === "approved") {
    return (
      <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
        {status}
      </span>
    );
  }
  if (lower === "pending") {
    return (
      <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">
        {status}
      </span>
    );
  }
  if (lower === "denied" || lower === "rejected") {
    return (
      <span className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700">
        {status}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700">
      {status}
    </span>
  );
}

/**
 * Tuition & Fees detail page on the parent dashboard.
 *
 * Renders the same per-student cost breakdown the parent reviewed and
 * signed during registration — annual tuition, Step Up scholarship,
 * Opportunity scholarship, admin + transportation fees, monthly payment.
 * Read-only; the registration page is where the signature gets captured.
 */
export default function DashboardTuitionPage() {
  const searchParams = useSearchParams();
  const yearIdParam = searchParams.get("yearId");
  const requestedYearId = yearIdParam ? Number(yearIdParam) : null;

  const { data: students } = useStudents();
  const { data: applications } = useApplications();
  const { data: yearsData } = useSchoolYears();
  const { data: familyData } = useFamily();
  // Per-student tuition math (monthly_amount, sufs_amount,
  // opportunity_award_amount, etc.) lives on the application row —
  // the `applications` data above already carries it. Single
  // source of truth.

  // Defensive fallback: if no `?yearId` was passed (e.g. parent landed
  // here from a stale link), pick the most recent year that this family
  // has any application for. The dashboard normally writes the resolved
  // year to the URL, but this keeps the page useful in either case.
  const resolvedYearId: number | null = useMemo(() => {
    if (requestedYearId !== null) return requestedYearId;
    if (!applications) return null;
    const ids = Array.from(
      new Set(
        (applications as { registration_school_years_id: number }[]).map(
          (a) => a.registration_school_years_id
        )
      )
    );
    if (ids.length === 0) return null;
    return ids.reduce((max, yid) => (yid > max ? yid : max));
  }, [requestedYearId, applications]);

  const yearId = resolvedYearId;
  const dashboardHref = yearId ? `/dashboard?yearId=${yearId}` : "/dashboard";

  // Scholarship row drives the Remaining Tuition Amount breakout —
  // when the family is on the OS path we render a dedicated
  // "Remaining Tuition Amount" line right above the subtotal so the
  // parent sees what they still owe for tuition after scholarships,
  // separately from the OS coverage line.
  const familyIdForScholarship =
    (familyData as { id?: number } | undefined)?.id ?? null;
  const { data: scholarshipData } = useScholarship(
    familyIdForScholarship,
    yearId
  );
  const isOpportunityScholarshipFamily =
    (scholarshipData as { isOpportunityScholarship?: boolean } | null)
      ?.isOpportunityScholarship === true;
  const isSnapFamily =
    (scholarshipData as { isSNAPBenefits?: boolean } | null)
      ?.isSNAPBenefits === true;

  const schoolYear = useMemo(() => {
    if (!yearsData || !yearId) return null;
    return (
      (yearsData as { id: number; year_name?: string; [k: string]: unknown }[]).find(
        (y) => y.id === yearId
      ) ?? null
    );
  }, [yearsData, yearId]);

  const yearName = (schoolYear?.year_name as string | undefined) ?? "current";

  // Build per-student rows from the year's application rows — the
  // application carries the authoritative per-student tuition
  // values (sufs_amount, opportunity_award_amount, tuition_sub_total,
  // annual_fee, monthly_amount) plus the SUFS audit snapshot
  // (sufs_status, sufs_type).
  const studentRows: StudentRow[] = useMemo(() => {
    if (!students || !applications || !schoolYear || !yearId) {
      return [];
    }
    const yearApps = (
      applications as {
        registration_school_years_id: number;
        registration_students_id: number;
        sufs_status?: string;
        sufs_type?: string;
        sufs_amount?: number | null;
        opportunity_award_amount?: number | null;
        annual_fee?: number | null;
        remaining_opportunity_amount?: number | null;
        confirmed_scholarship?: boolean;
      }[]
    ).filter((a) => a.registration_school_years_id === yearId);

    const sy = schoolYear as Record<string, unknown>;
    const rows: StudentRow[] = [];

    for (const app of yearApps) {
      const student = (
        students as { id: number; first_name: string; last_name: string }[]
      ).find((s) => s.id === app.registration_students_id);
      if (!student) continue;

      const tuition = (sy.tuition as number) ?? 0;
      const sufsType = app.sufs_type ?? "";
      const stepUpStatus = app.sufs_status ?? "";

      // Read inputs directly from the application row; derive
      // subtotal + Opportunity Scholarship coverage client-side so
      // the display can't go inconsistent with the inputs (e.g.
      // a stale stored `tuition_sub_total` from a partial write).
      const stepUpAmount =
        typeof app.sufs_amount === "number" ? app.sufs_amount : 0;
      const adminFees =
        typeof app.annual_fee === "number" ? app.annual_fee : 0;
      const familyPaysForTuition =
        typeof app.remaining_opportunity_amount === "number"
          ? app.remaining_opportunity_amount
          : 0;
      const scholarshipCoverage = Math.max(
        tuition - stepUpAmount - familyPaysForTuition,
        0
      );
      const subtotal = familyPaysForTuition + adminFees;

      // OS determination signal — true when the family is on OS/SNAP
      // OR when admin has entered any per-student determination
      // (anything non-zero on the packet's billing columns).
      const hasOSDetermination =
        isOpportunityScholarshipFamily ||
        isSnapFamily ||
        familyPaysForTuition > 0 ||
        scholarshipCoverage > 0;
      // Don't surface the Opportunity Scholarship Award dollar
      // figure to the family until admin has clicked Confirm
      // Scholarship Award Amount on the Determination card. Until
      // then the row reads "—" so the parent doesn't see a value
      // that's still in flux.
      const awardConfirmed = app.confirmed_scholarship === true;

      rows.push({
        studentName: `${student.first_name} ${student.last_name}`,
        tuition,
        stepUpStatus,
        stepUpType: sufsType,
        stepUpAmount,
        scholarshipAmount:
          awardConfirmed && hasOSDetermination ? scholarshipCoverage : 0,
        remaining: hasOSDetermination ? scholarshipCoverage : 0,
        adminFees,
        familyPaysForTuition,
        hasOSDetermination,
        subtotal,
      });
    }
    return rows;
  }, [
    students,
    applications,
    schoolYear,
    yearId,
    isOpportunityScholarshipFamily,
    isSnapFamily,
  ]);

  const grandTotal = studentRows.reduce((sum, r) => sum + r.subtotal, 0);

  const loading = !students || !applications || !yearsData;

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 sm:p-6 mx-auto w-full max-w-4xl">
      <DashboardPageHeader
        backHref={dashboardHref}
        backLabel="Back to Dashboard"
        breadcrumb={[
          { label: "Dashboard", href: dashboardHref },
          // Academic year sits between Dashboard and the page label so
          // the parent always knows which year they're viewing — no need
          // to scroll up to the year picker.
          { label: yearName, href: dashboardHref },
          { label: "Tuition & Fees" },
        ]}
        title={`Tuition & Fees — ${yearName} School Year`}
        subtitle={`Per-student breakdown of tuition, scholarships, and fees for the ${yearName} school year. Same breakdown you reviewed and signed during registration.`}
      />

      {/* Billing summary + 12-month invoice schedule — surfaced ABOVE the
          per-student breakdown so the family sees what they owe and how to
          pay it first, with the line-item breakdown below for reference.
          Mirrors the admin Billing schedule view; reads from
          /api/billing/schedule (gated to the authenticated parent's own
          family). "Manage billing" opens the Stripe Customer Portal where
          the parent can save a payment method, opt into autopay, and
          download invoices. */}
      {yearId ? <BillingScheduleSection yearId={yearId} /> : null}

      {loading ? (
        <BreakdownSkeleton />
      ) : studentRows.length === 0 ? (
        <div className="rounded-xl border bg-white px-6 py-12 text-center">
          <p className="text-muted-foreground text-sm">
            No students found for this school year.
          </p>
        </div>
      ) : (
        <div className="rounded-xl bg-background p-1.5 shadow-sm border">
          <div className="overflow-hidden rounded-lg border bg-white">
            <table className="w-full text-sm">
              <tbody>
                {studentRows.map((row, idx) => (
                  <Fragment key={idx}>
                    {/* Student group header */}
                    <tr className="bg-muted/40 border-t first:border-t-0">
                      <td colSpan={2} className="px-4 py-3">
                        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Student
                        </span>
                        <span className="mx-2 text-muted-foreground">—</span>
                        <span className="font-semibold text-foreground">
                          {row.studentName}
                        </span>
                      </td>
                    </tr>

                    {/* Annual Tuition */}
                    <tr className="border-t">
                      <td className="px-4 py-3 text-muted-foreground">
                        Annual Tuition
                      </td>
                      <td className="px-4 py-3 text-right font-medium">
                        ${formatCurrency(row.tuition)}
                      </td>
                    </tr>

                    {/* Step Up Status */}
                    <tr className="border-t">
                      <td className="px-4 py-3 text-muted-foreground">
                        Step Up for Students Award Status
                      </td>
                      <td className="px-4 py-3 text-right">
                        {row.stepUpStatus ? (
                          getStatusBadge(row.stepUpStatus)
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>

                    {/* Step Up Type */}
                    <tr className="border-t">
                      <td className="px-4 py-3 text-muted-foreground">
                        <span className="inline-flex items-center gap-1.5">
                          Step Up for Students Award Type
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                className="inline-flex text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                              >
                                <HelpCircle className="size-3.5" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent
                              side="top"
                              className="max-w-xs text-xs"
                            >
                              <p>
                                The Step Up for Students award type is
                                determined by the scholarship program your
                                student was approved for. Award amount varies
                                by program type and grade level.
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-medium">
                        {row.stepUpType && SUFS_LABELS[row.stepUpType] ? (
                          SUFS_LABELS[row.stepUpType]
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>

                    {/* Step Up Amount */}
                    <tr className="border-t">
                      <td className="px-4 py-3 text-muted-foreground">
                        Step Up for Students Award Amount
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-green-600">
                        {row.stepUpAmount > 0
                          ? `-$${formatCurrency(row.stepUpAmount)}`
                          : "$0.00"}
                      </td>
                    </tr>

                    {/* Opportunity Scholarship */}
                    <tr className="border-t">
                      <td className="px-4 py-3 text-muted-foreground">
                        <span className="inline-flex items-center gap-1.5">
                          Opportunity Scholarship Award
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                className="inline-flex text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                              >
                                <HelpCircle className="size-3.5" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent
                              side="top"
                              className="max-w-xs text-xs"
                            >
                              <p>
                                The Opportunity Scholarship award is
                                determined based on your household income,
                                household size, and assets as reported in the
                                Financial Aid application.
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-green-600">
                        {row.scholarshipAmount != null && row.scholarshipAmount > 0 ? (
                          `-$${formatCurrency(row.scholarshipAmount)}`
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>

                    {/* Remaining Tuition Amount — the per-student
                        tuition you still owe after the Opportunity
                        Scholarship has been applied. Same value baked
                        into the subtotal below, broken out as its own
                        row. Renders whenever this row has an OS
                        determination (admin entered a per-student
                        amount, OR family is flagged on OS, OR family
                        is on SNAP). */}
                    {row.hasOSDetermination ? (
                      <tr className="border-t">
                        <td className="px-4 py-3 text-muted-foreground">
                          <span className="inline-flex items-center gap-1.5">
                            Remaining Tuition Amount
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  type="button"
                                  className="inline-flex text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                                >
                                  <HelpCircle className="size-3.5" />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent
                                side="top"
                                className="max-w-xs text-xs"
                              >
                                {isSnapFamily ? (
                                  <p>
                                    SNAP-qualified families have no
                                    remaining tuition — the Opportunity
                                    Scholarship covers the full per-student
                                    amount.
                                  </p>
                                ) : (
                                  <p>
                                    The per-student tuition you still owe
                                    after the Opportunity Scholarship has
                                    been applied.
                                  </p>
                                )}
                              </TooltipContent>
                            </Tooltip>
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-medium">
                          ${formatCurrency(row.familyPaysForTuition)}
                        </td>
                      </tr>
                    ) : null}

                    {/* Annual Admin Fee — sits directly above the
                        subtotal so the family reads the receipt
                        top-to-bottom: gross tuition, awards that
                        offset it, then the line items that make up
                        what they actually owe (remaining tuition +
                        admin fee = subtotal). */}
                    <tr className="border-t">
                      <td className="px-4 py-3 text-muted-foreground">
                        Annual Admin Fee
                      </td>
                      <td className="px-4 py-3 text-right font-medium">
                        ${formatCurrency(row.adminFees)}
                      </td>
                    </tr>

                    {/* Student subtotal */}
                    <tr className="border-t bg-muted/20">
                      <td className="px-4 py-3 font-medium">
                        Subtotal — {row.studentName}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold">
                        ${formatCurrency(row.subtotal)}
                      </td>
                    </tr>
                  </Fragment>
                ))}

                {/* Grand total + monthly */}
                <tr className="border-t-2 bg-white">
                  <td className="px-4 py-3 font-bold">Total Due</td>
                  <td className="px-4 py-3 text-right font-bold">
                    ${formatCurrency(grandTotal)}
                  </td>
                </tr>
                <tr className="border-t bg-white">
                  <td className="px-4 py-3 font-bold">
                    Monthly Payment (Aug – Jul, 12 months)
                  </td>
                  <td className="px-4 py-3 text-right font-bold">
                    ${formatCurrency(grandTotal / 12)}/mo
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground text-center pt-4 border-t">
        For questions about your account, please{" "}
        <a
          href="mailto:dean@sailfuture.org?subject=Tuition%20question"
          className="text-primary underline underline-offset-2"
        >
          contact the office
        </a>
        .
      </p>
    </div>
  );
}

/* ─────────────────────── Loading skeletons ────────────────────── */

/**
 * Mirrors the Billing summary card (title + button over four stat
 * blocks) and the Monthly invoices table so the page keeps its real
 * shape while /api/billing/schedule loads, instead of one gray slab.
 */
function BillingSkeleton() {
  return (
    <div className="space-y-6">
      {/* Billing summary card */}
      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-8 w-48 rounded-md" />
        </div>
        <div className="px-4 py-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-6 w-24" />
              </div>
            ))}
          </div>
          <Skeleton className="mt-4 h-3 w-3/4" />
        </div>
      </div>

      {/* Monthly invoices table */}
      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="border-b px-4 py-3">
          <Skeleton className="h-5 w-32" />
        </div>
        <div className="divide-y px-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 py-3">
              <Skeleton className="h-4 w-[30%]" />
              <Skeleton className="h-5 w-[20%] rounded-full" />
              <Skeleton className="h-4 w-[15%] ml-auto" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Mirrors the per-student breakdown table — a muted student header
 * row followed by label/amount line items, then the subtotal + total
 * rows — so the receipt appears in place instead of popping in after
 * a featureless gray block.
 */
function BreakdownSkeleton() {
  return (
    <div className="rounded-xl bg-background p-1.5 shadow-sm border">
      <div className="overflow-hidden rounded-lg border bg-white">
        {/* Student group header */}
        <div className="bg-muted/40 px-4 py-3">
          <Skeleton className="h-4 w-52" />
        </div>
        {/* Line items */}
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center justify-between border-t px-4 py-3"
          >
            <Skeleton className="h-4 w-56 max-w-[50%]" />
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
        {/* Subtotal */}
        <div className="flex items-center justify-between border-t bg-muted/20 px-4 py-3">
          <Skeleton className="h-4 w-44" />
          <Skeleton className="h-4 w-24" />
        </div>
        {/* Total + monthly */}
        <div className="flex items-center justify-between border-t-2 px-4 py-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-24" />
        </div>
        <div className="flex items-center justify-between border-t px-4 py-3">
          <Skeleton className="h-4 w-64 max-w-[60%]" />
          <Skeleton className="h-4 w-28" />
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────── Billing schedule ─────────────────────── */

const scheduleFetcher = async (url: string): Promise<ParentScheduleResponse> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load billing schedule (${res.status})`);
  return res.json();
};

function BillingScheduleSection({ yearId }: { yearId: number }) {
  const { data, error, isLoading } = useSWR<ParentScheduleResponse>(
    `/api/billing/schedule?yearId=${yearId}`,
    scheduleFetcher,
    { revalidateOnFocus: false, dedupingInterval: 10000 }
  );

  if (isLoading && !data) {
    return <BillingSkeleton />;
  }

  if (error || !data) {
    return (
      <div className="rounded-xl border bg-white px-6 py-8 text-center text-sm text-muted-foreground">
        {error instanceof Error
          ? error.message
          : "Couldn’t load your billing schedule."}
      </div>
    );
  }

  // No subscription yet → don't render the section at all. The
  // existing per-student breakdown above already covers what the
  // family owes; pre-billing parents don't need a 12-row table of
  // empty months on top of that.
  if (!data.hasBilling) {
    return null;
  }

  return (
    <div className="space-y-6">
      <BillingSummaryCard data={data} yearId={yearId} />
      <BillingScheduleCard slots={data.slots} />
    </div>
  );
}

function BillingSummaryCard({
  data,
  yearId,
}: {
  data: ParentScheduleResponse;
  yearId: number;
}) {
  void yearId;
  const monthlyDollars =
    data.monthlyAmountCents != null ? data.monthlyAmountCents / 100 : null;
  const yearTotalDollars =
    data.yearTotalCents != null ? data.yearTotalCents / 100 : null;
  const paidDollars = data.paidCents / 100;
  const outstandingDollars = data.outstandingCents / 100;
  const billingStartLabel = data.billingStartDate
    ? formatBillingDate(data.billingStartDate)
    : "Not set";

  const [opening, setOpening] = useState(false);

  /** Open the Stripe Customer Portal so the parent can save a
   *  payment method, opt into autopay, and download past invoices.
   *  Hard navigation — Stripe-hosted page is a different origin. */
  async function openPortal() {
    if (opening) return;
    setOpening(true);
    try {
      const res = await fetch(
        `/api/billing/portal?yearId=${encodeURIComponent(String(yearId))}`,
        { method: "POST" }
      );
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.url) {
        throw new Error(body?.error ?? `Portal open failed (${res.status})`);
      }
      window.location.href = body.url;
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't open the billing portal."
      );
      setOpening(false);
    }
  }

  return (
    <Card className="overflow-hidden gap-0 py-0 bg-white">
      <CardHeader className="py-3 !pb-3 border-b">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle className="text-base">Billing</CardTitle>
          <Button
            size="sm"
            variant="outline"
            className="bg-white"
            disabled={opening}
            onClick={openPortal}
          >
            {opening ? (
              <Loader2 className="size-3.5 mr-1.5 animate-spin" aria-hidden="true" />
            ) : (
              <CreditCard className="size-3.5 mr-1.5" aria-hidden="true" />
            )}
            Manage billing & autopay
          </Button>
        </div>
      </CardHeader>
      <CardContent className="px-4 py-4 bg-white">
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <SummaryStat
            label="Monthly amount"
            value={monthlyDollars != null ? formatUsd(monthlyDollars) : "—"}
          />
          <SummaryStat
            label="Year total"
            value={yearTotalDollars != null ? formatUsd(yearTotalDollars) : "—"}
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
          First invoice:{" "}
          <span className="font-medium text-foreground">{billingStartLabel}</span>
          {" · "}
          You&rsquo;ll receive each invoice by email from Stripe; click
          <strong> Manage billing &amp; autopay</strong> to save a card and
          turn on automatic payment.
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

function BillingScheduleCard({ slots }: { slots: ParentScheduleSlot[] }) {
  return (
    <Card className="overflow-hidden gap-0 py-0 bg-white">
      <CardHeader className="py-3 !pb-3 border-b">
        <CardTitle className="text-base">Monthly invoices</CardTitle>
      </CardHeader>
      <CardContent className="px-3 pb-3 bg-white">
        {/* Three columns so the table fits a phone with no horizontal
            scroll — month (with due date + amount tucked underneath),
            paid/unpaid status, and the link to view or pay. */}
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="text-[10px] text-muted-foreground w-[44%]">
                Month
              </TableHead>
              <TableHead className="text-[10px] text-muted-foreground w-[28%]">
                Status
              </TableHead>
              <TableHead className="text-[10px] text-muted-foreground w-[28%] text-right">
                Invoice
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {slots.map((slot) => (
              <BillingScheduleRow key={slot.slotIndex} slot={slot} />
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function BillingScheduleRow({ slot }: { slot: ParentScheduleSlot }) {
  const inv = slot.invoice;
  const dueLabel = inv?.dueDate ? formatBillingDate2(inv.dueDate) : null;
  const sentLabel = inv?.finalizedAt
    ? formatBillingDate2(inv.finalizedAt)
    : null;
  const amountDue = inv ? inv.amountDueCents / 100 : null;
  // One compact sub-line under the month replaces the old Sent / Due /
  // Amount columns.
  const subParts = [
    dueLabel ? `Due ${dueLabel}` : sentLabel ? `Sent ${sentLabel}` : null,
    amountDue != null ? formatUsd(amountDue) : null,
  ].filter(Boolean);
  return (
    <TableRow className={cn(slot.status === "not_started" && "opacity-70")}>
      <TableCell className="font-medium whitespace-normal">
        {slot.monthLabel}
        {subParts.length > 0 ? (
          <span className="mt-0.5 block text-xs font-normal text-muted-foreground tabular-nums">
            {subParts.join(" · ")}
          </span>
        ) : null}
      </TableCell>
      <TableCell>
        <ScheduleStatusPill status={slot.status} />
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
            View / pay
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

function ScheduleStatusPill({ status }: { status: ParentScheduleSlot["status"] }) {
  const config = (() => {
    switch (status) {
      case "paid":
        return {
          label: "Paid",
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

function formatUsd(dollars: number): string {
  return `$${dollars.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Format a YYYY-MM-DD billing date as a long string (UTC). */
function formatBillingDate(iso: string): string {
  const ms = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(ms)) return iso;
  return new Date(ms).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Format a unix-ms timestamp as a short date for the table cells. */
function formatBillingDate2(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}


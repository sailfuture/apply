"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import {
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle,
  ChevronRight,
  ClipboardList,
  FileText,
  GraduationCap,
  LogOut,
  MessageSquare,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { StatsCard } from "@/components/admin/stats-card";
import {
  TrendAreaChart,
  TrendBarChart,
} from "@/components/admin/trend-charts";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { DashboardTrendsResponse } from "@/app/api/admin/dashboard-trends/route";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { adminFetcher as fetcher } from "@/lib/admin-fetcher";

/**
 * Admin dashboard — year-scoped overview of the admissions lifecycle.
 *
 * Two top-level sections:
 *   1. Stat tiles — inquiry / application / accepted counts plus
 *      year-scoped enrollment + withdrawal totals (new).
 *   2. Tables:
 *      - "Ready for Action" — applications submitted but not yet
 *        accepted + registrations submitted but not yet verified.
 *        Both feed off existing endpoints; the dashboard just
 *        filters + truncates each list to the rows admin actually
 *        needs to act on today.
 *      - "Enrolled Students" — every student officially enrolled
 *        for the selected year. Mirrors the /admin/enrolled list's
 *        Enrolled section but compact (no grade groups, top 10
 *        rows, click to drill).
 *
 * Year context comes from the top nav's `?yearId=X` query string.
 * Counts default to `0` and tables to empty arrays when stats fail
 * — the page chrome always renders so admin sees the year context
 * + sub-table headers regardless.
 */

interface StatsResponse {
  inquiries: { total: number; recent: number };
  applications: {
    total: number;
    draft: number;
    submitted: number;
    offered: number;
    accepted: number;
    denied: number;
  };
  registrations: { total: number; completed: number; inProgress: number };
  students: { total: number };
  /** Year-scoped enrollment lifecycle counts. Added to the stats
   *  endpoint alongside this dashboard redesign. */
  enrollment?: { enrolled: number; withdrawn: number };
}

/** Row shape from `/api/admin/applications` — one per family per
 *  year. We only need the few fields used by the Action Needed
 *  table here; importing the full type from the route would pull
 *  the admin-auth chain into the client bundle. */
interface ApplicationRow {
  id: number;
  family_id: number;
  year_id: number;
  family_name: string;
  primary_name: string;
  primary_email: string;
  student_count: number;
  student_names?: string;
  flow_type?: "apply" | "reapply";
  isSubmitted: boolean;
  isAccepted: boolean;
  is_archived?: boolean;
  submitted_at: number | null;
  last_edited: number | null;
}

interface RegistrationRow {
  id: number;
  application_id: number;
  student_id: number;
  family_id: number;
  year_id: number;
  student_full_name: string;
  student_grade: string;
  family_name: string;
  primary_email: string;
  registration_submitted: boolean;
  registration_submitted_date: number | null;
  is_registration_confirmed: boolean;
  last_edited: number | null;
}

interface EnrolledRow {
  id: number;
  student_id: number;
  family_id: number;
  year_id: number;
  student_full_name: string;
  student_grade: string;
  family_name: string;
  primary_email: string;
  confirmed_at: number;
  is_enrolled?: boolean;
}

interface SchoolYearRow {
  id: number;
  year_name: string;
}

export default function AdminDashboardPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const yearId = searchParams.get("yearId");
  const yearIdNum = yearId ? Number(yearId) : null;

  const {
    data: stats,
    isLoading: statsLoading,
    error: statsError,
  } = useSWR<StatsResponse>(
    yearId ? `/api/admin/stats?yearId=${yearId}` : `/api/admin/stats`,
    fetcher
  );

  const { data: applications } = useSWR<ApplicationRow[]>(
    yearId ? `/api/admin/applications?yearId=${yearId}` : null,
    fetcher
  );
  const { data: registrations } = useSWR<RegistrationRow[]>(
    yearId ? `/api/admin/registrations?yearId=${yearId}` : null,
    fetcher
  );
  const { data: enrolled } = useSWR<EnrolledRow[]>(
    yearId ? `/api/admin/enrolled?yearId=${yearId}` : null,
    fetcher
  );
  const { data: schoolYears } = useSWR<SchoolYearRow[]>(
    "/api/admin/school-years",
    fetcher
  );
  // 30-day trend series for the two charts. Year-scoped for
  // enrollment; inquiries have no year column so they're global.
  const { data: trends, isLoading: trendsLoading } =
    useSWR<DashboardTrendsResponse>(
      yearId
        ? `/api/admin/dashboard-trends?yearId=${yearId}`
        : "/api/admin/dashboard-trends",
      fetcher
    );

  const yearName = useMemo(() => {
    if (!yearIdNum || !schoolYears) return null;
    return (
      schoolYears.find((y) => y.id === yearIdNum)?.year_name ?? null
    );
  }, [yearIdNum, schoolYears]);

  // Action-needed: applications submitted + not accepted + not
  // archived. Same filter the Applications list uses for its
  // "Submitted" bucket, surfaced here so admin can see what's
  // waiting on their decision without leaving the dashboard.
  // Computed up here (before the early-return below) so hooks
  // ordering stays stable across renders — calling useMemo after
  // a conditional return would trip rules-of-hooks.
  const actionApps = useMemo(() => {
    if (!applications) return [];
    return applications
      .filter(
        (a) =>
          a.isSubmitted === true &&
          a.isAccepted !== true &&
          a.is_archived !== true
      )
      .sort((a, b) => {
        const aT = a.submitted_at ?? a.last_edited ?? 0;
        const bT = b.submitted_at ?? b.last_edited ?? 0;
        return bT - aT;
      });
  }, [applications]);

  // Action-needed: registrations submitted by the family but not yet
  // family-level "registration confirmed" by admin. This is the queue
  // for admin's per-family registration review.
  const actionRegistrations = useMemo(() => {
    if (!registrations) return [];
    return registrations
      .filter(
        (r) =>
          r.registration_submitted === true &&
          r.is_registration_confirmed !== true
      )
      .sort((a, b) => {
        const aT = a.registration_submitted_date ?? a.last_edited ?? 0;
        const bT = b.registration_submitted_date ?? b.last_edited ?? 0;
        return bT - aT;
      });
  }, [registrations]);

  // Enrolled-only slice for the bottom table. The /api/admin/enrolled
  // endpoint now returns enrolled + not-enrolled rows side-by-side
  // (with the `is_enrolled` flag) so we filter client-side to the
  // enrolled cohort. Newest enrolled first.
  const enrolledRows = useMemo(() => {
    if (!enrolled) return [];
    return enrolled
      .filter((r) => r.is_enrolled === true)
      .sort((a, b) => (b.confirmed_at ?? 0) - (a.confirmed_at ?? 0));
  }, [enrolled]);

  // Loading skeleton only on the first paint — once stats land we
  // render the chrome + per-card error states. Returning the
  // skeleton on every error would lock the page in a loading state.
  if (statsLoading && !stats && !statsError) {
    return (
      <div className="space-y-6 p-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-lg" />
        <Skeleton className="h-64 rounded-lg" />
      </div>
    );
  }

  const safeStats: StatsResponse = stats ?? {
    inquiries: { total: 0, recent: 0 },
    applications: {
      total: 0,
      draft: 0,
      submitted: 0,
      offered: 0,
      accepted: 0,
      denied: 0,
    },
    registrations: { total: 0, completed: 0, inProgress: 0 },
    students: { total: 0 },
    enrollment: { enrolled: 0, withdrawn: 0 },
  };
  const enrolledCount = safeStats.enrollment?.enrolled ?? 0;
  const withdrawnCount = safeStats.enrollment?.withdrawn ?? 0;

  // Truncate each table to a manageable preview length on the
  // dashboard. The full list pages handle the long-tail.
  const ACTION_LIMIT = 8;
  const ENROLLED_LIMIT = 10;

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {yearName ? (
            <>
              {yearName} school year overview. Use the year picker above
              to switch between cohorts.
            </>
          ) : (
            <>
              Pick a school year above to see year-scoped admissions
              activity.
            </>
          )}
        </p>
      </div>

      {statsError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Stats failed to load:{" "}
          {statsError instanceof Error ? statsError.message : "unknown error"}
          . Counts below default to 0 until the next refresh.
        </div>
      ) : null}

      {/* Five stat tiles in a single row on wide viewports. Two
          enrollment-lifecycle tiles (Enrolled / Withdrawn) sit beside
          the funnel tiles so admin sees both the intake and the
          steady-state cohort at a glance. */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatsCard
          title="Inquiries"
          value={safeStats.inquiries.total}
          icon={<MessageSquare className="size-5" />}
          description={`${safeStats.inquiries.recent} this month`}
        />
        <StatsCard
          title="Applications"
          value={safeStats.applications.submitted}
          icon={<FileText className="size-5" />}
          description={`${safeStats.applications.draft} drafts, ${safeStats.applications.total} total`}
        />
        <StatsCard
          title="Accepted"
          value={safeStats.applications.accepted}
          icon={<CheckCircle className="size-5" />}
          description={`${safeStats.applications.offered} offered`}
        />
        {/* Enrollments / Withdrawals are per-year — joined to the
            applications list so a student "belongs to" the year via
            their app, then their student-row `isEnrolled` /
            `isArchived` flags drive the buckets. */}
        <StatsCard
          title="Enrolled"
          value={enrolledCount}
          icon={<GraduationCap className="size-5" />}
          description={
            yearName ? `For ${yearName}` : "Pick a year for context"
          }
        />
        <StatsCard
          title="Withdrawn"
          value={withdrawnCount}
          icon={<LogOut className="size-5" />}
          description={
            withdrawnCount === 1 ? "1 student" : `${withdrawnCount} students`
          }
        />
      </div>

      {/* 30-day trends. Two separate charts (never a dual axis):
          inquiries are per-day counts, the roster is a running total,
          so they're different measures on different scales. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <TrendCard
          title="Inquiries"
          subtitle="New inquiries per day · last 30 days"
          value={trends?.inquiries.total ?? 0}
          valueLabel="in the last 30 days"
          delta={
            trends
              ? trends.inquiries.total - trends.inquiries.previousTotal
              : null
          }
          deltaLabel="vs the prior 30 days"
          loading={trendsLoading && !trends}
        >
          {trends ? (
            <TrendBarChart
              days={trends.days}
              values={trends.inquiries.daily}
              color={INQUIRY_COLOR}
              unitLabel="inquiries"
            />
          ) : null}
        </TrendCard>

        <TrendCard
          title="Enrolled students"
          subtitle={`Roster size · last 30 days${yearName ? ` · ${yearName}` : ""}`}
          value={trends?.enrollment.current ?? 0}
          valueLabel="enrolled today"
          delta={trends ? trends.enrollment.addedInWindow : null}
          deltaLabel="newly enrolled in this window"
          loading={trendsLoading && !trends}
        >
          {trends ? (
            <TrendAreaChart
              days={trends.days}
              values={trends.enrollment.cumulative}
              color={ENROLLED_COLOR}
              unitLabel="enrolled"
            />
          ) : null}
        </TrendCard>
      </div>

      {/* Year-required notice — both subsequent tables need a year
          to mean anything. Sits between the stat tiles (which work
          un-scoped) and the tables to make the requirement obvious. */}
      {!yearId ? (
        <div className="rounded-lg border bg-white px-6 py-8 text-center text-sm text-muted-foreground">
          Select a school year above to see action items + the
          enrolled roster.
        </div>
      ) : null}

      {yearId ? (
        <>
          {/* Ready for Action — single card stacking the two queues
              admin actually decides on. Applications waiting for the
              Approve button + registrations waiting for the Confirm
              Registration button. Newest-first within each block. */}
          <Card className="overflow-hidden bg-white py-0 gap-0">
            <CardHeader className="py-4 border-b bg-white">
              <div className="flex items-baseline gap-3">
                <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  Ready for Action
                </CardTitle>
                <span className="text-xs tabular-nums text-muted-foreground">
                  ({actionApps.length + actionRegistrations.length})
                </span>
              </div>
            </CardHeader>
            <CardContent className="px-3 pb-3 bg-white">
              <ActionAppTable
                rows={actionApps.slice(0, ACTION_LIMIT)}
                totalRows={actionApps.length}
                onRowClick={(row) =>
                  router.push(
                    `/admin/families/${row.family_id}?yearId=${row.year_id}`
                  )
                }
              />
              <ActionRegistrationTable
                rows={actionRegistrations.slice(0, ACTION_LIMIT)}
                totalRows={actionRegistrations.length}
                onRowClick={(row) =>
                  router.push(
                    `/admin/registrations/${row.family_id}?yearId=${row.year_id}`
                  )
                }
              />
            </CardContent>
          </Card>

          {/* Enrolled students — compact preview of the enrolled
              roster for the year. Top 10 rows newest-first, with a
              link to the full /admin/enrolled list when there are
              more. */}
          <Card className="overflow-hidden bg-white py-0 gap-0">
            <CardHeader className="py-4 border-b bg-white">
              <div className="flex items-baseline justify-between gap-3">
                <div className="flex items-baseline gap-3">
                  <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                    Enrolled Students
                  </CardTitle>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    ({enrolledRows.length})
                  </span>
                </div>
                {enrolledRows.length > ENROLLED_LIMIT ? (
                  <Link
                    href={`/admin/enrolled?yearId=${yearId}`}
                    className="text-xs text-primary hover:underline"
                  >
                    View all {enrolledRows.length}
                  </Link>
                ) : null}
              </div>
            </CardHeader>
            <CardContent className="px-3 pb-3 bg-white">
              <EnrolledTable
                rows={enrolledRows.slice(0, ENROLLED_LIMIT)}
                onRowClick={(row) =>
                  router.push(
                    `/admin/enrolled/${row.student_id}?yearId=${row.year_id}`
                  )
                }
              />
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}

/* ─────────────────────── Trend cards ─────────────────────── */

/** Series colors, validated against the white card surface: both
 *  clear 3:1 contrast and sit ΔE 26.5 apart under CVD simulation. */
const INQUIRY_COLOR = "#2a78d6";
const ENROLLED_COLOR = "#008300";

/**
 * Chart card — a period figure with a delta chip above the plot.
 * Single series per card, so no legend: the title names what's
 * plotted. The figure uses proportional (not tabular) numerals since
 * it's a standalone value, not a column.
 */
function TrendCard({
  title,
  subtitle,
  value,
  valueLabel,
  delta,
  deltaLabel,
  loading,
  children,
}: {
  title: string;
  subtitle: string;
  value: number;
  valueLabel: string;
  /** Signed change vs the comparison period; null while loading. */
  delta: number | null;
  deltaLabel: string;
  loading: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card className="overflow-hidden bg-white py-0 gap-0">
      <CardHeader className="py-4 border-b bg-white">
        <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </CardTitle>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-3xl font-semibold leading-none">
            {loading ? "—" : value.toLocaleString()}
          </span>
          <span className="text-xs text-muted-foreground">{valueLabel}</span>
          {delta !== null && !loading ? (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                delta > 0
                  ? "bg-green-50 text-green-700"
                  : delta < 0
                    ? "bg-red-50 text-red-700"
                    : "bg-muted text-muted-foreground"
              )}
            >
              {delta > 0 ? (
                <ArrowUpRight className="size-3" />
              ) : delta < 0 ? (
                <ArrowDownRight className="size-3" />
              ) : null}
              {delta > 0 ? "+" : ""}
              {delta.toLocaleString()}
              <span className="font-normal opacity-80">{deltaLabel}</span>
            </span>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="px-2 py-3 bg-white">
        {loading ? (
          <Skeleton className="h-[190px] w-full rounded-md" />
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}

/* ─────────────────────── Action tables ─────────────────────── */

function ActionAppTable({
  rows,
  totalRows,
  onRowClick,
}: {
  rows: ApplicationRow[];
  totalRows: number;
  onRowClick: (row: ApplicationRow) => void;
}) {
  return (
    <div className="border-b last:border-b-0">
      <div className="px-4 py-2 bg-muted/30 border-b flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Applications awaiting acceptance
        </p>
        <span className="text-[10px] tabular-nums text-muted-foreground">
          {rows.length === totalRows
            ? `${totalRows}`
            : `${rows.length} of ${totalRows}`}
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-sm italic text-center text-muted-foreground">
          No submitted applications waiting on a decision.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="text-[10px] uppercase tracking-wider text-muted-foreground w-[28%]">
                Family
              </TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider text-muted-foreground w-[28%]">
                Students
              </TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider text-muted-foreground w-[28%]">
                Contact
              </TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider text-muted-foreground w-[16%]">
                Submitted
              </TableHead>
              <TableHead className="w-[40px] text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow
                key={row.id}
                onClick={() => onRowClick(row)}
                className="cursor-pointer"
              >
                <TableCell className="text-sm font-medium">
                  {row.family_name}
                  {row.flow_type === "reapply" ? (
                    <span className="ml-1.5 inline-flex items-center rounded-full bg-blue-50 text-blue-700 ring-1 ring-blue-200 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide">
                      Re-enrolling
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  <span className="block truncate" title={row.student_names ?? ""}>
                    {row.student_names ||
                      `${row.student_count} student${row.student_count === 1 ? "" : "s"}`}
                  </span>
                </TableCell>
                <TableCell className="text-sm">
                  <span className="block truncate">
                    {row.primary_email || row.primary_name || "—"}
                  </span>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground tabular-nums">
                  {formatRelativeShort(row.submitted_at ?? row.last_edited)}
                </TableCell>
                <TableCell className="text-right">
                  <ChevronRight className="size-4 text-muted-foreground inline" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function ActionRegistrationTable({
  rows,
  totalRows,
  onRowClick,
}: {
  rows: RegistrationRow[];
  totalRows: number;
  onRowClick: (row: RegistrationRow) => void;
}) {
  return (
    <div>
      <div className="px-4 py-2 bg-muted/30 border-b flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Registrations awaiting verification
        </p>
        <span className="text-[10px] tabular-nums text-muted-foreground">
          {rows.length === totalRows
            ? `${totalRows}`
            : `${rows.length} of ${totalRows}`}
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-sm italic text-center text-muted-foreground">
          No submitted registrations waiting on admin verification.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="text-[10px] uppercase tracking-wider text-muted-foreground w-[24%]">
                Family
              </TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider text-muted-foreground w-[24%]">
                Student
              </TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider text-muted-foreground w-[8%]">
                Grade
              </TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider text-muted-foreground w-[28%]">
                Contact
              </TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider text-muted-foreground w-[16%]">
                Submitted
              </TableHead>
              <TableHead className="w-[40px] text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow
                key={row.id}
                onClick={() => onRowClick(row)}
                className="cursor-pointer"
              >
                <TableCell className="text-sm font-medium">
                  {row.family_name}
                </TableCell>
                <TableCell className="text-sm">
                  {row.student_full_name}
                </TableCell>
                <TableCell>
                  <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    {row.student_grade?.trim() || "—"}
                  </span>
                </TableCell>
                <TableCell className="text-sm">
                  <span className="block truncate">
                    {row.primary_email || "—"}
                  </span>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground tabular-nums">
                  {formatRelativeShort(
                    row.registration_submitted_date ?? row.last_edited
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <ChevronRight className="size-4 text-muted-foreground inline" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function EnrolledTable({
  rows,
  onRowClick,
}: {
  rows: EnrolledRow[];
  onRowClick: (row: EnrolledRow) => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="px-6 py-10 text-center">
        <ClipboardList className="mx-auto size-6 text-muted-foreground mb-2" />
        <p className="text-sm font-medium">No enrolled students yet</p>
        <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
          A student appears here once their registration packet is
          confirmed on the Registrations page.
        </p>
      </div>
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="text-[10px] uppercase tracking-wider text-muted-foreground w-[26%]">
            Student
          </TableHead>
          <TableHead className="text-[10px] uppercase tracking-wider text-muted-foreground w-[8%]">
            Grade
          </TableHead>
          <TableHead className="text-[10px] uppercase tracking-wider text-muted-foreground w-[22%]">
            Family
          </TableHead>
          <TableHead className="text-[10px] uppercase tracking-wider text-muted-foreground w-[28%]">
            Contact
          </TableHead>
          <TableHead className="text-[10px] uppercase tracking-wider text-muted-foreground w-[12%]">
            Enrolled
          </TableHead>
          <TableHead className="w-[40px] text-right" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow
            key={row.id}
            onClick={() => onRowClick(row)}
            className="cursor-pointer"
          >
            <TableCell className="text-sm font-medium">
              {row.student_full_name}
            </TableCell>
            <TableCell>
              <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                {row.student_grade?.trim() || "—"}
              </span>
            </TableCell>
            <TableCell className="text-sm">{row.family_name}</TableCell>
            <TableCell className="text-sm">
              <span className="block truncate">
                {row.primary_email || "—"}
              </span>
            </TableCell>
            <TableCell className="text-sm text-muted-foreground tabular-nums">
              {formatRelativeShort(row.confirmed_at)}
            </TableCell>
            <TableCell className="text-right">
              <ChevronRight className="size-4 text-muted-foreground inline" />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/* ─────────────────────── Helpers ─────────────────────── */

/** Short relative time — "5m", "2h", "3d", or a date for older entries.
 *  Inlined here rather than imported because the dashboard's relative
 *  format leans toward terseness (single-letter unit + bare number)
 *  whereas the shared `formatRelativeShort` in lib/format-note-time
 *  spells the unit out. Hover title gets the absolute timestamp via
 *  the caller. */
function formatRelativeShort(ts: number | null | undefined): string {
  if (!ts) return "—";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d`;
  return new Date(ts).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

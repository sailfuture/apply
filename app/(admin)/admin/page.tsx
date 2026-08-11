"use client";

import { useMemo, useState } from "react";

import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarDays,
  CheckCircle,
  FileText,
  GraduationCap,
  MessageSquare,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { StatsCard } from "@/components/admin/stats-card";
import { DashboardSearch } from "@/components/admin/dashboard-search";
import { LeadSheet } from "@/components/admin/lead-sheet";
import type { AllLeadRow } from "@/app/api/admin/all-leads/route";
import {
  TrendAreaChart,
  TrendBarChart,
} from "@/components/admin/trend-charts";
import {
  LeadActivityCard,
  UnreadMessagesCard,
} from "@/components/admin/dashboard-cards";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { adminFetcher as fetcher } from "@/lib/admin-fetcher";
import type { DashboardTrendsResponse } from "@/app/api/admin/dashboard-trends/route";
import type { UnreadMessagesResponse } from "@/app/api/admin/messages/unread/route";
import type { LeadActivityResponse } from "@/app/api/admin/lead-activity/route";

/** Chart window options — mirrors TREND_WINDOW_OPTIONS on the trends
 *  route (duplicated rather than imported so the server module and
 *  its Xano client stay out of the browser bundle). */
const TREND_WINDOWS = [7, 14, 30, 60, 90];

/**
 * Admin dashboard — what's moving, and what's waiting on you.
 *
 * Top to bottom:
 *   1. Stat tiles — the recruitment funnel: inquiries, inquiry →
 *      application conversions, campus tours, completed applications,
 *      students accepted, students enrolled.
 *   2. Trends — new inquiries per day and roster size, over a
 *      selectable window (one control drives both charts so they stay
 *      directly comparable).
 *   3. "Needs a reply" — text threads whose newest message is
 *      inbound.
 *   4. "Recent lead activity" — notes + texts across every
 *      recruitment lead, newest first.
 *
 * The old "Ready for Action" and "Enrolled Students" tables were
 * dropped from here (2026-08-04): both duplicate their own list pages,
 * and neither is as time-sensitive as an unanswered parent. The
 * queues still live at /admin/applications and /admin/registrations.
 *
 * Year context comes from the top nav's `?yearId=X` query string.
 * Counts default to `0` when stats fail so the page chrome always
 * renders.
 */

interface StatsResponse {
  inquiries: {
    total: number;
    recent: number;
    /** Inquiries that became an applying family — the conversion link
     *  (`registration_families_id` on the inquiry row) plus legacy
     *  rows hand-marked `status: "converted"`. */
    converted?: number;
  };
  /** Campus tours from `registration_tours` — global (the table has
   *  no year column), blank wiring rows excluded. `scheduled` is
   *  date-based upcoming: still-scheduled AND in the future. */
  tours?: { total: number; completed: number; scheduled: number };
  /** Family-level application pipeline (progress rows, archived
   *  excluded) — the Apps tile, matching /admin/applications. */
  families?: { accepted: number; submitted: number; inProgress: number };
  applications: {
    total: number;
  };
  registrations: { total: number; completed: number; inProgress: number };
  students: { total: number };
  /** Year-scoped enrollment lifecycle counts. Added to the stats
   *  endpoint alongside this dashboard redesign. */
  enrollment?: { enrolled: number; withdrawn: number };
}

interface SchoolYearRow {
  id: number;
  year_name: string;
}

export default function AdminDashboardPage() {
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

  const { data: schoolYears } = useSWR<SchoolYearRow[]>(
    "/api/admin/school-years",
    fetcher
  );

  // Chart window, selectable. `keepPreviousData` below means changing
  // it re-renders the charts with the old series until the new one
  // lands, instead of flashing an empty card.
  const [windowDays, setWindowDays] = useState(30);

  // Trend series for the two charts. Year-scoped for enrollment;
  // inquiries have no year column so they're global.
  const { data: trends, isLoading: trendsLoading } =
    useSWR<DashboardTrendsResponse>(
      `/api/admin/dashboard-trends?days=${windowDays}${
        yearId ? `&yearId=${yearId}` : ""
      }`,
      fetcher,
      { keepPreviousData: true }
    );

  // Threads whose newest message is inbound — what needs a reply.
  const { data: unread, isLoading: unreadLoading } =
    useSWR<UnreadMessagesResponse>(
      "/api/admin/messages/unread",
      fetcher,
      { refreshInterval: 60_000 }
    );

  // Newest notes + texts across every recruitment lead.
  const { data: activity, isLoading: activityLoading, mutate: mutateActivity } =
    useSWR<LeadActivityResponse>(
      "/api/admin/lead-activity?limit=25",
      fetcher,
      { refreshInterval: 60_000 }
    );

  // Latest inquiry submissions for the Recent-inquiries table — same
  // feed the Inquiries page uses; archived rows (parked duplicates)
  // excluded, newest first.
  const { data: inquiriesData, isLoading: inquiriesLoading } = useSWR<
    RecentInquiryRow[]
  >("/api/admin/inquiries", fetcher, { refreshInterval: 60_000 });
  const recentInquiries = useMemo(
    () =>
      (Array.isArray(inquiriesData) ? inquiriesData : [])
        .filter((r) => (r.status ?? "").trim() !== "archived")
        .sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))
        .slice(0, 8),
    [inquiriesData]
  );

  // Clicking an activity row opens the lead's triage sheet IN PLACE
  // (no page navigation) — same lazy pattern the Messages page uses:
  // the all-leads fetch only fires once a lead is actually opened.
  const [selectedLead, setSelectedLead] = useState<{
    source: AllLeadRow["source"];
    id: number;
  } | null>(null);

  const yearName = useMemo(() => {
    if (!yearIdNum || !schoolYears) return null;
    return (
      schoolYears.find((y) => y.id === yearIdNum)?.year_name ?? null
    );
  }, [yearIdNum, schoolYears]);

  // Loading skeleton only on the first paint — once stats land we
  // render the chrome + per-card error states. Returning the
  // skeleton on every error would lock the page in a loading state.
  if (statsLoading && !stats && !statsError) {
    return (
      <div className="space-y-6 p-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-lg" />
        <Skeleton className="h-64 rounded-lg" />
      </div>
    );
  }

  const safeStats: StatsResponse = stats ?? {
    inquiries: { total: 0, recent: 0, converted: 0 },
    tours: { total: 0, completed: 0, scheduled: 0 },
    families: { accepted: 0, submitted: 0, inProgress: 0 },
    applications: {
      total: 0,
    },
    registrations: { total: 0, completed: 0, inProgress: 0 },
    students: { total: 0 },
    enrollment: { enrolled: 0, withdrawn: 0 },
  };
  const enrolledCount = safeStats.enrollment?.enrolled ?? 0;
  const convertedCount = safeStats.inquiries.converted ?? 0;
  const tourStats = safeStats.tours ?? {
    total: 0,
    completed: 0,
    scheduled: 0,
  };
  const familyStats = safeStats.families ?? {
    accepted: 0,
    submitted: 0,
    inProgress: 0,
  };
  // Conversion rate reads better than a bare count next to the
  // Inquiries tile; guard the division for an empty pipeline.
  const conversionPct =
    safeStats.inquiries.total > 0
      ? Math.round((convertedCount / safeStats.inquiries.total) * 100)
      : 0;

  // Truncate each table to a manageable preview length on the
  // dashboard. The full list pages handle the long-tail.

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

      {/* Quick search — find any student, parent, or family and jump
          straight to their detail page. Sits above the funnel tiles
          because "pull up this person" is the most common reason to
          land on the dashboard mid-task. */}
      <DashboardSearch />

      {statsError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Stats failed to load:{" "}
          {statsError instanceof Error ? statsError.message : "unknown error"}
          . Counts below default to 0 until the next refresh.
        </div>
      ) : null}

      {/* Six stat tiles — the recruitment-to-enrollment funnel read
          left to right: Inquiries → Conversions → Tours → Completed
          applications → Students accepted → Students enrolled.
          Inquiries / conversions / tours are global (no year column
          on those tables); the application and enrollment tiles scope
          to the year picker. */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatsCard
          title="Inquiries"
          value={safeStats.inquiries.total}
          icon={<MessageSquare className="size-5" />}
          description={`${safeStats.inquiries.recent} this month`}
          href="/admin/inquiries"
        />
        <StatsCard
          title="Conversions"
          value={convertedCount}
          icon={<TrendingUp className="size-5" />}
          description={`${conversionPct}% of inquiries applied`}
          href="/admin/all-leads"
        />
        <StatsCard
          title="Tours"
          value={tourStats.total}
          icon={<CalendarDays className="size-5" />}
          description={`${tourStats.completed} completed · ${tourStats.scheduled} upcoming`}
          href="/admin/campus-tours"
        />
        {/* Apps = the pipeline still MOVING: families that have
            started but not submitted, with the submitted count
            alongside. Accepted lives in its own tile next door, so
            it isn't repeated here. Same buckets the Applications
            page uses. */}
        <StatsCard
          title="Apps"
          value={familyStats.inProgress}
          icon={<FileText className="size-5" />}
          description={`in progress · ${familyStats.submitted} submitted`}
          href={yearId ? `/admin/applications?yearId=${yearId}` : "/admin/applications"}
        />
        {/* Accepted FAMILIES for the selected year, from the progress
            rows — the same bucket the Applications page counts. The
            old version counted per-application decision flags that
            never existed in Xano, so this tile showed 0 forever. */}
        <StatsCard
          title="Accepted"
          value={familyStats.accepted}
          icon={<CheckCircle className="size-5" />}
          description="families accepted"
          href={yearId ? `/admin/applications?yearId=${yearId}` : "/admin/applications"}
        />
        {/* Enrollment is per-year — joined to the applications list so
            a student "belongs to" the year via their app, then the
            student-row `isEnrolled` / `isArchived` flags decide. */}
        <StatsCard
          title="Enrolled"
          value={enrolledCount}
          icon={<GraduationCap className="size-5" />}
          description={
            yearName ? `For ${yearName}` : "Pick a year for context"
          }
          href={yearId ? `/admin/enrolled?yearId=${yearId}` : "/admin/enrolled"}
        />
      </div>

      {/* Trends. Two separate charts (never a dual axis): inquiries
          are per-day counts, the roster is a running total — different
          measures on different scales. One window control drives both
          so the two are always directly comparable. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Range
        </span>
        {TREND_WINDOWS.map((d) => {
          const on = windowDays === d;
          return (
            <button
              key={d}
              type="button"
              aria-pressed={on}
              onClick={() => setWindowDays(d)}
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
                on
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-white text-muted-foreground hover:border-foreground/40 hover:text-foreground"
              )}
            >
              {d} days
            </button>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <TrendCard
          title="Inquiries"
          subtitle={`New inquiries per day · last ${windowDays} days`}
          value={trends?.inquiries.total ?? 0}
          valueLabel={`in the last ${windowDays} days`}
          delta={
            trends
              ? trends.inquiries.total - trends.inquiries.previousTotal
              : null
          }
          deltaLabel={`vs the prior ${windowDays} days`}
          loading={trendsLoading}
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
          subtitle={`Roster size · last ${windowDays} days${yearName ? ` · ${yearName}` : ""}`}
          value={trends?.enrollment.current ?? 0}
          valueLabel="enrolled today"
          delta={trends ? trends.enrollment.addedInWindow : null}
          deltaLabel="newly enrolled in this window"
          loading={trendsLoading}
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

      {/* Latest inquiry submissions with when they landed — the "who
          just reached out" glance. Rows open the shared triage sheet. */}
      <RecentInquiriesCard
        rows={recentInquiries}
        loading={inquiriesLoading && !inquiriesData}
        onRowClick={(row) =>
          setSelectedLead({ source: "inquiry", id: row.id })
        }
      />

      {/* Unread messages — parents waiting on a reply. Replaces the
          old action queues: this is what is actually time-sensitive,
          and those queues already live on their own list pages. */}
      <UnreadMessagesCard
        rows={unread?.conversations ?? []}
        loading={unreadLoading && !unread}
      />

      {/* Recent activity across every recruitment lead — notes and
          texts merged, newest first. Answers what has happened
          lately and, by absence, who has gone quiet. */}
      <LeadActivityCard
        rows={activity?.rows ?? []}
        truncated={activity?.truncated ?? false}
        loading={activityLoading && !activity}
        onRowClick={(row) =>
          setSelectedLead({ source: row.source, id: row.leadId })
        }
      />

      {/* The clicked lead's triage sheet — the shared one, so a lead
          opened from here is identical to one opened from All Leads
          or its own source page. */}
      <LeadSheet
        lead={selectedLead}
        onOpenChange={(o) => !o && setSelectedLead(null)}
        onMissing={() => {
          toast.error("Couldn't find this lead's record.");
          setSelectedLead(null);
        }}
        onChanged={() => {
          // Ratings and notes written in the sheet show up in the
          // activity table too — keep it in step.
          void mutateActivity();
        }}
      />
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
  /** True whenever the CURRENT window's data isn't in yet — both the
   *  first load and every range-pill change (SWR's `isLoading` goes
   *  true again on a key change even with keepPreviousData). The
   *  figure shows "—" and the plot area skeletons. */
  loading: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card aria-busy={loading} className="overflow-hidden bg-white py-0 gap-0">
      <CardHeader className="py-4 border-b bg-white">
        <CardTitle className="text-sm font-semibold text-muted-foreground">
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


/* ─────────────────── Recent inquiries ─────────────────── */

/** Minimal slice of an inquiry row the dashboard table needs — the
 *  full shape lives with the Inquiries page. */
interface RecentInquiryRow {
  id: number;
  created_at: number;
  primary_first_name?: string;
  primary_last_name?: string;
  student_first_name?: string;
  student_last_name?: string;
  starting_grade?: string;
  current_grade?: string;
  isFollowedUp?: boolean;
  status?: string | null;
}

/** "just now" / "5m ago" / "3h ago" / "2d ago"; short date past two
 *  weeks. Absolute timestamp rides on the title attr. */
function relTime(ms: number | null | undefined): string {
  if (!ms) return "—";
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 14 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function RecentInquiriesCard({
  rows,
  loading,
  onRowClick,
}: {
  rows: RecentInquiryRow[];
  loading: boolean;
  onRowClick: (row: RecentInquiryRow) => void;
}) {
  return (
    <Card className="overflow-hidden bg-white py-0 gap-0">
      <CardHeader className="py-4 border-b bg-white">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">Recent inquiries</CardTitle>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Latest submissions from prospective families — click one to
              open its triage sheet.
            </p>
          </div>
          <a
            href="/admin/inquiries"
            className="shrink-0 text-xs font-medium text-primary underline-offset-2 hover:underline"
          >
            View all
          </a>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-muted-foreground">
            No inquiries yet.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 pl-4 font-medium">Parent</th>
                <th className="py-2 font-medium">Student</th>
                <th className="py-2 font-medium">Grade</th>
                <th className="py-2 font-medium">Status</th>
                <th className="py-2 pr-4 text-right font-medium">
                  Submitted
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => {
                const parent =
                  `${r.primary_first_name ?? ""} ${r.primary_last_name ?? ""}`.trim() ||
                  "—";
                const student =
                  `${r.student_first_name ?? ""} ${r.student_last_name ?? ""}`.trim() ||
                  "—";
                const status = (r.status ?? "").trim();
                return (
                  <tr
                    key={r.id}
                    onClick={() => onRowClick(r)}
                    className="cursor-pointer transition-colors hover:bg-muted/30"
                  >
                    <td className="py-2.5 pl-4 font-medium">{parent}</td>
                    <td className="py-2.5">{student}</td>
                    <td className="py-2.5 whitespace-nowrap">
                      {(r.starting_grade || r.current_grade || "—").trim()}
                    </td>
                    <td className="py-2.5">
                      {status === "converted" ? (
                        <span className="inline-flex rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 ring-1 ring-blue-200">
                          Converted
                        </span>
                      ) : status === "not_interested" ? (
                        <span className="inline-flex rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 ring-1 ring-red-200">
                          Not interested
                        </span>
                      ) : r.isFollowedUp ? (
                        <span className="inline-flex rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 ring-1 ring-green-200">
                          Followed up
                        </span>
                      ) : (
                        <span className="inline-flex rounded-full bg-yellow-50 px-2 py-0.5 text-xs font-medium text-yellow-800 ring-1 ring-yellow-200">
                          New
                        </span>
                      )}
                    </td>
                    <td
                      className="py-2.5 pr-4 text-right tabular-nums text-muted-foreground whitespace-nowrap"
                      title={new Date(r.created_at).toLocaleString()}
                    >
                      {relTime(r.created_at)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

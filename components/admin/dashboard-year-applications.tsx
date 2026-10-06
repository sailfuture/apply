"use client";

import Link from "next/link";
import useSWR from "swr";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { adminFetcher } from "@/lib/admin-fetcher";

/**
 * Dashboard section: the current school year's applications next to
 * the upcoming year's, side by side, regardless of the year picker.
 *
 * Families can apply for either year (join mid-year, or start next
 * fall), so recruitment runs on both at once — the picker-scoped stat
 * tiles only ever show one. Same feed and stage buckets as
 * /admin/applications, so counts here match that page.
 */

interface SchoolYearRow {
  id: number;
  year_name: string;
  isActive?: boolean;
  isNextYear?: boolean;
}

/** The slice of /api/admin/applications rows this section reads. */
interface ApplicationRow {
  family_id: number;
  year_id: number;
  flow_type: "apply" | "reapply";
  family_name: string;
  student_names: string;
  sections_complete: number;
  sections_total: number;
  isSubmitted: boolean;
  isAccepted: boolean;
  submitted_at: number | null;
  last_edited: number | null;
  is_archived: boolean;
}

type Stage = "accepted" | "submitted" | "in_progress" | "not_started";

/** Same precedence as the Applications page's `deriveFilter`. */
function stageOf(row: ApplicationRow): Stage {
  if (row.isAccepted) return "accepted";
  if (row.isSubmitted) return "submitted";
  if (row.sections_complete > 0) return "in_progress";
  return "not_started";
}

const STAGES: { key: Stage; label: string; pill: string }[] = [
  {
    key: "not_started",
    label: "Not started",
    pill: "bg-slate-100 text-slate-700",
  },
  {
    key: "in_progress",
    label: "In progress",
    pill: "bg-amber-100 text-amber-800",
  },
  { key: "submitted", label: "Submitted", pill: "bg-blue-100 text-blue-800" },
  {
    key: "accepted",
    label: "Accepted",
    pill: "bg-emerald-100 text-emerald-800",
  },
];
const STAGE_META = Object.fromEntries(STAGES.map((s) => [s.key, s])) as Record<
  Stage,
  (typeof STAGES)[number]
>;

/** Rows shown per card — the full list lives on the Applications page. */
const PREVIEW_ROWS = 8;

function relativeTime(ms: number | null): string {
  if (!ms) return "";
  const diff = Date.now() - ms;
  const day = 86_400_000;
  if (diff < 60 * 60_000) return "just now";
  if (diff < day) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 30 * day) return `${Math.floor(diff / day)}d ago`;
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function DashboardYearApplications() {
  const { data: years, isLoading } = useSWR<SchoolYearRow[]>(
    "/api/admin/school-years",
    adminFetcher
  );
  const list = Array.isArray(years) ? years : [];
  const current = list.find((y) => y.isActive) ?? null;
  const upcoming = list.find((y) => y.isNextYear) ?? null;

  if (isLoading) {
    return (
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-80 rounded-lg" />
        <Skeleton className="h-80 rounded-lg" />
      </div>
    );
  }
  if (!current && !upcoming) return null;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {current ? (
        <YearApplicationsCard
          year={current}
          kicker="Current year · mid-year enrollment"
        />
      ) : (
        <MissingYearCard what="current" />
      )}
      {upcoming ? (
        <YearApplicationsCard year={upcoming} kicker="Upcoming year" />
      ) : (
        <MissingYearCard what="upcoming" />
      )}
    </div>
  );
}

function MissingYearCard({ what }: { what: "current" | "upcoming" }) {
  return (
    <Card className="gap-0 py-0">
      <CardContent className="flex h-full min-h-40 items-center justify-center p-6 text-center text-sm text-muted-foreground">
        No school year is flagged as the {what} year. Set it in Operations →
        School Years.
      </CardContent>
    </Card>
  );
}

function YearApplicationsCard({
  year,
  kicker,
}: {
  year: SchoolYearRow;
  kicker: string;
}) {
  const { data, isLoading, error } = useSWR<ApplicationRow[]>(
    `/api/admin/applications?yearId=${year.id}`,
    adminFetcher,
    { refreshInterval: 60_000 }
  );
  const rows = (Array.isArray(data) ? data : []).filter((r) => !r.is_archived);
  const counts = STAGES.map((s) => ({
    ...s,
    count: rows.filter((r) => stageOf(r) === s.key).length,
  }));
  // Most recently touched first — what moved lately is what needs
  // attention.
  const recent = rows
    .slice()
    .sort(
      (a, b) =>
        (b.last_edited ?? b.submitted_at ?? 0) -
        (a.last_edited ?? a.submitted_at ?? 0)
    )
    .slice(0, PREVIEW_ROWS);
  const listHref = `/admin/applications?yearId=${year.id}`;

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <CardHeader className="border-b py-3 !pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">{kicker}</p>
            <CardTitle className="text-base">
              {year.year_name} applications
            </CardTitle>
          </div>
          <Link
            href={listHref}
            className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            View all <ArrowRight className="size-3" />
          </Link>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-4">
        <div className="grid grid-cols-4 gap-2">
          {counts.map((c) => (
            <Link
              key={c.key}
              href={listHref}
              className="rounded-md border px-2 py-2 text-center transition-colors hover:bg-muted/50"
            >
              <div className="text-xl font-semibold tabular-nums">
                {isLoading ? "–" : c.count}
              </div>
              <div className="text-[11px] leading-tight text-muted-foreground">
                {c.label}
              </div>
            </Link>
          ))}
        </div>

        {error ? (
          <p className="text-sm text-red-600">
            Couldn&rsquo;t load applications for {year.year_name}.
          </p>
        ) : isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 rounded-md" />
            ))}
          </div>
        ) : recent.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No applications for {year.year_name} yet.
          </p>
        ) : (
          <ul className="divide-y rounded-md border">
            {recent.map((r) => {
              const stage = STAGE_META[stageOf(r)];
              return (
                <li key={r.family_id}>
                  <Link
                    href={`/admin/families/${r.family_id}?yearId=${year.id}`}
                    className="flex items-center gap-3 px-3 py-2 transition-colors hover:bg-muted/50"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">
                          {r.family_name || `Family #${r.family_id}`}
                        </span>
                        {r.flow_type === "reapply" ? (
                          <span className="shrink-0 rounded-full border px-1.5 text-[10px] text-muted-foreground">
                            Re-enroll
                          </span>
                        ) : null}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {r.student_names || "No students yet"}
                        {stageOf(r) === "in_progress"
                          ? ` · ${r.sections_complete}/${r.sections_total} sections`
                          : ""}
                      </div>
                    </div>
                    <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                      {relativeTime(r.last_edited ?? r.submitted_at)}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
                        stage.pill
                      )}
                    >
                      {stage.label}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

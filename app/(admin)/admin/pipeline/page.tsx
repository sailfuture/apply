"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { ChevronRight, Search } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  StatusBadge,
  type ApplicationStatus,
} from "@/components/admin/status-badge";
import { PipelineExportDialog } from "@/components/admin/pipeline-export-dialog";
import { adminFetcher } from "@/lib/admin-fetcher";
import { cn } from "@/lib/utils";
import type {
  PipelineFamilyRow,
  PipelineStage,
} from "@/app/api/admin/pipeline/route";

/**
 * Admissions Pipeline — every family in the funnel for the selected
 * year, one full-height TABLE per stage stacked vertically
 * (Applications, then Registrations, then Enrollments — user request:
 * tables over the old three-column card board, every row visible with
 * no inner scroll). A family sits in exactly one stage: Applications
 * until admin accepts them, Registrations until admin confirms the
 * family registration, then Enrollments. Archived families are hidden
 * from the page (a footer notes how many) and always excluded from
 * the export.
 */

const STAGES: {
  key: PipelineStage;
  label: string;
  description: string;
}[] = [
  {
    key: "application",
    label: "Applications",
    description: "Applying — not yet accepted",
  },
  {
    key: "registration",
    label: "Registrations",
    description: "Accepted — completing registration",
  },
  {
    key: "enrollment",
    label: "Enrollments",
    description: "Registration confirmed",
  },
];

function badgeStatus(row: PipelineFamilyRow): ApplicationStatus {
  if (row.stage === "enrollment") return "enrolled";
  if (row.stage === "registration") return "accepted";
  return row.isSubmitted ? "submitted" : "draft";
}

/**
 * Application-column sub-state — finer than the shared status
 * vocabulary, which collapses "hasn't touched it" and "three sections
 * in" into one "Draft". On a board you work top-down that distinction
 * is the whole point, so it lives here rather than in STATUS_META:
 * "Draft" is a real status name elsewhere in admin (it matches Xano's
 * own), and renaming it globally would move ground under the
 * application tabs and filters.
 */
type AppProgress = "submitted" | "in_progress" | "not_started";

const APP_PROGRESS_META: Record<
  AppProgress,
  { label: string; className: string }
> = {
  submitted: {
    label: "Submitted",
    className: "bg-blue-50 text-blue-700 border-blue-200",
  },
  in_progress: {
    label: "In progress",
    className: "bg-yellow-50 text-yellow-700 border-yellow-200",
  },
  not_started: {
    label: "Not started",
    className: "bg-muted text-muted-foreground border-border",
  },
};

/** Board order: submitted first (they're waiting on us), then the
 *  ones underway, then the ones that haven't begun. */
const APP_PROGRESS_RANK: Record<AppProgress, number> = {
  submitted: 0,
  in_progress: 1,
  not_started: 2,
};

function appProgress(row: PipelineFamilyRow): AppProgress {
  if (row.isSubmitted) return "submitted";
  return row.app_sections_complete > 0 ? "in_progress" : "not_started";
}

function fmtDate(ms: number | null): string {
  if (!ms) return "";
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString();
}

function cardMeta(row: PipelineFamilyRow): string {
  if (row.stage === "enrollment") {
    const when = fmtDate(row.registration_confirmed_time);
    return when ? `Confirmed ${when}` : "Registration confirmed";
  }
  if (row.stage === "registration") {
    if (row.reg_submitted) {
      const when = fmtDate(row.reg_submitted_date);
      return when ? `Submitted ${when}` : "Registration submitted";
    }
    return `Registration ${row.reg_sections_complete}/${row.reg_sections_total} sections`;
  }
  if (row.isSubmitted) {
    const when = fmtDate(row.submitted_at);
    return when ? `Submitted ${when}` : "Submitted";
  }
  return `Application ${row.app_sections_complete}/${row.app_sections_total} sections`;
}

/** Same pill shape as StatusBadge — this column just has its own
 *  three-state vocabulary. */
function AppProgressBadge({ progress }: { progress: AppProgress }) {
  const meta = APP_PROGRESS_META[progress];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        meta.className
      )}
    >
      {meta.label}
    </span>
  );
}

/**
 * One stage of the funnel as a full-height table card — every row
 * renders (no inner scroll), so the page grows as long as the funnel.
 * Row click opens the family's admin detail page for the year.
 */
function PipelineStageTable({
  stage,
  rows,
  onOpen,
}: {
  stage: (typeof STAGES)[number];
  rows: PipelineFamilyRow[];
  onOpen: (row: PipelineFamilyRow) => void;
}) {
  // Students, not family rows — a residential family of 21 counting
  // as "1" made the header read as a fraction of the actual funnel.
  const studentCount = rows.reduce(
    (n, r) => n + (Number(r.student_count) || 0),
    0
  );
  return (
    <Card className="overflow-hidden bg-white py-0 gap-0">
      <CardHeader className="border-b bg-white py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-baseline gap-3">
            <p className="text-sm font-semibold text-muted-foreground">
              {stage.label}
            </p>
            <p className="text-xs text-muted-foreground/70">
              {stage.description}
            </p>
          </div>
          <span
            className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium"
            // The rows below are families, so spell out what the
            // number counts rather than leaving the mismatch to be
            // worked out.
            title={`${studentCount} student${
              studentCount === 1 ? "" : "s"
            } across ${rows.length} famil${
              rows.length === 1 ? "y" : "ies"
            }`}
          >
            {studentCount}
          </span>
        </div>
      </CardHeader>
      <CardContent className="p-4 bg-white">
        {rows.length === 0 ? (
          <p className="py-8 text-center text-xs text-muted-foreground">
            No families
          </p>
        ) : (
          // `table-fixed` is load-bearing: with the default auto
          // layout the header width hints lose to min-content, and a
          // long nowrap cell (a 21-student residential family's name
          // list) blows the column out and scrolls the whole card
          // horizontally — fixed layout is what lets the truncate
          // spans below actually truncate.
          <Table className="table-fixed">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="text-[10px] text-muted-foreground w-[22%]">
                  Family
                </TableHead>
                <TableHead className="text-[10px] text-muted-foreground w-[26%]">
                  Students
                </TableHead>
                <TableHead className="text-[10px] text-muted-foreground w-[22%]">
                  Primary Contact
                </TableHead>
                <TableHead className="text-[10px] text-muted-foreground w-[12%]">
                  Status
                </TableHead>
                <TableHead className="text-[10px] text-muted-foreground w-[14%]">
                  Progress
                </TableHead>
                <TableHead className="w-[4%]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow
                  key={row.id}
                  onClick={() => onOpen(row)}
                  className="cursor-pointer"
                >
                  <TableCell className="text-sm font-medium">
                    <span className="inline-flex max-w-full items-center gap-1.5">
                      <span className="truncate">{row.family_name}</span>
                      {row.flow_type === "reapply" ? (
                        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground shrink-0">
                          Re-Enrollment
                        </span>
                      ) : null}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    <span className="block truncate">
                      {row.student_names || "—"}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm">
                    <span className="block truncate">
                      {row.primary_email || row.primary_name || "—"}
                    </span>
                  </TableCell>
                  <TableCell>
                    {row.stage === "application" ? (
                      <AppProgressBadge progress={appProgress(row)} />
                    ) : (
                      <StatusBadge status={badgeStatus(row)} />
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {cardMeta(row)}
                  </TableCell>
                  <TableCell className="text-right">
                    <ChevronRight className="size-4 text-muted-foreground inline" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export default function PipelinePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const yearId = searchParams.get("yearId");
  const [search, setSearch] = useState("");

  // `keepPreviousData` + the `!data` guards below keep the board on
  // screen through revalidations and year switches. Without them, any
  // failed background refresh (Xano blip, focus revalidate) flipped the
  // page into the error branch even though SWR still held perfectly
  // good rows — the whole board "disappeared" until the next successful
  // fetch.
  const { data, isLoading, error } = useSWR<PipelineFamilyRow[]>(
    yearId ? `/api/admin/pipeline?yearId=${yearId}` : null,
    adminFetcher,
    { keepPreviousData: true }
  );
  const { data: schoolYear } = useSWR<{ year_name?: string }>(
    yearId ? `/api/admin/school-years/${yearId}` : null,
    adminFetcher
  );

  const rows = useMemo(() => (Array.isArray(data) ? data : []), [data]);
  const archivedCount = useMemo(
    () => rows.filter((r) => r.is_archived).length,
    [rows]
  );

  const visible = useMemo(() => {
    const active = rows.filter((r) => !r.is_archived);
    const q = search.trim().toLowerCase();
    if (!q) return active;
    return active.filter((r) =>
      [r.family_name, r.student_names, r.primary_name, r.primary_email]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [rows, search]);

  const byStage = useMemo(() => {
    const buckets: Record<PipelineStage, PipelineFamilyRow[]> = {
      application: [],
      registration: [],
      enrollment: [],
    };
    for (const row of visible) buckets[row.stage].push(row);
    // Applications sort by progress: submitted, then underway, then
    // untouched. Rank only — Array.sort is stable, so the existing
    // order inside each group is preserved rather than replaced with
    // an ordering nobody asked for.
    buckets.application.sort(
      (a, b) =>
        APP_PROGRESS_RANK[appProgress(a)] - APP_PROGRESS_RANK[appProgress(b)]
    );
    return buckets;
  }, [visible]);

  if (!yearId) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <p className="text-muted-foreground">
          Select a school year to view the pipeline.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">
          Pipeline
          {schoolYear?.year_name ? (
            <span className="ml-2 text-base font-normal text-muted-foreground">
              · {schoolYear.year_name}
            </span>
          ) : null}
        </h1>
        <p className="text-sm text-muted-foreground">
          Every family in the admissions funnel — applications move to
          Registrations when accepted, and to Enrollments when their
          registration is confirmed.
        </p>
      </div>

      {/* Search + export span the full board width — the search field
          takes all the room the export button leaves. */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search
            className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search families, students…"
            type="search"
            autoComplete="off"
            className="w-full bg-white pl-8"
          />
        </div>
        <PipelineExportDialog
          yearId={Number(yearId)}
          yearName={schoolYear?.year_name}
        />
      </div>

      {!data && isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-[220px]" />
          ))}
        </div>
      ) : !data && error ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          Failed to load the pipeline. Refresh to try again.
        </p>
      ) : (
        <>
          {/* keepPreviousData means a failed refresh (or a failed
              fetch right after a YEAR SWITCH) still renders the last
              good rows — which may belong to the previous year while
              the heading already shows the new one. Say so instead of
              silently presenting stale data as current. */}
          {data && error ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Couldn&rsquo;t refresh the pipeline — showing the last
              loaded data, which may be out of date (or from the
              previously selected year). Retrying automatically.
            </div>
          ) : null}
          {/* One full-height table per stage, stacked — the page
              scrolls, the tables don't. */}
          <div className="space-y-4">
            {STAGES.map((stage) => (
              <PipelineStageTable
                key={stage.key}
                stage={stage}
                rows={byStage[stage.key]}
                onOpen={(row) =>
                  router.push(
                    `/admin/families/${row.family_id}?yearId=${row.year_id}`
                  )
                }
              />
            ))}
          </div>
          {archivedCount > 0 ? (
            <p className="text-xs text-muted-foreground">
              {archivedCount} archived famil
              {archivedCount === 1 ? "y is" : "ies are"} hidden from the
              page and excluded from exports.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

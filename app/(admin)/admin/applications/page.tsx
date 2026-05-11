"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type AdminRouter = ReturnType<typeof useRouter>;
import useSWR from "swr";
import { CheckCircle2, Circle, ChevronRight } from "lucide-react";
import { DataTable, type ColumnDef } from "@/components/admin/data-table";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { adminFetcher } from "@/lib/admin-fetcher";
import { cn } from "@/lib/utils";

interface AppProgressRow {
  id: number;
  family_id: number;
  year_id: number;
  flow_type: "apply" | "reapply";
  family_name: string;
  primary_name: string;
  primary_email: string;
  student_count: number;
  /** Comma-joined active-student names for the family + year. */
  student_names: string;
  family_done: boolean;
  students_done: boolean;
  financial_aid_done: boolean;
  fourth_done: boolean;
  fourth_label: "Testing" | "Transportation";
  sections_complete: number;
  sections_total: number;
  isSubmitted: boolean;
  /** True once admin has approved the family for the year. Lives on
   *  the family-progress row and is flipped by the Approve button
   *  on the family detail page. Drives the Accepted card. */
  isAccepted: boolean;
  submitted_at: number | null;
  last_edited: number | null;
  is_archived: boolean;
  reason_for_archive: string | null;
  [key: string]: unknown;
}

type ProgressFilter =
  | "all"
  | "accepted"
  | "submitted"
  | "in_progress"
  | "not_started"
  | "archived";

const FILTER_LABEL: Record<ProgressFilter, string> = {
  all: "All families",
  accepted: "Accepted",
  submitted: "Submitted",
  in_progress: "In progress",
  not_started: "Not started",
  archived: "Archived",
};

function deriveFilter(row: AppProgressRow): ProgressFilter {
  // Archived takes precedence — an archived row drops out of every
  // active queue and only appears in the Archived card below.
  // Accepted comes next: when admin has approved the family,
  // `isSubmitted` is also true (set automatically by the
  // family-progress PATCH route), so we'd double-count if we
  // didn't lift accepted rows out of Submitted first.
  if (row.is_archived) return "archived";
  if (row.isAccepted) return "accepted";
  if (row.isSubmitted) return "submitted";
  if (row.sections_complete > 0) return "in_progress";
  return "not_started";
}

/**
 * Admin Applications list — unified view of new applications AND
 * re-applications for the active school year. Each row carries a
 * `flow_type` discriminator that pivots the fourth-section column
 * (Testing vs Transportation) and the section editor slugs.
 *
 * The page renders three discrete tables — Submitted / In Progress /
 * Not Started — that share the same column shape so widths line up
 * vertically across the page. Cells are intentionally single-line +
 * monochrome; click into a row for the full detail.
 */
export default function ApplicationsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const yearId = searchParams.get("yearId");
  const [filter, setFilter] = useState<ProgressFilter>("all");

  const { data, isLoading, error } = useSWR<AppProgressRow[]>(
    yearId ? `/api/admin/applications?yearId=${yearId}` : null,
    adminFetcher
  );

  const all = useMemo(() => (Array.isArray(data) ? data : []), [data]);

  const groups = useMemo(() => {
    const accepted: AppProgressRow[] = [];
    const submitted: AppProgressRow[] = [];
    const inProgress: AppProgressRow[] = [];
    const notStarted: AppProgressRow[] = [];
    const archived: AppProgressRow[] = [];
    for (const r of all) {
      const f = deriveFilter(r);
      if (f === "archived") archived.push(r);
      else if (f === "accepted") accepted.push(r);
      else if (f === "submitted") submitted.push(r);
      else if (f === "in_progress") inProgress.push(r);
      else notStarted.push(r);
    }
    return { accepted, submitted, inProgress, notStarted, archived };
  }, [all]);

  const visibleGroups = useMemo(() => {
    if (filter === "all") return groups;
    return {
      accepted: filter === "accepted" ? groups.accepted : [],
      submitted: filter === "submitted" ? groups.submitted : [],
      inProgress: filter === "in_progress" ? groups.inProgress : [],
      notStarted: filter === "not_started" ? groups.notStarted : [],
      archived: filter === "archived" ? groups.archived : [],
    };
  }, [filter, groups]);

  const counts = useMemo(() => {
    return {
      all: all.length,
      accepted: groups.accepted.length,
      submitted: groups.submitted.length,
      in_progress: groups.inProgress.length,
      not_started: groups.notStarted.length,
      archived: groups.archived.length,
    } satisfies Record<ProgressFilter, number>;
  }, [all, groups]);

  // Shared column definitions across all four tables. `width` is set
  // on every column so the tables line up vertically — without it,
  // each table's columns auto-size to its own content and the
  // headers drift between groups.
  //
  // Layout mirrors the registrations list: family / primary / cohort
  // / sections-as-dots / submitted date. Per-section anchor jumps
  // (the previous `SectionPill` cells) were collapsed into a single
  // `SectionDots` cell; row-click opens the family detail page and
  // admin scrolls to whichever section they need from there. That
  // removed a lot of header noise without losing real navigation.
  const columns: ColumnDef<AppProgressRow>[] = [
    {
      key: "family_name",
      header: "Family",
      sortable: true,
      searchable: true,
      width: "w-[22%]",
      render: (row) => (
        <span className="block truncate font-medium">{row.family_name}</span>
      ),
    },
    {
      key: "primary_email",
      header: "Primary Contact",
      sortable: true,
      searchable: true,
      width: "w-[20%]",
      render: (row) => (
        <span className="block truncate">
          {row.primary_email || row.primary_name || "—"}
        </span>
      ),
    },
    {
      key: "flow_type",
      header: "Type",
      sortable: true,
      width: "w-[8%]",
      render: (row) => (
        <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {row.flow_type === "reapply" ? "Reapply" : "New"}
        </span>
      ),
    },
    {
      key: "student_names",
      header: "Students",
      sortable: true,
      searchable: true,
      width: "w-[24%]",
      render: (row) => (
        <span className="inline-flex items-center gap-2 min-w-0 max-w-full">
          <span className="text-xs tabular-nums text-muted-foreground shrink-0">
            {row.student_count}
          </span>
          <span className="block truncate" title={row.student_names}>
            {row.student_names || "—"}
          </span>
        </span>
      ),
    },
    {
      key: "sections_complete",
      header: "Sections",
      sortable: true,
      width: "w-[12%]",
      render: (row) => (
        <span className="inline-flex items-center gap-2">
          <span className="text-xs tabular-nums text-muted-foreground">
            {row.sections_complete}/{row.sections_total}
          </span>
          <SectionDots row={row} />
        </span>
      ),
    },
    {
      key: "submitted_at",
      header: "Submitted",
      sortable: true,
      width: "w-[10%]",
      render: (row) => (
        <span className="block truncate">
          {row.submitted_at
            ? new Date(row.submitted_at).toLocaleDateString()
            : "—"}
        </span>
      ),
    },
    {
      key: "id",
      header: "",
      width: "w-[40px]",
      align: "right",
      render: () => (
        <ChevronRight className="size-4 text-muted-foreground inline" />
      ),
    },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Applications</h1>
          <p className="text-sm text-muted-foreground">
            One row per family per academic year — both new applications
            and re-applications. Click any section to open it for review
            or editing.
          </p>
        </div>
        <Select
          value={filter}
          onValueChange={(v) => setFilter(v as ProgressFilter)}
        >
          <SelectTrigger className="w-[200px] bg-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(
              [
                "all",
                "accepted",
                "submitted",
                "in_progress",
                "not_started",
              ] as const
            ).map((f) => (
              <SelectItem key={f} value={f}>
                {FILTER_LABEL[f]} ({counts[f]})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error ? (
        <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
          Failed to load applications:{" "}
          {error instanceof Error ? error.message : "unknown error"}
        </div>
      ) : null}

      {!yearId ? (
        <div className="rounded-lg border bg-white px-6 py-12 text-center text-sm text-muted-foreground">
          Pick a school year above to view its applications.
        </div>
      ) : (
        <div className="space-y-8">
          {/* Accepted — admin has approved this family for the
              year via the family detail Accept button. Sits above
              Submitted because acceptance is downstream of
              submission and admin wants the highest-status rows up
              top. The family-progress route auto-flips
              `isSubmitted = true` on accept, so any accepted row
              would otherwise also show up under Submitted; the
              `deriveFilter` precedence keeps them in this one
              bucket. */}
          <ApplicationsGroup
            title="Accepted"
            description="Admin approved this family. Ready for tuition + enrollment signing."
            // Green-500 — the brighter "done deal" green. Distinct
            // from the blue used on Submitted so admin can scan
            // the cards by color alone: green = approved and
            // moving forward, blue = waiting on admin decision.
            dotColor="bg-green-500"
            rows={visibleGroups.accepted}
            isLoading={
              isLoading &&
              filter !== "submitted" &&
              filter !== "in_progress" &&
              filter !== "not_started"
            }
            error={error}
            columns={columns}
            router={router}
          />
          <ApplicationsGroup
            title="Submitted"
            description="Awaiting admissions decision."
            // Blue = "needs admin action." Distinct from Accepted's
            // green so the two cards read differently at a glance —
            // submitted families are queued for review, accepted
            // families have already cleared that bar.
            dotColor="bg-blue-500"
            rows={visibleGroups.submitted}
            isLoading={
              isLoading &&
              filter !== "accepted" &&
              filter !== "in_progress" &&
              filter !== "not_started"
            }
            error={error}
            columns={columns}
            router={router}
          />
          <ApplicationsGroup
            title="In Progress"
            description="Started but not yet submitted by the family."
            // Yellow = "in flight, waiting on the family." Same amber
            // family used by the in-progress step circle on the
            // parent-side side nav for visual consistency.
            dotColor="bg-amber-500"
            rows={visibleGroups.inProgress}
            isLoading={
              isLoading &&
              filter !== "accepted" &&
              filter !== "submitted" &&
              filter !== "not_started"
            }
            error={error}
            columns={columns}
            router={router}
          />
          <ApplicationsGroup
            title="Not Started"
            description="Family has a progress row but hasn't completed any sections."
            // Red = "no movement." Lets admin spot stalled families at a
            // glance without reading the section pills.
            dotColor="bg-red-500"
            rows={visibleGroups.notStarted}
            isLoading={
              isLoading &&
              filter !== "accepted" &&
              filter !== "submitted" &&
              filter !== "in_progress"
            }
            error={error}
            columns={columns}
            router={router}
          />
          {/* Archived — admin retired the row via the family detail
              page's Archive button. Surfaces here so admin can find
              the row again (and read the captured reason) without
              digging through Xano. Slate dot keeps the visual
              hierarchy below the active queues. */}
          <ApplicationsGroup
            title="Archived"
            description="Set aside by admin. Click into a row to read the reason or unarchive."
            dotColor="bg-slate-400"
            rows={visibleGroups.archived}
            isLoading={
              isLoading &&
              filter !== "accepted" &&
              filter !== "submitted" &&
              filter !== "in_progress" &&
              filter !== "not_started"
            }
            error={error}
            columns={columns}
            router={router}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Four sections rendered as small dots — Family / Students /
 * Financial Aid / Testing-or-Transportation. Mirrors the
 * `SectionDots` on the registrations list so the two surfaces
 * read identically. Click-through to specific section anchors
 * was dropped when this column collapsed; row click on the
 * surrounding row opens the family detail page where every
 * section is reachable via the in-page side nav.
 */
function SectionDots({ row }: { row: AppProgressRow }) {
  const sections = [
    { key: "family", complete: row.family_done, label: "Family" },
    { key: "students", complete: row.students_done, label: "Students" },
    {
      key: "financial_aid",
      complete: row.financial_aid_done,
      label: "Financial Aid",
    },
    {
      key: "fourth",
      complete: row.fourth_done,
      label: row.fourth_label,
    },
  ];
  return (
    <span className="inline-flex items-center gap-1">
      {sections.map((s) =>
        s.complete ? (
          <CheckCircle2
            key={s.key}
            className="size-3 text-green-600"
            aria-label={`${s.label} complete`}
          />
        ) : (
          <Circle
            key={s.key}
            className="size-3 text-muted-foreground/40"
            aria-label={`${s.label} not complete`}
          />
        )
      )}
    </span>
  );
}

function ApplicationsGroup({
  title,
  description,
  rows,
  isLoading,
  error,
  columns,
  router,
  dotColor,
}: {
  title: string;
  description: string;
  rows: AppProgressRow[];
  isLoading: boolean;
  error: unknown;
  columns: ColumnDef<AppProgressRow>[];
  router: AdminRouter;
  /** Tailwind bg-... class for the small status dot rendered before the
   *  title — green for Submitted, amber for In Progress, red for Not
   *  Started. Lives at the section-card level rather than inside the
   *  table since the section IS the status. */
  dotColor: string;
}) {
  if (!isLoading && !error && rows.length === 0) return null;
  return (
    <Card className="overflow-hidden bg-white py-0 gap-0">
      <CardHeader className="py-4 border-b bg-white">
        <div className="flex items-baseline gap-3">
          {/* `self-center` so the dot vertically aligns to the
              uppercase title text rather than its baseline. */}
          <span
            className={cn(
              "size-2.5 shrink-0 self-center rounded-full",
              dotColor
            )}
            aria-hidden
          />
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            {title}
          </CardTitle>
          <span className="text-xs tabular-nums text-muted-foreground">
            ({rows.length})
          </span>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </CardHeader>
      <CardContent className="p-4 bg-white">
        <DataTable<AppProgressRow>
          columns={columns}
          data={rows}
          isLoading={isLoading}
          searchPlaceholder={`Search ${title.toLowerCase()}…`}
          onRowClick={(row) => {
            router.push(
              `/admin/families/${row.family_id}?yearId=${row.year_id}`
            );
          }}
        />
      </CardContent>
    </Card>
  );
}

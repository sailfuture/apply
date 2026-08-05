"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { Activity, CheckCircle2, Circle, ChevronRight } from "lucide-react";
import { DataTable, type ColumnDef } from "@/components/admin/data-table";
import { ActivityLogSheet } from "@/components/admin/activity-log-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { LatestActivityMap } from "@/app/api/admin/latest-activity/route";
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
  // ONE search box filters every card on the page (user request —
  // per-card search boxes are gone).
  const [search, setSearch] = useState("");
  const [activityFamily, setActivityFamily] = useState<number | null>(null);

  const { data, isLoading, error } = useSWR<AppProgressRow[]>(
    yearId ? `/api/admin/applications?yearId=${yearId}` : null,
    adminFetcher
  );
  // Latest note/text per family — the "Primary Contact" email column
  // was replaced with this (user request).
  const { data: latestData } = useSWR<{ byFamily: LatestActivityMap }>(
    "/api/admin/latest-activity",
    adminFetcher
  );
  const latestByFamily = latestData?.byFamily ?? {};

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
    // Order Accepted by submission date, earliest first — a FIFO
    // queue so admin works through approved families in the order
    // they applied. Nulls (shouldn't happen: accept implies submit)
    // sort last. This is only the default order; the Submitted
    // column header still re-sorts on click.
    accepted.sort(
      (a, b) => (a.submitted_at ?? Infinity) - (b.submitted_at ?? Infinity)
    );
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
      // Name click = full application page; the ROW click opens the
      // activity sheet, so this stops propagation.
      render: (row) => (
        <button
          type="button"
          className="block max-w-full truncate text-left font-medium hover:underline"
          onClick={(e) => {
            e.stopPropagation();
            router.push(
              `/admin/families/${row.family_id}?yearId=${row.year_id}`
            );
          }}
        >
          {row.family_name}
        </button>
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
      key: "latest_activity",
      header: "Latest Activity",
      searchable: true,
      width: "w-[20%]",
      accessor: (row) =>
        latestByFamily[String(row.family_id)]?.body ?? "",
      render: (row) => {
        const latest = latestByFamily[String(row.family_id)];
        return latest ? (
          <span className="block truncate text-muted-foreground" title={latest.body}>
            <span className="font-medium text-foreground">
              {latest.kind === "text" ? "Text: " : "Note: "}
            </span>
            {latest.body}
          </span>
        ) : (
          <span className="text-muted-foreground/60">—</span>
        );
      },
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
      key: "activity",
      header: "",
      width: "w-[44px]",
      align: "right",
      render: (row) => (
        <Button
          variant="outline"
          size="sm"
          className="size-7 bg-white p-0"
          aria-label={`Activity for ${row.family_name}`}
          onClick={(e) => {
            e.stopPropagation();
            setActivityFamily(row.family_id);
          }}
        >
          <Activity className="size-3.5 text-muted-foreground" />
        </Button>
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
      <div>
        <h1 className="text-2xl font-bold">Applications</h1>
        <p className="text-sm text-muted-foreground">
          One row per family per academic year — both new applications
          and re-applications. Click any section to open it for review
          or editing.
        </p>
      </div>

      {/* Search + filter — their own full-width row under the header,
          spanning the same width as the tables below. */}
      <div className="flex items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search all applications…"
          className="flex-1 bg-white"
        />
        <Select
          value={filter}
          onValueChange={(v) => setFilter(v as ProgressFilter)}
        >
          <SelectTrigger className="w-[200px] shrink-0 bg-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(
              [
                "all",
                "submitted",
                "in_progress",
                "not_started",
                "accepted",
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
          {/* Page order (user request): Submitted → In Progress →
              Not Started → Accepted → Archived. Submitted leads
              because it's the action queue; accepted families are
              done deals and read further down. */}
          <ApplicationsGroup
            title="Submitted"
            description="Awaiting admissions decision."
            dotColor="bg-blue-500"
            rows={visibleGroups.submitted}
            isLoading={isLoading}
            error={error}
            columns={columns}
            onRowClick={(row) => setActivityFamily(row.family_id)}
            search={search}
          />
          <ApplicationsGroup
            title="In Progress"
            description="Started but not yet submitted by the family."
            dotColor="bg-amber-500"
            rows={visibleGroups.inProgress}
            isLoading={isLoading}
            error={error}
            columns={columns}
            onRowClick={(row) => setActivityFamily(row.family_id)}
            search={search}
          />
          <ApplicationsGroup
            title="Not Started"
            description="Family has a progress row but hasn't completed any sections."
            dotColor="bg-red-500"
            rows={visibleGroups.notStarted}
            isLoading={isLoading}
            error={error}
            columns={columns}
            onRowClick={(row) => setActivityFamily(row.family_id)}
            search={search}
          />
          {/* Accepted — the family-progress route auto-flips
              `isSubmitted = true` on accept, so any accepted row
              would otherwise also show up under Submitted; the
              `deriveFilter` precedence keeps them in this one
              bucket. */}
          <ApplicationsGroup
            title="Accepted"
            description="Admin approved this family. Ready for tuition + enrollment signing."
            dotColor="bg-green-500"
            rows={visibleGroups.accepted}
            isLoading={isLoading}
            error={error}
            columns={columns}
            onRowClick={(row) => setActivityFamily(row.family_id)}
            search={search}
          />
          <ApplicationsGroup
            title="Archived"
            description="Set aside by admin. Click into a row to read the reason or unarchive."
            dotColor="bg-slate-400"
            rows={visibleGroups.archived}
            isLoading={isLoading}
            error={error}
            columns={columns}
            onRowClick={(row) => setActivityFamily(row.family_id)}
            search={search}
          />
        </div>
      )}

      {/* Shared controlled Activity sheet — one instance for every
          row's trigger. */}
      {activityFamily && yearId ? (
        <ActivityLogSheet
          familyId={activityFamily}
          yearId={Number(yearId)}
          open
          onOpenChange={(o) => {
            if (!o) setActivityFamily(null);
          }}
        />
      ) : null}
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
  onRowClick,
  dotColor,
  search,
}: {
  title: string;
  description: string;
  rows: AppProgressRow[];
  isLoading: boolean;
  error: unknown;
  columns: ColumnDef<AppProgressRow>[];
  /** Row click opens the family's activity sheet (the family-name
   *  cell handles navigation to the full page itself). */
  onRowClick: (row: AppProgressRow) => void;
  /** Page-level search value — drives every card's table at once. */
  search: string;
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
          <CardTitle className="text-sm font-semibold text-muted-foreground">
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
          externalSearch={search}
          onRowClick={onRowClick}
        />
      </CardContent>
    </Card>
  );
}

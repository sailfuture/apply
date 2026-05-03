"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type AdminRouter = ReturnType<typeof useRouter>;
import useSWR from "swr";
import { CheckCircle2, Circle, ChevronRight } from "lucide-react";
import { DataTable, type ColumnDef } from "@/components/admin/data-table";
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
  family_name: string;
  primary_name: string;
  primary_email: string;
  student_count: number;
  family_completed: boolean;
  students_completed: boolean;
  financial_aid_completed: boolean;
  testing_completed: boolean;
  sections_complete: number;
  sections_total: number;
  isSubmitted: boolean;
  submitted_at: number | null;
  last_edited: number | null;
  [key: string]: unknown;
}

type ProgressFilter = "all" | "submitted" | "in_progress" | "not_started";

const FILTER_LABEL: Record<ProgressFilter, string> = {
  all: "All families",
  submitted: "Submitted",
  in_progress: "In progress",
  not_started: "Not started",
};

function deriveFilter(row: AppProgressRow): ProgressFilter {
  if (row.isSubmitted) return "submitted";
  if (row.sections_complete > 0) return "in_progress";
  return "not_started";
}

/**
 * Per-section route segment — keys must match the slug used by the
 * `/admin/families/[id]/<section>` page below the table. Adding a new
 * section means adding a row here AND creating that page.
 */
const SECTIONS = [
  { key: "family", label: "Family", slug: "family" },
  { key: "students", label: "Students", slug: "students" },
  { key: "financial_aid", label: "Financial Aid", slug: "financial-aid" },
  { key: "testing", label: "Testing", slug: "testing" },
] as const;

type SectionKey = (typeof SECTIONS)[number]["key"];

function isComplete(row: AppProgressRow, key: SectionKey): boolean {
  switch (key) {
    case "family":
      return row.family_completed;
    case "students":
      return row.students_completed;
    case "financial_aid":
      return row.financial_aid_completed;
    case "testing":
      return row.testing_completed;
  }
}

/**
 * Admin Applications list — one row per family per year, backed by the
 * per-year progress endpoint. Each section gets its own column so admins
 * can see at a glance which sections each family has completed; clicking
 * a section opens the per-section detail page where the data can be
 * reviewed and edited.
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

  // Pre-bucketed by status — cheaper than filtering on every render
  // and lets us render each table group from a single source of truth.
  const groups = useMemo(() => {
    const submitted: AppProgressRow[] = [];
    const inProgress: AppProgressRow[] = [];
    const notStarted: AppProgressRow[] = [];
    for (const r of all) {
      const f = deriveFilter(r);
      if (f === "submitted") submitted.push(r);
      else if (f === "in_progress") inProgress.push(r);
      else notStarted.push(r);
    }
    return { submitted, inProgress, notStarted };
  }, [all]);

  // Apply the optional filter on top of the buckets — when a filter is
  // selected, only that bucket gets shown.
  const visibleGroups = useMemo(() => {
    if (filter === "all") return groups;
    return {
      submitted: filter === "submitted" ? groups.submitted : [],
      inProgress: filter === "in_progress" ? groups.inProgress : [],
      notStarted: filter === "not_started" ? groups.notStarted : [],
    };
  }, [filter, groups]);

  const counts = useMemo(() => {
    return {
      all: all.length,
      submitted: groups.submitted.length,
      in_progress: groups.inProgress.length,
      not_started: groups.notStarted.length,
    } satisfies Record<ProgressFilter, number>;
  }, [all, groups]);

  function openSection(row: AppProgressRow, slug: string) {
    router.push(
      `/admin/families/${row.family_id}/${slug}?yearId=${row.year_id}`
    );
  }

  const columns: ColumnDef<AppProgressRow>[] = [
    {
      key: "family_name",
      header: "Family",
      sortable: true,
      searchable: true,
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.family_name}</p>
          {row.primary_name || row.primary_email ? (
            <p className="truncate text-xs text-muted-foreground">
              {row.primary_name}
              {row.primary_name && row.primary_email ? " · " : ""}
              {row.primary_email}
            </p>
          ) : null}
        </div>
      ),
    },
    {
      key: "student_count",
      header: "Students",
      sortable: true,
      render: (row) =>
        row.student_count === 1 ? "1 student" : `${row.student_count} students`,
    },
    // One column per application section. Each cell is its own
    // click target (stops row-click propagation) so the admin can
    // jump straight into the section they want to edit.
    ...SECTIONS.map(
      (s): ColumnDef<AppProgressRow> => ({
        key: s.key,
        header: s.label,
        sortable: true,
        render: (row) => {
          const complete = isComplete(row, s.key);
          return (
            <button
              type="button"
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors",
                complete
                  ? "text-emerald-700 hover:bg-emerald-50"
                  : "text-muted-foreground hover:bg-muted"
              )}
              onClick={(e) => {
                e.stopPropagation();
                openSection(row, s.slug);
              }}
              title={`Open ${s.label} section for ${row.family_name}`}
            >
              {complete ? (
                <CheckCircle2 className="size-4 text-green-600" />
              ) : (
                <Circle className="size-4 text-muted-foreground/40" />
              )}
              <span className="underline-offset-2 group-hover:underline">
                {complete ? "Complete" : "Not yet"}
              </span>
            </button>
          );
        },
      })
    ),
    {
      key: "isSubmitted",
      header: "Status",
      sortable: true,
      render: (row) => {
        const f = deriveFilter(row);
        const cls =
          f === "submitted"
            ? "bg-blue-100 text-blue-700 border-blue-200"
            : f === "in_progress"
              ? "bg-amber-100 text-amber-700 border-amber-200"
              : "bg-slate-100 text-slate-600 border-slate-200";
        return (
          <span
            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${cls}`}
          >
            {FILTER_LABEL[f]}
          </span>
        );
      },
    },
    {
      key: "submitted_at",
      header: "Submitted",
      sortable: true,
      render: (row) =>
        row.submitted_at
          ? new Date(row.submitted_at).toLocaleDateString()
          : "—",
    },
    {
      key: "id",
      header: "",
      render: () => (
        <ChevronRight className="size-4 text-muted-foreground" />
      ),
    },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Applications</h1>
          <p className="text-sm text-muted-foreground">
            One row per family per academic year. Click any section to
            open it for review or editing.
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
              ["all", "submitted", "in_progress", "not_started"] as const
            ).map((f) => (
              <SelectItem key={f} value={f}>
                {FILTER_LABEL[f]} ({counts[f]})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Failed to load applications:{" "}
          {error instanceof Error ? error.message : "unknown error"}
        </div>
      ) : null}

      {!yearId ? (
        <div className="rounded-lg border bg-white px-6 py-12 text-center text-sm text-muted-foreground">
          Pick a school year above to view its applications.
        </div>
      ) : (
        // Three discrete table groups — Submitted / In Progress / Not
        // Started — instead of one big filterable table. Admins
        // overwhelmingly want to triage submitted apps first, then
        // chase in-progress families, then ignore not-started rows
        // unless they're scanning. Each group has its own header with
        // a count and only renders when it has rows (or is the
        // exclusive selection from the status filter).
        <div className="space-y-8">
          <ApplicationsGroup
            title="Submitted"
            description="Awaiting admissions decision."
            rows={visibleGroups.submitted}
            isLoading={isLoading && filter !== "in_progress" && filter !== "not_started"}
            error={error}
            columns={columns}
            router={router}
            tone="blue"
          />
          <ApplicationsGroup
            title="In Progress"
            description="Started but not yet submitted by the family."
            rows={visibleGroups.inProgress}
            isLoading={
              isLoading && filter !== "submitted" && filter !== "not_started"
            }
            error={error}
            columns={columns}
            router={router}
            tone="amber"
          />
          <ApplicationsGroup
            title="Not Started"
            description="Family has a progress row but hasn't completed any sections."
            rows={visibleGroups.notStarted}
            isLoading={
              isLoading && filter !== "submitted" && filter !== "in_progress"
            }
            error={error}
            columns={columns}
            router={router}
            tone="slate"
          />
        </div>
      )}
    </div>
  );
}

/**
 * One status-bucket section. Renders a header (title + count + tone
 * dot) above its own DataTable; suppresses entirely when there are no
 * rows AND we're not loading, so the page doesn't render three
 * "no rows" placeholders. Each table row is clickable and routes to
 * the family overview just like the unified table did.
 */
function ApplicationsGroup({
  title,
  description,
  rows,
  isLoading,
  error,
  columns,
  router,
  tone,
}: {
  title: string;
  description: string;
  rows: AppProgressRow[];
  isLoading: boolean;
  error: unknown;
  columns: ColumnDef<AppProgressRow>[];
  router: AdminRouter;
  tone: "blue" | "amber" | "slate";
}) {
  // Skip rendering the section entirely when it's empty and not in
  // flight — clutters the page otherwise. (Error + loading still
  // render so the user sees feedback for the active group.)
  if (!isLoading && !error && rows.length === 0) return null;
  const dotClass =
    tone === "blue"
      ? "bg-blue-500"
      : tone === "amber"
        ? "bg-amber-500"
        : "bg-slate-400";
  return (
    <section>
      <header className="flex items-baseline gap-3 mb-3">
        <span className={cn("inline-block size-2 rounded-full", dotClass)} />
        <h2 className="text-lg font-semibold">{title}</h2>
        <span className="text-sm tabular-nums text-muted-foreground">
          ({rows.length})
        </span>
        <p className="text-xs text-muted-foreground ml-2">{description}</p>
      </header>
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
    </section>
  );
}

"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
 * Admin Applications list — one row per family per year, backed by the
 * per-year progress endpoint. Each row is clickable and routes into the
 * family detail page where the per-student application breakdown +
 * scholarship + notes live (i.e. "all of the application sections" the
 * admin needs to triage).
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
  const filtered = useMemo(() => {
    if (filter === "all") return all;
    return all.filter((r) => deriveFilter(r) === filter);
  }, [all, filter]);

  const counts = useMemo(() => {
    const result: Record<ProgressFilter, number> = {
      all: all.length,
      submitted: 0,
      in_progress: 0,
      not_started: 0,
    };
    for (const r of all) {
      result[deriveFilter(r)] += 1;
    }
    return result;
  }, [all]);

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
    {
      key: "sections_complete",
      header: "Progress",
      sortable: true,
      // Compact 4-dot indicator (one per section), plus a numeric
      // shorthand so admins can sort + scan at a glance.
      render: (row) => (
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium tabular-nums text-muted-foreground">
            {row.sections_complete}/{row.sections_total}
          </span>
          <SectionDots row={row} />
        </div>
      ),
    },
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
      key: "last_edited",
      header: "Last edit",
      sortable: true,
      render: (row) =>
        row.last_edited
          ? new Date(row.last_edited).toLocaleDateString()
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
            One row per family per academic year. Click into a family to
            see all submitted application sections and edit values.
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
        <>
          <DataTable<AppProgressRow>
            columns={columns}
            data={filtered}
            isLoading={isLoading}
            searchPlaceholder="Search by family name…"
            onRowClick={(row) => {
              router.push(
                `/admin/families/${row.family_id}?yearId=${row.year_id}`
              );
            }}
          />

          {!isLoading && !error && filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No families match the current filter for this school year.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

/**
 * Four colored dots: one per application section (Family, Students,
 * Financial Aid, Testing). Filled green when complete, hollow gray when
 * not. A submitted row shows all four green automatically — admins can
 * still see at a glance which sections were completed before submission.
 */
function SectionDots({ row }: { row: AppProgressRow }) {
  const sections = [
    { key: "family", complete: row.family_completed, label: "Family" },
    { key: "students", complete: row.students_completed, label: "Students" },
    {
      key: "financial_aid",
      complete: row.financial_aid_completed,
      label: "Financial Aid",
    },
    { key: "testing", complete: row.testing_completed, label: "Testing" },
  ];
  return (
    <div className="flex items-center gap-1">
      {sections.map((s) =>
        s.complete ? (
          <CheckCircle2
            key={s.key}
            className="size-3.5 text-green-600"
            aria-label={`${s.label} complete`}
          />
        ) : (
          <Circle
            key={s.key}
            className="size-3.5 text-muted-foreground/40"
            aria-label={`${s.label} not complete`}
          />
        )
      )}
    </div>
  );
}

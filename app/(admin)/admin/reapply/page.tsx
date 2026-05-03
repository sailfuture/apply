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
import { cn } from "@/lib/utils";

interface ReapplyRow {
  id: number;
  family_id: number;
  year_id: number;
  family_name: string;
  primary_name: string;
  primary_email: string;
  student_count: number;
  isFamilyDetails: boolean;
  isStudentDetails: boolean;
  isScholarship: boolean;
  isTransportation: boolean;
  sections_complete: number;
  sections_total: number;
  isSubmitted: boolean;
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

function deriveFilter(row: ReapplyRow): ProgressFilter {
  if (row.isSubmitted) return "submitted";
  if (row.sections_complete > 0) return "in_progress";
  return "not_started";
}

const SECTIONS = [
  { key: "isFamilyDetails", label: "Family", slug: "family" },
  { key: "isStudentDetails", label: "Students", slug: "students" },
  { key: "isScholarship", label: "Financial Aid", slug: "financial-aid" },
  { key: "isTransportation", label: "Transportation", slug: "transportation" },
] as const;

type SectionKey = (typeof SECTIONS)[number]["key"];

function isComplete(row: ReapplyRow, key: SectionKey): boolean {
  switch (key) {
    case "isFamilyDetails":
      return row.isFamilyDetails;
    case "isStudentDetails":
      return row.isStudentDetails;
    case "isScholarship":
      return row.isScholarship;
    case "isTransportation":
      return row.isTransportation;
  }
}

/**
 * Admin Re-Application list — returning families that have started or
 * completed a re-application for the active school year. Mirrors the
 * shape of the Applications page (per-section columns, click into a
 * section to review/edit) so the two surfaces feel like the same
 * product. Backed by the dedicated
 * `reapply_family_progress_by_year` Xano query.
 */
export default function AdminReapplyPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const yearId = searchParams.get("yearId");
  const [filter, setFilter] = useState<ProgressFilter>("all");

  const { data, isLoading, error } = useSWR<ReapplyRow[]>(
    yearId ? `/api/admin/reapply?yearId=${yearId}` : null,
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
    for (const r of all) result[deriveFilter(r)] += 1;
    return result;
  }, [all]);

  function openSection(row: ReapplyRow, slug: string) {
    router.push(
      `/admin/families/${row.family_id}/reapply-${slug}?yearId=${row.year_id}`
    );
  }

  const columns: ColumnDef<ReapplyRow>[] = [
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
    ...SECTIONS.map(
      (s): ColumnDef<ReapplyRow> => ({
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
              {complete ? "Complete" : "Not yet"}
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
      key: "last_edited",
      header: "Last edit",
      sortable: true,
      render: (row) =>
        row.last_edited ? new Date(row.last_edited).toLocaleDateString() : "—",
    },
    {
      key: "id",
      header: "",
      render: () => <ChevronRight className="size-4 text-muted-foreground" />,
    },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Re-Applications</h1>
          <p className="text-sm text-muted-foreground">
            Returning families that have started or completed a
            re-application for the selected school year.
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
          Failed to load re-applications:{" "}
          {error instanceof Error ? error.message : "unknown error"}
        </div>
      ) : null}

      {!yearId ? (
        <div className="rounded-lg border bg-white px-6 py-12 text-center text-sm text-muted-foreground">
          Pick a school year above to view its re-applications.
        </div>
      ) : (
        <>
          <DataTable<ReapplyRow>
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

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
  family_done: boolean;
  students_done: boolean;
  financial_aid_done: boolean;
  fourth_done: boolean;
  fourth_label: "Testing" | "Transportation";
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
 * Per-section route slug. Same first three sections regardless of flow,
 * different fourth (Testing vs Transportation), and the reapply flow
 * uses `reapply-*` slugs to land on the right section editor.
 */
function sectionSlugs(row: AppProgressRow) {
  if (row.flow_type === "reapply") {
    return {
      family: "reapply-family",
      students: "reapply-students",
      financial_aid: "reapply-financial-aid",
      fourth: "reapply-transportation",
    };
  }
  return {
    family: "family",
    students: "students",
    financial_aid: "financial-aid",
    fourth: "testing",
  };
}

/**
 * Admin Applications list — unified view of new applications AND
 * re-applications for the active school year. Each row carries a
 * `flow_type` discriminator that pivots the fourth-section column
 * (Testing vs Transportation) and the section editor slugs.
 *
 * Tables are bucketed by status (Submitted / In Progress / Not Started)
 * so admins can triage submitted apps first and chase the rest later.
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
      key: "flow_type",
      header: "Type",
      sortable: true,
      render: (row) => (
        <span
          className={cn(
            "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider",
            row.flow_type === "reapply"
              ? "bg-purple-50 text-purple-700 border-purple-200"
              : "bg-sky-50 text-sky-700 border-sky-200"
          )}
        >
          {row.flow_type === "reapply" ? "Re-Apply" : "New"}
        </span>
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
      key: "family_done",
      header: "Family",
      sortable: true,
      render: (row) => (
        <SectionPill
          complete={row.family_done}
          onClick={() => openSection(row, sectionSlugs(row).family)}
          label={`Family for ${row.family_name}`}
        />
      ),
    },
    {
      key: "students_done",
      header: "Students",
      sortable: true,
      render: (row) => (
        <SectionPill
          complete={row.students_done}
          onClick={() => openSection(row, sectionSlugs(row).students)}
          label={`Students for ${row.family_name}`}
        />
      ),
    },
    {
      key: "financial_aid_done",
      header: "Financial Aid",
      sortable: true,
      render: (row) => (
        <SectionPill
          complete={row.financial_aid_done}
          onClick={() =>
            openSection(row, sectionSlugs(row).financial_aid)
          }
          label={`Financial Aid for ${row.family_name}`}
        />
      ),
    },
    {
      key: "fourth_done",
      header: "Testing / Transport",
      sortable: true,
      render: (row) => (
        <SectionPill
          complete={row.fourth_done}
          onClick={() => openSection(row, sectionSlugs(row).fourth)}
          label={`${row.fourth_label} for ${row.family_name}`}
          fallbackText={row.fourth_label}
        />
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

function SectionPill({
  complete,
  onClick,
  label,
  fallbackText,
}: {
  complete: boolean;
  onClick: () => void;
  label: string;
  fallbackText?: string;
}) {
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
        onClick();
      }}
      title={`Open ${label}`}
    >
      {complete ? (
        <CheckCircle2 className="size-4 text-green-600" />
      ) : (
        <Circle className="size-4 text-muted-foreground/40" />
      )}
      <span className="underline-offset-2 group-hover:underline">
        {complete ? "Complete" : fallbackText ?? "Not yet"}
      </span>
    </button>
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
  if (!isLoading && !error && rows.length === 0) return null;
  const dotClass =
    tone === "blue"
      ? "bg-blue-500"
      : tone === "amber"
        ? "bg-amber-500"
        : "bg-slate-400";
  return (
    <Card className="overflow-hidden bg-white py-0 gap-0">
      <CardHeader className="py-4 border-b bg-white">
        <div className="flex items-center gap-3">
          <span className={cn("inline-block size-2 rounded-full", dotClass)} />
          <CardTitle className="text-lg">{title}</CardTitle>
          <span className="text-sm tabular-nums text-muted-foreground">
            ({rows.length})
          </span>
          <p className="text-xs text-muted-foreground ml-2">{description}</p>
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

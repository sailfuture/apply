"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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

interface RegStudentRow {
  id: number;
  application_id: number;
  student_id: number;
  family_id: number;
  year_id: number;
  student_first_name: string;
  student_last_name: string;
  student_full_name: string;
  student_dob: string;
  student_grade: string;
  family_name: string;
  primary_name: string;
  primary_email: string;
  isTuition: boolean;
  isEnrollment: boolean;
  isRegistration: boolean;
  isVolunteerHours: boolean;
  sections_complete: number;
  sections_total: number;
  registration_submitted: boolean;
  registration_submitted_date: number | null;
  last_edited: number | null;
  enrollment_agreement_status: string;
  is_enrollment_agreement_signed: boolean;
  [key: string]: unknown;
}

type ProgressFilter = "all" | "submitted" | "in_progress" | "not_started";

const FILTER_LABEL: Record<ProgressFilter, string> = {
  all: "All students",
  submitted: "Submitted",
  in_progress: "In progress",
  not_started: "Not started",
};

function deriveFilter(row: RegStudentRow): ProgressFilter {
  if (row.registration_submitted) return "submitted";
  if (row.sections_complete > 0) return "in_progress";
  return "not_started";
}

/**
 * Admin Registrations list — one row per student who's been confirmed
 * to be starting in the selected year (i.e. their `registration_application`
 * row has `isAccepted=true`). The four post-acceptance sections (Tuition,
 * Enrollment Agreement, Registration Packet, Volunteer Hours) are still
 * tracked at the family level today, so multiple student rows from the
 * same family will share the same section dots — that's expected.
 */
export default function RegistrationsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const yearId = searchParams.get("yearId");
  const [filter, setFilter] = useState<ProgressFilter>("all");

  const { data, isLoading, error } = useSWR<RegStudentRow[]>(
    yearId ? `/api/admin/registrations?yearId=${yearId}` : null,
    adminFetcher
  );

  const all = useMemo(() => (Array.isArray(data) ? data : []), [data]);

  const groups = useMemo(() => {
    const submitted: RegStudentRow[] = [];
    const inProgress: RegStudentRow[] = [];
    const notStarted: RegStudentRow[] = [];
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

  const columns: ColumnDef<RegStudentRow>[] = [
    {
      key: "student_full_name",
      header: "Student",
      sortable: true,
      searchable: true,
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.student_full_name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {row.student_grade ? (
              <>Grade {row.student_grade} · </>
            ) : null}
            {row.family_name}
          </p>
        </div>
      ),
    },
    {
      key: "primary_email",
      header: "Primary Contact",
      sortable: true,
      searchable: true,
      render: (row) =>
        row.primary_name || row.primary_email ? (
          <div className="min-w-0">
            <p className="truncate text-sm">{row.primary_name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {row.primary_email}
            </p>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      key: "sections_complete",
      header: "Packet Progress",
      sortable: true,
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
      key: "enrollment_agreement_status",
      header: "Enrollment Agreement",
      sortable: true,
      render: (row) => {
        if (row.is_enrollment_agreement_signed) {
          return (
            <span className="inline-flex items-center rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200 px-2.5 py-0.5 text-xs font-medium">
              Signed
            </span>
          );
        }
        if (row.enrollment_agreement_status === "sent") {
          return (
            <span className="inline-flex items-center rounded-full border bg-amber-50 text-amber-700 border-amber-200 px-2.5 py-0.5 text-xs font-medium">
              Sent
            </span>
          );
        }
        if (row.enrollment_agreement_status) {
          return (
            <span className="inline-flex items-center rounded-full border bg-slate-100 text-slate-700 border-slate-200 px-2.5 py-0.5 text-xs font-medium capitalize">
              {row.enrollment_agreement_status}
            </span>
          );
        }
        return <span className="text-xs text-muted-foreground">—</span>;
      },
    },
    {
      key: "registration_submitted",
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
      key: "registration_submitted_date",
      header: "Submitted",
      sortable: true,
      render: (row) =>
        row.registration_submitted_date
          ? new Date(row.registration_submitted_date).toLocaleDateString()
          : "—",
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
          <h1 className="text-2xl font-bold">Registrations</h1>
          <p className="text-sm text-muted-foreground">
            One row per student who&rsquo;s been accepted for the
            selected academic year. Click into a row to land on the
            family detail page where post-acceptance packets and
            decision details live.
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
          Failed to load registrations:{" "}
          {error instanceof Error ? error.message : "unknown error"}
        </div>
      ) : null}

      {!yearId ? (
        <div className="rounded-lg border bg-white px-6 py-12 text-center text-sm text-muted-foreground">
          Pick a school year above to view its registrations.
        </div>
      ) : (
        <div className="space-y-8">
          <RegistrationsGroup
            title="Submitted"
            description="Family has submitted the post-acceptance packet."
            rows={visibleGroups.submitted}
            isLoading={
              isLoading && filter !== "in_progress" && filter !== "not_started"
            }
            error={error}
            columns={columns}
            tone="blue"
            onRowClick={(row) =>
              router.push(
                `/admin/families/${row.family_id}?yearId=${row.year_id}`
              )
            }
          />
          <RegistrationsGroup
            title="In Progress"
            description="Started the packet but not yet submitted."
            rows={visibleGroups.inProgress}
            isLoading={
              isLoading && filter !== "submitted" && filter !== "not_started"
            }
            error={error}
            columns={columns}
            tone="amber"
            onRowClick={(row) =>
              router.push(
                `/admin/families/${row.family_id}?yearId=${row.year_id}`
              )
            }
          />
          <RegistrationsGroup
            title="Not Started"
            description="Accepted but the family hasn't begun the packet."
            rows={visibleGroups.notStarted}
            isLoading={
              isLoading && filter !== "submitted" && filter !== "in_progress"
            }
            error={error}
            columns={columns}
            tone="slate"
            onRowClick={(row) =>
              router.push(
                `/admin/families/${row.family_id}?yearId=${row.year_id}`
              )
            }
          />
        </div>
      )}
    </div>
  );
}

function RegistrationsGroup({
  title,
  description,
  rows,
  isLoading,
  error,
  columns,
  tone,
  onRowClick,
}: {
  title: string;
  description: string;
  rows: RegStudentRow[];
  isLoading: boolean;
  error: unknown;
  columns: ColumnDef<RegStudentRow>[];
  tone: "blue" | "amber" | "slate";
  onRowClick: (row: RegStudentRow) => void;
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
        <DataTable<RegStudentRow>
          columns={columns}
          data={rows}
          isLoading={isLoading}
          searchPlaceholder={`Search ${title.toLowerCase()}…`}
          onRowClick={onRowClick}
        />
      </CardContent>
    </Card>
  );
}

function SectionDots({ row }: { row: RegStudentRow }) {
  const sections = [
    { key: "tuition", complete: row.isTuition, label: "Tuition" },
    {
      key: "enrollment",
      complete: row.isEnrollment,
      label: "Enrollment Agreement",
    },
    {
      key: "registration",
      complete: row.isRegistration,
      label: "Registration Packet",
    },
    {
      key: "volunteer",
      complete: row.isVolunteerHours,
      label: "Volunteer Hours",
    },
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

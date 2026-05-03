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

interface RegProgressRow {
  id: number;
  family_id: number;
  year_id: number;
  family_name: string;
  primary_name: string;
  primary_email: string;
  student_count: number;
  isTuition: boolean;
  isEnrollment: boolean;
  isRegistration: boolean;
  isVolunteerHours: boolean;
  sections_complete: number;
  sections_total: number;
  isSubmitted: boolean;
  submitted_date: number | null;
  last_edited: number | null;
  enrollment_agreement_status: string;
  is_enrollment_agreement_signed: boolean;
  [key: string]: unknown;
}

type ProgressFilter = "all" | "submitted" | "in_progress" | "not_started";

const FILTER_LABEL: Record<ProgressFilter, string> = {
  all: "All families",
  submitted: "Submitted",
  in_progress: "In progress",
  not_started: "Not started",
};

function deriveFilter(row: RegProgressRow): ProgressFilter {
  if (row.isSubmitted) return "submitted";
  if (row.sections_complete > 0) return "in_progress";
  return "not_started";
}

/**
 * Admin Registrations list — one row per family per year, backed by
 * `registration_student_registration_progress_by_year`. Mirrors the
 * Applications page in shape so the two surfaces feel like one product;
 * just swaps the four-section completion booleans (tuition / enrollment
 * agreement / registration packet / volunteer-hours acknowledgment) and
 * the click-through still routes to the family detail page.
 */
export default function RegistrationsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const yearId = searchParams.get("yearId");
  const [filter, setFilter] = useState<ProgressFilter>("all");

  const { data, isLoading, error } = useSWR<RegProgressRow[]>(
    yearId ? `/api/admin/registrations?yearId=${yearId}` : null,
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

  const columns: ColumnDef<RegProgressRow>[] = [
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
      key: "submitted_date",
      header: "Submitted",
      sortable: true,
      render: (row) =>
        row.submitted_date
          ? new Date(row.submitted_date).toLocaleDateString()
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
            One row per accepted family per academic year. Click into a
            family to see all post-acceptance sections (tuition,
            enrollment agreement, registration packet, volunteer hours)
            and edit values.
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
        <>
          <DataTable<RegProgressRow>
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
 * Four colored dots: one per registration section (Tuition, Enrollment
 * Agreement, Registration Packet, Volunteer Hours). Filled green when
 * complete, hollow gray when not. Same component shape as the
 * Applications page so the two tables read consistently.
 */
function SectionDots({ row }: { row: RegProgressRow }) {
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

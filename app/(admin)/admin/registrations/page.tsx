"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { CheckCircle2, Circle, ChevronRight, Inbox } from "lucide-react";
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
 * Admin Registrations list — one row per accepted student for the
 * selected year. Three tables (Submitted / In Progress / Not Started)
 * with shared column widths so the headers line up across groups.
 *
 * Cells are deliberately single-line + monochrome. Click into a row
 * to land on the family detail page where post-acceptance details
 * live.
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

  // Shared column shape across all three tables so widths line up
  // vertically — see the matching pattern on the Applications page.
  const columns: ColumnDef<RegStudentRow>[] = [
    {
      key: "student_full_name",
      header: "Student",
      sortable: true,
      searchable: true,
      width: "w-[24%]",
      render: (row) => (
        <span className="block truncate font-medium">
          {row.student_full_name}
        </span>
      ),
    },
    {
      key: "student_grade",
      header: "Grade",
      sortable: true,
      width: "w-[8%]",
      render: (row) => (
        <span className="block truncate">{row.student_grade || "—"}</span>
      ),
    },
    {
      key: "family_name",
      header: "Family",
      sortable: true,
      searchable: true,
      width: "w-[18%]",
      render: (row) => (
        <span className="block truncate">{row.family_name}</span>
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
      key: "sections_complete",
      header: "Packet",
      sortable: true,
      width: "w-[10%]",
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
      key: "enrollment_agreement_status",
      header: "Agreement",
      sortable: true,
      width: "w-[10%]",
      render: (row) => {
        const label = row.is_enrollment_agreement_signed
          ? "Signed"
          : row.enrollment_agreement_status === "sent"
            ? "Sent"
            : row.enrollment_agreement_status || "—";
        return (
          <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </span>
        );
      },
    },
    // Status column was removed — the surrounding section card already
    // names the bucket ("SUBMITTED", "IN PROGRESS", "NOT STARTED"), so
    // re-stamping every row with the same label is redundant noise.
    // The packet-section dots above carry the per-row nuance.
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

  // True empty state — neither loading nor an error, year is selected,
  // but there are zero accepted students for the year. Shown ONCE
  // (not per-group) since rendering three "no rows" placeholders
  // adds noise.
  const showEmptyState =
    !!yearId && !isLoading && !error && all.length === 0;

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
        <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
          Failed to load registrations:{" "}
          {error instanceof Error ? error.message : "unknown error"}
        </div>
      ) : null}

      {!yearId ? (
        <div className="rounded-lg border bg-white px-6 py-12 text-center text-sm text-muted-foreground">
          Pick a school year above to view its registrations.
        </div>
      ) : showEmptyState ? (
        <RegistrationsEmptyState />
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
            onRowClick={(row) =>
              router.push(
                `/admin/registrations/${row.family_id}?yearId=${row.year_id}`
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
            onRowClick={(row) =>
              router.push(
                `/admin/registrations/${row.family_id}?yearId=${row.year_id}`
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
            onRowClick={(row) =>
              router.push(
                `/admin/registrations/${row.family_id}?yearId=${row.year_id}`
              )
            }
          />
        </div>
      )}
    </div>
  );
}

/**
 * Shown when no students are accepted for the year yet. A registration
 * row only exists once an admin flips a per-student `isAccepted`, so
 * this state is "no acceptance decisions made yet" — the action the
 * admin needs to take is over on the Applications page.
 */
function RegistrationsEmptyState() {
  return (
    <Card className="bg-white">
      <CardContent className="py-16 px-6 text-center">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-muted">
          <Inbox className="size-6 text-muted-foreground" />
        </div>
        <h3 className="text-base font-semibold">No registrations yet</h3>
        <p className="mt-1 text-sm text-muted-foreground max-w-md mx-auto">
          A student appears here once they&rsquo;ve been accepted for
          this academic year. Head to <strong>Applications</strong> to
          review submitted apps and accept families.
        </p>
      </CardContent>
    </Card>
  );
}

function RegistrationsGroup({
  title,
  description,
  rows,
  isLoading,
  error,
  columns,
  onRowClick,
}: {
  title: string;
  description: string;
  rows: RegStudentRow[];
  isLoading: boolean;
  error: unknown;
  columns: ColumnDef<RegStudentRow>[];
  onRowClick: (row: RegStudentRow) => void;
}) {
  if (!isLoading && !error && rows.length === 0) return null;
  return (
    <Card className="overflow-hidden bg-white py-0 gap-0">
      <CardHeader className="py-4 border-b bg-white">
        <div className="flex items-baseline gap-3">
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

/**
 * Four packet-section dots — Tuition / Enrollment Agreement /
 * Registration Packet / Volunteer Hours. Green check on completion
 * matches the Applications page section pills; everything else stays
 * monochrome.
 */
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

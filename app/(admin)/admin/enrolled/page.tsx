"use client";

import { useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { ChevronRight, GraduationCap } from "lucide-react";
import { DataTable, type ColumnDef } from "@/components/admin/data-table";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { adminFetcher } from "@/lib/admin-fetcher";
import { formatRelativeShort } from "@/lib/format-note-time";
import type { EnrolledStudentRow } from "@/app/api/admin/enrolled/route";

/**
 * Order grades in the natural school sequence rather than
 * alphabetical. Numeric grades sort lowest-first; non-numeric
 * labels (e.g. "K", "Pre-K") drop to the end alphabetically — they
 * shouldn't appear in the SailFuture cohort but the fallback keeps
 * unexpected values rendering instead of crashing the sort.
 */
function gradeSortKey(grade: string): [number, string] {
  const trimmed = (grade ?? "").trim();
  if (!trimmed) return [Number.MAX_SAFE_INTEGER, "zz"];
  const n = Number(trimmed);
  if (Number.isFinite(n)) return [n, ""];
  return [Number.MAX_SAFE_INTEGER - 1, trimmed.toLowerCase()];
}

/**
 * Group enrolled students by their incoming grade level so admin
 * can scan cohort sizes and per-grade rosters at a glance. Returns
 * an ordered array (not a Map) so React render order is stable —
 * grouped lowest grade → highest, with unknown / blank grades at
 * the bottom under "No grade".
 */
function groupByGrade(
  rows: EnrolledStudentRow[]
): Array<{ grade: string; rows: EnrolledStudentRow[] }> {
  const buckets = new Map<string, EnrolledStudentRow[]>();
  for (const r of rows) {
    const key = (r.student_grade ?? "").trim() || "—";
    const arr = buckets.get(key) ?? [];
    arr.push(r);
    buckets.set(key, arr);
  }
  return Array.from(buckets.entries())
    .map(([grade, rs]) => ({
      grade,
      // Within each grade, alphabetical by last name then first name
      // so the roster reads like a class list.
      rows: rs.slice().sort((a, b) => {
        const last = a.student_last_name.localeCompare(b.student_last_name);
        if (last !== 0) return last;
        return a.student_first_name.localeCompare(b.student_first_name);
      }),
    }))
    .sort((a, b) => {
      const [aNum, aStr] = gradeSortKey(a.grade);
      const [bNum, bStr] = gradeSortKey(b.grade);
      if (aNum !== bNum) return aNum - bNum;
      return aStr.localeCompare(bStr);
    });
}

/**
 * Admin Enrolled Students list — one row per student whose
 * registration packet has been admin-confirmed
 * (`registrationConfirmed=true`) for the selected academic year.
 *
 * Grouped by incoming grade level so admin can scan cohort sizes
 * at a glance. Within each grade, students are ordered by last +
 * first name (class-list style).
 *
 * Click into a row to land on the per-student detail page where
 * admin can review only that student's information.
 *
 * Data source: `registration_student_registration` packets filtered
 * by `registrationConfirmed=true` for the year. We don't maintain a
 * separate `enrolled_students` table — confirmation is the single
 * boolean that means "this student is enrolled."
 */
export default function EnrolledStudentsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const yearId = searchParams.get("yearId");

  const { data, isLoading, error } = useSWR<EnrolledStudentRow[]>(
    yearId ? `/api/admin/enrolled?yearId=${yearId}` : null,
    adminFetcher
  );

  const rows = useMemo(() => (Array.isArray(data) ? data : []), [data]);
  const grouped = useMemo(() => groupByGrade(rows), [rows]);

  // Shared column shape across all grade groups so widths line up
  // vertically. `student_grade` column was dropped — the grade lives
  // in the group header now, and repeating it on every row was
  // redundant noise.
  const columns: ColumnDef<EnrolledStudentRow>[] = [
    {
      key: "student_full_name",
      header: "Student",
      sortable: true,
      searchable: true,
      width: "w-[28%]",
      render: (row) => (
        <span className="block truncate font-medium">
          {row.student_full_name}
        </span>
      ),
    },
    {
      key: "family_name",
      header: "Family",
      sortable: true,
      searchable: true,
      width: "w-[22%]",
      render: (row) => (
        <span className="block truncate">{row.family_name}</span>
      ),
    },
    {
      key: "primary_email",
      header: "Primary Contact",
      sortable: true,
      searchable: true,
      width: "w-[24%]",
      render: (row) => (
        <span className="block truncate">
          {row.primary_email || row.primary_name || "—"}
        </span>
      ),
    },
    {
      key: "confirmed_at",
      header: "Enrolled",
      sortable: true,
      width: "w-[10%]",
      // Compact relative timestamp ("2d", "May 2") matches the docs
      // review table's Time column. Hover title shows the absolute
      // timestamp.
      render: (row) => (
        <span
          className="text-sm tabular-nums text-muted-foreground"
          title={
            row.confirmed_at
              ? new Date(row.confirmed_at).toLocaleString()
              : undefined
          }
        >
          {formatRelativeShort(row.confirmed_at)}
        </span>
      ),
    },
    {
      key: "liability_waiver_status",
      header: "Waiver",
      sortable: true,
      width: "w-[10%]",
      render: (row) => {
        const label = row.liability_waiver_pdf_url
          ? "Signed"
          : row.liability_waiver_status
            ? formatPdStatus(row.liability_waiver_status)
            : "—";
        return (
          <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </span>
        );
      },
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

  const showEmptyState =
    !!yearId && !isLoading && !error && rows.length === 0;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Enrolled Students</h1>
        <p className="text-sm text-muted-foreground">
          Students whose registration packet has been admin-confirmed
          for the selected year, grouped by incoming grade. Click a
          row to see only that student&rsquo;s details.
        </p>
      </div>

      {error ? (
        <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
          Failed to load enrolled students:{" "}
          {error instanceof Error ? error.message : "unknown error"}
        </div>
      ) : null}

      {!yearId ? (
        <div className="rounded-lg border bg-white px-6 py-12 text-center text-sm text-muted-foreground">
          Pick a school year above to view enrolled students.
        </div>
      ) : showEmptyState ? (
        <EnrolledEmptyState />
      ) : (
        <div className="space-y-8">
          {grouped.map((group) => (
            <EnrolledGradeGroup
              key={group.grade}
              grade={group.grade}
              rows={group.rows}
              isLoading={isLoading}
              columns={columns}
              onRowClick={(row) =>
                router.push(
                  `/admin/enrolled/${row.student_id}?yearId=${row.year_id}`
                )
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Empty state — no enrolled students for the year yet. The action
 * the admin needs to take is over on the Registrations page: review
 * each family's packet and flip `registrationConfirmed` per student.
 */
function EnrolledEmptyState() {
  return (
    <Card className="bg-white">
      <CardContent className="py-16 px-6 text-center">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-muted">
          <GraduationCap className="size-6 text-muted-foreground" />
        </div>
        <h3 className="text-base font-semibold">No enrolled students yet</h3>
        <p className="mt-1 text-sm text-muted-foreground max-w-md mx-auto">
          A student appears here once their registration packet is
          confirmed. Head to <strong>Registrations</strong> to review
          and confirm packets per student.
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * One grade-level group on the Enrolled page. Same chrome as the
 * Registrations groups (uppercase tracking-wide title + count
 * badge + description) so the two pages feel like the same product.
 *
 * "Grade —" renders for students whose `current_grade` is empty;
 * shouldn't happen in the cohort but the fallback keeps the
 * surface defensive against missing data.
 */
function EnrolledGradeGroup({
  grade,
  rows,
  isLoading,
  columns,
  onRowClick,
}: {
  grade: string;
  rows: EnrolledStudentRow[];
  isLoading: boolean;
  columns: ColumnDef<EnrolledStudentRow>[];
  onRowClick: (row: EnrolledStudentRow) => void;
}) {
  return (
    <Card className="overflow-hidden bg-white py-0 gap-0">
      <CardHeader className="py-4 border-b bg-white">
        <div className="flex items-baseline gap-3">
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Grade {grade}
          </CardTitle>
          <span className="text-xs tabular-nums text-muted-foreground">
            ({rows.length})
          </span>
        </div>
      </CardHeader>
      <CardContent className="p-4 bg-white">
        <DataTable<EnrolledStudentRow>
          columns={columns}
          data={rows}
          isLoading={isLoading}
          searchPlaceholder={`Search Grade ${grade}…`}
          onRowClick={onRowClick}
        />
      </CardContent>
    </Card>
  );
}

/**
 * Shared with the family registration detail page: turns a raw
 * PandaDoc status ("document.completed") into a friendly label
 * ("Completed"). Inlined here rather than imported because the
 * detail page's helper is not exported and the rule for both
 * surfaces is identical.
 */
function formatPdStatus(status: string): string {
  const cleaned = status.replace(/^document\./, "").replace(/_/g, " ");
  if (!cleaned) return status;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

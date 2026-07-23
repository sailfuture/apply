"use client";

import { Fragment, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import {
  Activity,
  ChevronRight,
  GraduationCap,
  Search,
} from "lucide-react";
import { ActivityLogSheet } from "@/components/admin/activity-log-sheet";
import { Button } from "@/components/ui/button";
import type { ColumnDef } from "@/components/admin/data-table";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { adminFetcher } from "@/lib/admin-fetcher";
import { formatRelativeShort } from "@/lib/format-note-time";
import { formatUSPhone } from "@/lib/phone";
import { EnrolledExportDialog } from "@/components/admin/enrolled-export-dialog";
import type { EnrolledStudentRow } from "@/app/api/admin/enrolled/route";

/**
 * Order grades in the natural school sequence rather than
 * alphabetical. Parses a leading integer so the admin grade levels
 * "8th", "9th", "10th"… sort numerically (8 < 9 < 10 < 11 < 12)
 * rather than as strings ("10th" before "8th"); bare numeric grades
 * ("9") still work. Non-numeric labels (e.g. "K", "Pre-K") and the
 * blank "—" bucket drop to the end so unexpected values keep
 * rendering instead of crashing the sort.
 */
function gradeSortKey(grade: string): [number, string] {
  const trimmed = (grade ?? "").trim();
  if (!trimmed || trimmed === "—") return [Number.MAX_SAFE_INTEGER, "zz"];
  const n = parseInt(trimmed, 10);
  if (Number.isFinite(n)) return [n, ""];
  return [Number.MAX_SAFE_INTEGER - 1, trimmed.toLowerCase()];
}

/**
 * Group enrolled students by their admin-assigned grade level
 * (the placement field set on the student detail page) so admin can
 * scan cohort sizes and per-grade rosters at a glance. Returns an
 * ordered array (not a Map) so React render order is stable —
 * grouped lowest grade → highest, with students whose grade level
 * hasn't been set yet collected at the bottom under "No grade level
 * set".
 */
function groupByGrade(
  rows: EnrolledStudentRow[]
): Array<{ grade: string; rows: EnrolledStudentRow[] }> {
  const buckets = new Map<string, EnrolledStudentRow[]>();
  for (const r of rows) {
    const key = (r.grade_level ?? "").trim() || "—";
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
 * Grouped by the admin-assigned grade level (the placement field on
 * the student detail page) so admin can scan cohort sizes at a
 * glance. Within each grade, students are ordered by last + first
 * name (class-list style). Students whose grade level hasn't been
 * set yet collect under a "No grade level set" group at the bottom.
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

  // School-year row for the title — gives us `year_name` so the page
  // header reads "Enrolled Students · 2025-2026". Fetched separately
  // from the roster so a slow-loading roster doesn't keep the title
  // generic.
  const { data: schoolYear } = useSWR<{
    id: number;
    year_name: string;
  } | null>(
    yearId ? `/api/admin/school-years/${yearId}` : null,
    adminFetcher
  );

  const rows = useMemo(() => (Array.isArray(data) ? data : []), [data]);

  // Two top-level groups: currently enrolled, and formerly
  // enrolled but later unenrolled. We deliberately exclude the
  // "accepted but never made it through registration" cohort from
  // this surface — those students belong in the application /
  // registration queues, not in the enrolled roster. The unenrolled
  // bucket has to stay visible so admin can find historical records
  // for students who left mid-year.
  const enrolledRows = useMemo(
    () => rows.filter((r) => r.is_enrolled === true),
    [rows]
  );
  const unenrolledRows = useMemo(
    () => rows.filter((r) => r.is_archived === true),
    [rows]
  );
  const groupedEnrolled = useMemo(
    () => groupByGrade(enrolledRows),
    [enrolledRows]
  );
  const groupedUnenrolled = useMemo(
    () => groupByGrade(unenrolledRows),
    [unenrolledRows]
  );

  // Shared column shape across all grade groups so widths line up
  // vertically. The trash-icon column moved off this table — the
  // Remove + Unenroll affordances now live on the student detail
  // page next to Edit, so admin commits to those actions only
  // after reading the full student context rather than swiping at
  // the list. Grade column added back as a sortable column so a
  // flat "All grades" view (search filter spanning grade groups)
  // still surfaces the grade alongside the student name.
  const [activityFamily, setActivityFamily] = useState<number | null>(null);
  // Page-level search — ONE bar under the header filters both roster
  // cards (enrolled + unenrolled) at once.
  const [search, setSearch] = useState("");
  // Row-click quick-detail sheet (contact info + required documents).
  const [sheetRow, setSheetRow] = useState<EnrolledStudentRow | null>(null);

  const columns: ColumnDef<EnrolledStudentRow>[] = [
    {
      key: "student_full_name",
      header: "Student",
      sortable: true,
      searchable: true,
      width: "w-[26%]",
      // Name click = full student page; the ROW click opens the
      // quick-detail sheet, so this stops propagation.
      render: (row) => (
        <button
          type="button"
          className="block max-w-full truncate text-left font-medium hover:underline"
          onClick={(e) => {
            e.stopPropagation();
            router.push(
              `/admin/enrolled/${row.student_id}?yearId=${row.year_id}`
            );
          }}
        >
          {row.student_full_name}
        </button>
      ),
    },
    {
      key: "grade_level",
      header: "Grade",
      sortable: true,
      searchable: true,
      width: "w-[8%]",
      render: (row) => (
        <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {row.grade_level?.trim() || "—"}
        </span>
      ),
    },
    {
      key: "family_name",
      header: "Family",
      sortable: true,
      searchable: true,
      width: "w-[20%]",
      render: (row) => (
        <span className="block truncate">{row.family_name}</span>
      ),
    },
    {
      key: "primary_email",
      header: "Primary Contact",
      sortable: true,
      searchable: true,
      width: "w-[22%]",
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
        // "Signed" and PandaDoc's "Completed" are the same done-state
        // (completed = every signer finished) — collapse both to ONE
        // green "Signed" pill so the column reads a single vocabulary.
        const status = (row.liability_waiver_status ?? "")
          .toString()
          .toLowerCase();
        const signed =
          Boolean(row.liability_waiver_pdf_url) ||
          status === "completed" ||
          status === "signed" ||
          status === "document.completed";
        const label = signed
          ? "Signed"
          : row.liability_waiver_status
            ? formatPdStatus(row.liability_waiver_status)
            : "—";
        return (
          <span
            className={
              signed
                ? "inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-800"
                : "inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground"
            }
          >
            {label}
          </span>
        );
      },
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
          aria-label="Family activity"
          onClick={(e) => {
            e.stopPropagation();
            setActivityFamily(Number(row.family_id) || null);
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

  const showEmptyState =
    !!yearId && !isLoading && !error && rows.length === 0;

  return (
    <div className="p-6 space-y-6">
      {/* Shared controlled Activity sheet for the per-row triggers. */}
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

      {/* Row-click quick detail — contact info + required documents. */}
      {sheetRow ? (
        <StudentDetailSheet
          key={sheetRow.student_id}
          row={sheetRow}
          onClose={() => setSheetRow(null)}
          onOpenFull={() => {
            router.push(
              `/admin/enrolled/${sheetRow.student_id}?yearId=${sheetRow.year_id}`
            );
          }}
        />
      ) : null}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">
            Enrolled Students
            {schoolYear?.year_name ? (
              <span className="ml-2 text-base font-normal text-muted-foreground">
                &middot; {schoolYear.year_name}
              </span>
            ) : null}
          </h1>
          <p className="text-sm text-muted-foreground">
            Currently enrolled students for the selected year, plus
            any students who were previously enrolled and have since
            been unenrolled. Students who never finished registration
            are tracked in the application + registration queues, not
            here. Click any row to see only that student&rsquo;s
            details.
          </p>
        </div>
      </div>

      {/* Search + export — one full-width row under the header,
          spanning the same width as the roster cards below. The
          search filters both cards. */}
      {yearId ? (
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground/60" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search enrolled students…"
              className="pl-9 bg-white"
            />
          </div>
          <EnrolledExportDialog
            yearId={Number(yearId)}
            yearName={schoolYear?.year_name}
          />
        </div>
      ) : null}

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
      ) : isLoading && !data ? (
        // Page-level skeleton for the first load — a single card
        // shell with a stripe of skeleton rows, matching the
        // unified table below. Tells admin "the data is shaped
        // like this" while the SWR fetch resolves.
        <EnrolledListSkeleton />
      ) : showEmptyState ? (
        <EnrolledEmptyState />
      ) : (
        <div className="space-y-6">
          {/* Enrolled group — students with `is_enrolled === true`,
              the standard "officially enrolled" cohort. Always
              renders even when empty so admin sees the header. */}
          <EnrolledRoster
            title="Enrolled"
            description="Students with registration packets confirmed by admin."
            columns={columns}
            grouped={groupedEnrolled}
            totalCount={enrolledRows.length}
            search={search}
            emptyLabel="No students officially enrolled for this year yet."
            onRowClick={(row) => setSheetRow(row)}
          />
          {/* Unenrolled group — students who were officially
              enrolled at some point and have since been unenrolled
              via the Unenroll modal (sets `isArchived=true`).
              Renders only when there are rows in this bucket; an
              empty bucket is the healthy steady state for most
              years. Never-enrolled students are intentionally
              excluded from this surface — they live in the
              application / registration queues. */}
          {unenrolledRows.length > 0 ? (
            <EnrolledRoster
              title="Unenrolled"
              description="Students who were enrolled at some point this year and have since been formally unenrolled."
              columns={columns}
              grouped={groupedUnenrolled}
              totalCount={unenrolledRows.length}
              search={search}
              emptyLabel="No students in this bucket."
              onRowClick={(row) => setSheetRow(row)}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

/**
 * Unified roster — one card, one table, with grade-level header
 * rows interspersed between the per-grade student rows. Total
 * enrolled count renders as a footer row at the very bottom so
 * admin sees the cohort size without scanning the per-group
 * counts.
 *
 * Renders via shadcn `<Table>` primitives directly (rather than
 * the DataTable component) because we need to splice non-data
 * rows (group headers + footer total) into the body — DataTable's
 * row loop doesn't model that.
 */
function EnrolledRoster({
  title,
  description,
  columns,
  grouped,
  totalCount,
  search,
  emptyLabel,
  onRowClick,
}: {
  /** Page-level search value — one bar above the cards drives both
   *  rosters. */
  search: string;
  /** Card header label — "Enrolled" or "Unenrolled" so the page
   *  can render two stacked rosters with the same chrome. */
  title: string;
  /** One-liner explaining what's in this bucket. Sits under the
   *  card header and helps admin orient when there are zero
   *  matches in the search filter. */
  description: string;
  columns: ColumnDef<EnrolledStudentRow>[];
  grouped: Array<{ grade: string; rows: EnrolledStudentRow[] }>;
  totalCount: number;
  /** Copy for the zero-rows state inside this card (distinct from
   *  the page-level "no enrolled students yet" empty state). */
  emptyLabel: string;
  onRowClick: (row: EnrolledStudentRow) => void;
}) {
  const colCount = columns.length;
  // Filter each grade group's rows by the search query, then
  // drop any groups that have zero matches so empty grade
  // sections don't render. Matches against student name +
  // family name + primary contact + grade — the same fields
  // admin's eye scans when looking for a specific row.
  const visibleGrouped = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return grouped;
    const filterRow = (r: EnrolledStudentRow) =>
      `${r.student_full_name} ${r.family_name} ${r.primary_email ?? ""} ${r.primary_name ?? ""} ${r.grade_level}`
        .toLowerCase()
        .includes(q);
    return grouped
      .map((g) => ({ ...g, rows: g.rows.filter(filterRow) }))
      .filter((g) => g.rows.length > 0);
  }, [grouped, search]);
  const visibleCount = useMemo(
    () => visibleGrouped.reduce((acc, g) => acc + g.rows.length, 0),
    [visibleGrouped]
  );
  return (
    <Card className="overflow-hidden bg-white py-0 gap-0">
      <CardHeader className="py-4 border-b bg-white space-y-1">
        <div className="flex items-baseline gap-3">
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            {title}
          </CardTitle>
          <span className="text-xs tabular-nums text-muted-foreground">
            ({totalCount})
          </span>
        </div>
        <p className="text-xs text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent className="p-6 bg-white space-y-3">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {columns.map((col) => (
                <TableHead
                  key={col.key}
                  className={cn(
                    "text-[10px] uppercase tracking-wider text-muted-foreground",
                    col.width,
                    col.align === "right" && "text-right",
                    col.align === "center" && "text-center"
                  )}
                >
                  {col.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleGrouped.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell
                  colSpan={colCount}
                  className="py-8 text-center text-sm italic text-muted-foreground"
                >
                  {search.trim()
                    ? `No students match "${search}".`
                    : emptyLabel}
                </TableCell>
              </TableRow>
            ) : (
              visibleGrouped.map((group) => (
                <Fragment key={group.grade}>
                  {/* Group header row — full-width banner introducing
                      the grade. `colSpan` covers every column so the
                      label reads as one bar across the table. */}
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableCell
                      colSpan={colCount}
                      className="py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                    >
                      {group.grade === "—"
                        ? "No grade level set"
                        : `${group.grade} Grade`}
                      <span className="ml-2 normal-case tabular-nums text-muted-foreground/70">
                        ({group.rows.length})
                      </span>
                    </TableCell>
                  </TableRow>
                  {group.rows.map((row) => (
                    <TableRow
                      key={row.id}
                      onClick={() => onRowClick(row)}
                      className="cursor-pointer"
                    >
                      {columns.map((col) => (
                        <TableCell
                          key={col.key}
                          className={cn(
                            "text-sm",
                            col.align === "right" && "text-right",
                            col.align === "center" && "text-center"
                          )}
                        >
                          {col.render
                            ? col.render(row)
                            : (row[col.key] as React.ReactNode) ?? "—"}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </Fragment>
              ))
            )}
            {/* Total row — bookends the table so the bucket size
                is the last thing admin sees. When a search is
                active, the row shows the filtered count alongside
                the total so admin sees both at a glance. Label is
                "Total" rather than "Total enrolled" because the
                page now stacks two rosters and "enrolled" doesn't
                apply to the Unenrolled bucket. */}
            <TableRow className="bg-muted/30 hover:bg-muted/30 border-t-2">
              <TableCell
                colSpan={colCount}
                className="py-3 text-sm font-semibold text-foreground"
              >
                Total
                <span className="ml-2 tabular-nums text-muted-foreground">
                  {search.trim() && visibleCount !== totalCount
                    ? `${visibleCount} of ${totalCount}`
                    : totalCount}
                </span>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

/**
 * First-paint skeleton — three stacked grade-group cards with a
 * stripey body underneath. Matches `EnrolledGradeGroup` so the
 * load-to-data transition doesn't shift layout. Three groups is
 * the typical cohort shape; rendering fewer feels sparse,
 * rendering more pushes content below the fold.
 */
function EnrolledListSkeleton() {
  return (
    <div className="space-y-8">
      {[0, 1, 2].map((i) => (
        <Card key={i} className="overflow-hidden bg-white py-0 gap-0">
          <CardHeader className="py-4 border-b bg-white">
            <div className="flex items-baseline gap-3">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-6" />
            </div>
          </CardHeader>
          <CardContent className="p-4 bg-white space-y-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </CardContent>
        </Card>
      ))}
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

/**
 * Row-click quick detail — the student's contact essentials and the
 * four required documents, without leaving the roster. The student
 * NAME in the table (and the button here) goes to the full page.
 */
function StudentDetailSheet({
  row,
  onClose,
  onOpenFull,
}: {
  row: EnrolledStudentRow;
  onClose: () => void;
  onOpenFull: () => void;
}) {
  const docs = [
    {
      label: "Birth certificate",
      submitted: row.doc_birth_certificate_submitted,
      approved: row.doc_birth_certificate_approved,
    },
    {
      label: "School health form",
      submitted: row.doc_school_health_form_submitted,
      approved: row.doc_school_health_form_approved,
    },
    {
      label: "Transcripts",
      submitted: row.doc_transcripts_submitted,
      approved: row.doc_transcripts_approved,
    },
    {
      label: "Immunization forms",
      submitted: row.doc_immunization_submitted,
      approved: row.doc_immunization_approved,
    },
  ];
  const waiverStatus = (row.liability_waiver_status ?? "")
    .toString()
    .toLowerCase();
  const waiverSigned =
    Boolean(row.liability_waiver_pdf_url) ||
    waiverStatus === "completed" ||
    waiverStatus === "signed" ||
    waiverStatus === "document.completed";

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-y-auto overscroll-contain p-0 sm:max-w-lg"
      >
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle className="text-base">
            {row.student_full_name}
          </SheetTitle>
          <SheetDescription className="text-xs">
            {row.grade_level?.trim() || row.student_grade || "No grade set"}
            {" · "}
            {row.family_name}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5 px-4 py-4">
          <section className="space-y-2.5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Contact
            </h3>
            <SheetDetailRow label="Family" value={row.family_name} />
            <SheetDetailRow
              label="Primary parent"
              value={row.primary_name}
            />
            <SheetDetailRow
              label="Email"
              value={
                row.primary_email ? (
                  <a
                    href={`mailto:${row.primary_email}`}
                    className="hover:underline"
                  >
                    {row.primary_email}
                  </a>
                ) : null
              }
            />
            <SheetDetailRow
              label="Phone"
              value={
                row.primary_phone ? (
                  <a
                    href={`tel:${row.primary_phone}`}
                    className="tabular-nums hover:underline"
                  >
                    {formatUSPhone(row.primary_phone) || row.primary_phone}
                  </a>
                ) : null
              }
            />
            <SheetDetailRow
              label="Date of birth"
              value={row.student_dob}
            />
          </section>

          <section className="space-y-2.5 border-t pt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Required documents
            </h3>
            <ul className="space-y-1.5">
              {docs.map((d) => (
                <li
                  key={d.label}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <span>{d.label}</span>
                  {d.approved ? (
                    <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-800">
                      Approved
                    </span>
                  ) : d.submitted ? (
                    <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-blue-800">
                      Submitted
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      Missing
                    </span>
                  )}
                </li>
              ))}
            </ul>
            <SheetDetailRow
              label="Liability waiver"
              value={
                waiverSigned ? (
                  <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-800">
                    Signed
                  </span>
                ) : (
                  row.liability_waiver_status || "Not sent"
                )
              }
            />
          </section>

          <div className="border-t pt-4">
            <Button size="sm" className="w-full" onClick={onOpenFull}>
              Open full student page
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function SheetDetailRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode | null;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right font-medium">
        {value || (
          <span className="font-normal text-muted-foreground">—</span>
        )}
      </span>
    </div>
  );
}

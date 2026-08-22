"use client";

import { Fragment, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import {
  Activity,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  ChevronUp,
  FileDown,
  GraduationCap,
  Loader2,
  Printer,
  Search,
} from "lucide-react";
import { toast } from "sonner";
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
import { SchoolAccountBackfillDialog } from "@/components/admin/school-account-backfill-dialog";
import { SyncToddleButton } from "@/components/admin/sync-toddle-button";
import { ToddleSyncAllDialog } from "@/components/admin/toddle-sync-all-dialog";
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
/** Row-vs-search-text match — one predicate shared by the page-level
 *  IEP download count and each roster card's filtering so the two can
 *  never disagree about what "currently shown" means. */
function matchesEnrolledSearch(r: EnrolledStudentRow, q: string): boolean {
  return `${r.student_full_name} ${r.family_name} ${r.primary_email ?? ""} ${r.primary_name ?? ""} ${r.grade_level} ${r.enrolled_year_name ?? ""}`
    .toLowerCase()
    .includes(q);
}

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

  const allRows = useMemo(() => (Array.isArray(data) ? data : []), [data]);

  // Cohort filter — "new" = the student's first year (derived cross-
  // year server-side as `enrolled_year_id`) IS the selected year;
  // "returning" = they started in an earlier year. Lets admin split
  // incoming students from returners without exporting first.
  const [cohortFilter, setCohortFilter] = useState<
    "all" | "new" | "returning"
  >("all");
  // IEP chip — only students with at least one uploaded IEP document.
  const [iepOnly, setIepOnly] = useState(false);

  const rows = useMemo(
    () =>
      allRows.filter((r) => {
        if (cohortFilter === "new" && r.enrolled_year_id !== r.year_id) {
          return false;
        }
        if (
          cohortFilter === "returning" &&
          r.enrolled_year_id === r.year_id
        ) {
          return false;
        }
        if (iepOnly && !r.has_iep) return false;
        return true;
      }),
    [allRows, cohortFilter, iepOnly]
  );

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

  // Batch IEP download — zips the actual IEP files for every ENROLLED
  // student currently shown (cohort/IEP chips + search all apply), so
  // "filter to Crew of interest, download their IEPs" works in two
  // clicks. Unenrolled students are deliberately excluded.
  const [downloadingIeps, setDownloadingIeps] = useState(false);
  const iepCandidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    return enrolledRows.filter(
      (r) => r.has_iep && (!q || matchesEnrolledSearch(r, q))
    );
  }, [enrolledRows, search]);

  async function downloadIeps() {
    if (downloadingIeps || iepCandidates.length === 0) return;
    setDownloadingIeps(true);
    try {
      const res = await fetch("/api/admin/enrolled/iep-export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentIds: iepCandidates.map((r) => r.student_id),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? `Download failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const slug = (schoolYear?.year_name ?? `year-${yearId}`)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");
      anchor.href = url;
      anchor.download = `iep-documents-${slug || yearId}.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      toast.success(
        `Downloaded IEP files for ${iepCandidates.length} student${iepCandidates.length === 1 ? "" : "s"}.`
      );
    } catch (err) {
      console.error("[downloadIeps] failed:", err);
      toast.error(
        err instanceof Error ? err.message : "Couldn't download IEP files."
      );
    } finally {
      setDownloadingIeps(false);
    }
  }

  // Printable sign-in sheets — one branded page per student carrying
  // their school email + password, for handing out on the first day.
  // Downloads a zip organized into one folder per crew, each holding
  // that crew's whole stack as a single printable PDF.
  // Same "every ENROLLED student currently shown" contract as the IEP
  // download above, narrowed further to students who actually have an
  // account generated (the rest need "Create Student Emails" first).
  const [printingLogins, setPrintingLogins] = useState(false);
  const loginCandidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    return enrolledRows.filter(
      (r) => r.has_school_account && (!q || matchesEnrolledSearch(r, q))
    );
  }, [enrolledRows, search]);
  // Shown students still missing an account — drives the button's
  // hover text so a short stack is explained before it prints.
  const missingLoginCount = useMemo(() => {
    const q = search.trim().toLowerCase();
    return enrolledRows.filter(
      (r) => !r.has_school_account && (!q || matchesEnrolledSearch(r, q))
    ).length;
  }, [enrolledRows, search]);

  async function downloadLogins() {
    if (printingLogins || loginCandidates.length === 0) return;
    setPrintingLogins(true);
    try {
      const res = await fetch("/api/admin/enrolled/credential-cards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentIds: loginCandidates.map((r) => r.student_id),
          yearId: Number(yearId),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? `Download failed (${res.status})`);
      }
      const skipped = Number(res.headers.get("X-Skipped-Count") ?? 0);
      const crews = Number(res.headers.get("X-Crew-Count") ?? 0);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const slug = (schoolYear?.year_name ?? `year-${yearId}`)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");
      anchor.href = url;
      anchor.download = `student-logins-${slug || yearId}.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      const printed = loginCandidates.length - skipped;
      toast.success(
        `Downloaded sign-in sheets for ${printed} student${printed === 1 ? "" : "s"}${
          crews > 0 ? ` in ${crews} crew folder${crews === 1 ? "" : "s"}` : ""
        }.${
          skipped > 0
            ? ` ${skipped} skipped — no school account on file.`
            : ""
        }`
      );
    } catch (err) {
      console.error("[downloadLogins] failed:", err);
      toast.error(
        err instanceof Error
          ? err.message
          : "Couldn't build the sign-in sheets."
      );
    } finally {
      setPrintingLogins(false);
    }
  }

  const columns: ColumnDef<EnrolledStudentRow>[] = [
    {
      key: "student_full_name",
      header: "Student",
      sortable: true,
      searchable: true,
      width: "w-[22%]",
      // Sort on last-then-first so the ordering reads like a class
      // list, matching how the grade groups already order themselves.
      accessor: (row) =>
        `${row.student_last_name} ${row.student_first_name}`.trim(),
      // Name click = full student page; the ROW click opens the
      // quick-detail sheet, so this stops propagation.
      render: (row) => (
        <button
          type="button"
          className="block max-w-full truncate text-left font-medium hover:underline"
          onClick={(e) => {
            e.stopPropagation();
            router.push(
              // familyId lets the detail page paint its family nav
              // band before its payload lands.
              `/admin/enrolled/${row.student_id}?yearId=${row.year_id}${
                Number(row.family_id) > 0 ? `&familyId=${row.family_id}` : ""
              }`
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
      // Numeric key so a flat sort puts 8th before 10th — the same
      // ordering `groupByGrade` applies to the group headers.
      accessor: (row) => gradeSortKey(row.grade_level?.trim() || "—")[0],
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
      width: "w-[18%]",
      // Family click = family overview page; stops propagation for
      // the same reason as the student-name link above. Legacy rows
      // without a family id fall back to plain text.
      render: (row) =>
        Number(row.family_id) > 0 ? (
          <button
            type="button"
            className="block max-w-full truncate text-left hover:underline"
            onClick={(e) => {
              e.stopPropagation();
              router.push(
                `/admin/families/${row.family_id}/overview?yearId=${row.year_id}`
              );
            }}
          >
            {row.family_name}
          </button>
        ) : (
          <span className="block truncate">{row.family_name}</span>
        ),
    },
    {
      key: "primary_email",
      header: "Primary Contact",
      sortable: true,
      searchable: true,
      width: "w-[18%]",
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
      key: "enrolled_year_name",
      header: "First Enrolled",
      sortable: true,
      searchable: true,
      width: "w-[10%]",
      // The student's cohort year — the year they FIRST enrolled,
      // which is usually earlier than the year this roster is scoped
      // to. Sorts on the numeric `enrolled_year_sort` (epoch ms of
      // the year's start) rather than the label, so unknown years
      // sink instead of leading with "—".
      accessor: (row) => row.enrolled_year_sort,
      render: (row) => (
        <span
          className="text-sm tabular-nums text-muted-foreground"
          title={
            row.enrolled_year_basis === "confirmed"
              ? "First year with an admin-confirmed registration packet."
              : "No confirmed registration packet on file — showing their earliest application year instead."
          }
        >
          {row.enrolled_year_name || "—"}
          {/* Soft-signal marker. A derived cohort year that came from
              an application rather than a confirmed packet is a
              guess, and admin sorting a roster by it deserves to see
              which rows are guesses without hovering every cell. */}
          {row.enrolled_year_basis === "application" ? (
            <span className="ml-0.5 text-muted-foreground/60">*</span>
          ) : null}
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

  // Empty state only when the YEAR has no rows — a cohort/IEP filter
  // that matches nothing should render the (empty) roster cards, not
  // the "no enrolled students" hero.
  const showEmptyState =
    !!yearId && !isLoading && !error && allRows.length === 0;

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
              `/admin/enrolled/${sheetRow.student_id}?yearId=${sheetRow.year_id}${
                Number(sheetRow.family_id) > 0
                  ? `&familyId=${sheetRow.family_id}`
                  : ""
              }`
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
        <>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground/60" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search enrolled students…"
                type="search"
                autoComplete="off"
                className="pl-9 bg-white"
              />
            </div>
            {/* Bulk school-account backfill — year-independent (it
                covers every enrolled student), but it lives here next
                to Export since this is the enrolled-roster home. */}
            <SchoolAccountBackfillDialog />
            {/* Bulk Toddle push — the per-student Sync to Toddle,
                run across the whole enrolled roster. */}
            <ToddleSyncAllDialog />
            <Button
              variant="outline"
              className="bg-white shrink-0"
              disabled={downloadingIeps || iepCandidates.length === 0}
              onClick={() => void downloadIeps()}
              title={
                iepCandidates.length === 0
                  ? "No shown enrolled students have IEP documents on file"
                  : "Download a zip of the IEP documents for every enrolled student currently shown"
              }
            >
              {downloadingIeps ? (
                <Loader2
                  className="size-3.5 mr-1.5 animate-spin"
                  aria-hidden="true"
                />
              ) : (
                <FileDown className="size-3.5 mr-1.5" aria-hidden="true" />
              )}
              IEP files
              {iepCandidates.length > 0 ? ` (${iepCandidates.length})` : ""}
            </Button>
            {/* Printable student sign-in sheets — one branded page per
                student with their school email + password. */}
            <Button
              variant="outline"
              size="sm"
              className="bg-white shrink-0"
              disabled={printingLogins || loginCandidates.length === 0}
              onClick={() => void downloadLogins()}
              title={
                loginCandidates.length === 0
                  ? 'No shown enrolled students have a school account yet — run "Create Student Emails" first'
                  : `Download a zip of printable sign-in pages, one folder per crew${
                      missingLoginCount > 0
                        ? ` (${missingLoginCount} shown student${
                            missingLoginCount === 1 ? "" : "s"
                          } still need an account generated)`
                        : ""
                    }`
              }
            >
              {printingLogins ? (
                <Loader2
                  className="size-3.5 mr-1.5 animate-spin"
                  aria-hidden="true"
                />
              ) : (
                <Printer className="size-3.5 mr-1.5" aria-hidden="true" />
              )}
              Sign-in sheets
              {loginCandidates.length > 0 ? ` (${loginCandidates.length})` : ""}
            </Button>
            <EnrolledExportDialog
              yearId={Number(yearId)}
              yearName={schoolYear?.year_name}
            />
          </div>

          {/* Cohort + IEP narrowing chips — applied before the
              enrolled/unenrolled split so both cards reflect them. */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Cohort
            </span>
            {(
              [
                { value: "all", label: "All" },
                { value: "new", label: "New this year" },
                { value: "returning", label: "Returning" },
              ] as const
            ).map((c) => {
              const on = cohortFilter === c.value;
              return (
                <button
                  key={c.value}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setCohortFilter(c.value)}
                  className={cn(
                    "rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
                    on
                      ? "border-foreground bg-foreground text-background"
                      : "border-border bg-white text-muted-foreground hover:border-foreground/40 hover:text-foreground"
                  )}
                >
                  {c.label}
                </button>
              );
            })}
            <span className="mx-1 h-4 w-px bg-border" aria-hidden />
            <button
              type="button"
              aria-pressed={iepOnly}
              onClick={() => setIepOnly((v) => !v)}
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
                iepOnly
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-white text-muted-foreground hover:border-foreground/40 hover:text-foreground"
              )}
              title="Only students with at least one uploaded IEP document"
            >
              Has IEP
            </button>
          </div>
        </>
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
  // Active column sort, or `null` for the default grade grouping.
  // Per-roster state: sorting the Enrolled card shouldn't reorder
  // the Unenrolled one underneath it.
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(
    null
  );
  /** Header click cycles asc → desc → off, so the third click puts
   *  the grade grouping back without hunting for a reset control. */
  function toggleSort(key: string) {
    setSort((cur) => {
      if (!cur || cur.key !== key) return { key, dir: "asc" };
      if (cur.dir === "asc") return { key, dir: "desc" };
      return null;
    });
  }
  // Filter each grade group's rows by the search query, then
  // drop any groups that have zero matches so empty grade
  // sections don't render. Matches against student name +
  // family name + primary contact + grade + cohort year — the
  // same fields admin's eye scans when looking for a specific row.
  const visibleGrouped = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return grouped;
    return grouped
      .map((g) => ({
        ...g,
        rows: g.rows.filter((r) => matchesEnrolledSearch(r, q)),
      }))
      .filter((g) => g.rows.length > 0);
  }, [grouped, search]);
  const visibleCount = useMemo(
    () => visibleGrouped.reduce((acc, g) => acc + g.rows.length, 0),
    [visibleGrouped]
  );
  // A column sort is necessarily global, so it dissolves the grade
  // grouping — you can't order the whole roster by cohort year while
  // still penning each student inside their grade bucket. When a
  // sort is active the table renders one flat list instead, and the
  // Grade column carries the grade that the group headers used to.
  // `null` here means "no sort active" → keep the grouped render.
  const sortedFlat = useMemo(() => {
    if (!sort) return null;
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return null;
    const valueOf = (row: EnrolledStudentRow) =>
      col.accessor
        ? col.accessor(row)
        : (row[col.key] as string | number | null | undefined);
    const dir = sort.dir === "asc" ? 1 : -1;
    return visibleGrouped
      .flatMap((g) => g.rows)
      .slice()
      .sort((a, b) => {
        const av = valueOf(a);
        const bv = valueOf(b);
        // Blanks sink to the bottom in BOTH directions — an empty
        // cell is never the "most" of anything, and flipping them to
        // the top on a desc sort just buries the real data.
        const aEmpty = av === null || av === undefined || av === "";
        const bEmpty = bv === null || bv === undefined || bv === "";
        if (aEmpty !== bEmpty) return aEmpty ? 1 : -1;
        if (!aEmpty && !bEmpty) {
          if (typeof av === "number" && typeof bv === "number") {
            if (av !== bv) return (av - bv) * dir;
          } else {
            const cmp = String(av).localeCompare(String(bv), undefined, {
              numeric: true,
            });
            if (cmp !== 0) return cmp * dir;
          }
        }
        // Ties (a whole cohort year, a whole grade) fall back to the
        // class-list order rather than whatever the fetch happened to
        // return, so repeat renders stay stable.
        return (
          (a.student_last_name ?? "").localeCompare(b.student_last_name ?? "") ||
          (a.student_first_name ?? "").localeCompare(b.student_first_name ?? "")
        );
      });
  }, [sort, columns, visibleGrouped]);
  const sortedColumnHeader = sort
    ? columns.find((c) => c.key === sort.key)?.header ?? null
    : null;
  /** One student row. Shared by the grouped and flat-sorted bodies
   *  so the two renders can't drift in cell padding or click
   *  behaviour. */
  const renderRow = (row: EnrolledStudentRow) => (
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
  );
  return (
    <Card className="overflow-hidden bg-white py-0 gap-0">
      <CardHeader className="py-4 border-b bg-white space-y-1">
        <div className="flex items-baseline gap-3">
          <CardTitle className="text-sm font-semibold text-muted-foreground">
            {title}
          </CardTitle>
          <span className="text-xs tabular-nums text-muted-foreground">
            ({totalCount})
          </span>
        </div>
        <p className="text-xs text-muted-foreground">{description}</p>
        {/* Sort indicator — the grade group headers vanish while a
            sort is active, so say why and offer the way back
            explicitly rather than relying on admin finding the
            third header click. */}
        {sort && sortedColumnHeader ? (
          <button
            type="button"
            onClick={() => setSort(null)}
            // `w-fit` because CardHeader is a grid with stretched
            // items — without it the click target spans the card.
            className="w-fit text-left text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Sorted by {sortedColumnHeader} (
            {sort.dir === "asc" ? "ascending" : "descending"}) · reset to
            grade groups
          </button>
        ) : null}
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
                  {col.sortable ? (
                    // `flex w-full min-w-0` bounds the button to the
                    // cell so long headers truncate instead of
                    // spilling into the next column — same treatment
                    // DataTable gives its sortable headers.
                    <button
                      type="button"
                      onClick={() => toggleSort(col.key)}
                      title={`Sort by ${col.header}`}
                      className={cn(
                        "flex w-full min-w-0 items-center gap-1 uppercase tracking-wider transition-colors hover:text-foreground",
                        col.align === "right" && "justify-end",
                        col.align === "center" && "justify-center",
                        sort?.key === col.key && "text-foreground"
                      )}
                    >
                      <span className="truncate">{col.header}</span>
                      {sort?.key === col.key ? (
                        sort.dir === "asc" ? (
                          <ChevronUp className="size-3 shrink-0" />
                        ) : (
                          <ChevronDown className="size-3 shrink-0" />
                        )
                      ) : (
                        <ChevronsUpDown className="size-3 shrink-0 opacity-40" />
                      )}
                    </button>
                  ) : (
                    col.header
                  )}
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
            ) : sortedFlat ? (
              // Sorted: one flat list, no grade banners. The Grade
              // column still shows each student's grade, so nothing
              // is lost by dropping the group headers here.
              sortedFlat.map(renderRow)
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
                  {group.rows.map(renderRow)}
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

          <div className="space-y-2 border-t pt-4">
            <Button size="sm" className="w-full" onClick={onOpenFull}>
              Open full student page
            </Button>
            {/* Push this student into Toddle (LMS) — updates the
                matching Toddle record or creates one, using the
                placement grade (falling back to the application's
                incoming grade) for the Toddle year group. */}
            <SyncToddleButton
              studentId={row.student_id}
              studentName={row.student_full_name}
              gradeLevel={row.grade_level?.trim() || row.student_grade || null}
              className="w-full"
            />
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

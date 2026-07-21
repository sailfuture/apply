"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { CheckCircle2, Circle, ChevronRight, Eye, Inbox } from "lucide-react";
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

/**
 * Per-student row shape returned by the registrations API. Multiple
 * students from the same family share family + packet fields (the
 * post-acceptance packet booleans live on the family-level
 * `registration_student_registration_progress` row), so we collapse
 * them to one family row on the client below.
 */
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
  /** True when admin has confirmed the family's registration on
   *  the detail page. Drives the Completed bucket. */
  is_registration_confirmed: boolean;
  last_edited: number | null;
  enrollment_agreement_status: string;
  is_enrollment_agreement_signed: boolean;
  /** Per-student required-document states from the API — submitted =
   *  file uploaded into the slot, approved = admin doc-confirm. */
  doc_immunization_submitted: boolean;
  doc_immunization_approved: boolean;
  doc_birth_certificate_submitted: boolean;
  doc_birth_certificate_approved: boolean;
  doc_school_health_form_submitted: boolean;
  doc_school_health_form_approved: boolean;
  doc_transcripts_submitted: boolean;
  doc_transcripts_approved: boolean;
}

/**
 * The four required documents, in display order — one dot each in the
 * Documents column. Keys match the `doc_<key>_submitted/approved`
 * fields on the API row.
 */
const DOC_DEFS = [
  { key: "birth_certificate", label: "Birth certificate" },
  { key: "school_health_form", label: "School health form" },
  { key: "transcripts", label: "Transcripts" },
  { key: "immunization", label: "Immunization forms" },
] as const;
type DocKey = (typeof DOC_DEFS)[number]["key"];

/** Per-family tally for one document across its students. */
interface DocCount {
  submitted: number;
  approved: number;
}

/**
 * Aggregated per-family row that drives the table on this page. Built
 * by collapsing every accepted-student row for the same family into
 * one. The packet booleans + agreement state are family-level (every
 * student row in the same family carries identical values), so we
 * pick them off the first row. `students` keeps a list of names so
 * the row's "Students" cell can show the cohort at a glance without
 * a sub-list.
 */
interface RegFamilyRow {
  /** Stable row id — `family_id` is unique within a year, so this
   *  doubles as the React key. */
  id: number;
  family_id: number;
  year_id: number;
  family_name: string;
  primary_name: string;
  primary_email: string;
  /** Number of accepted students in this family for the year. */
  student_count: number;
  /** Comma-joined display string ("Maxual Thompson, Thomas Haugh"),
   *  truncated by the cell's `truncate` class. */
  student_names: string;
  isTuition: boolean;
  isEnrollment: boolean;
  isRegistration: boolean;
  isVolunteerHours: boolean;
  sections_complete: number;
  sections_total: number;
  registration_submitted: boolean;
  registration_submitted_date: number | null;
  /** True when admin has confirmed the family's registration on
   *  the detail page. Drives the Completed bucket. */
  is_registration_confirmed: boolean;
  last_edited: number | null;
  enrollment_agreement_status: string;
  is_enrollment_agreement_signed: boolean;
  /** Documents are per-STUDENT, so the family row carries a tally per
   *  document ("2/2 submitted, 1/2 approved") that the Documents dots
   *  render from. */
  doc_counts: Record<DocKey, DocCount>;
  /** Σ approved across all four documents and all students — the
   *  Documents column's sort key (most-reviewed families first). */
  docs_approved_total: number;
  /** Index signature so the row matches `DataTable`'s
   *  `<T extends Record<string, unknown>>` constraint without a cast.
   *  Mirrors the pattern used on the Applications + Enrolled pages. */
  [key: string]: unknown;
}

type ProgressFilter =
  | "all"
  | "completed"
  | "submitted"
  | "in_progress"
  | "not_started";

const FILTER_LABEL: Record<ProgressFilter, string> = {
  all: "All families",
  completed: "Completed",
  submitted: "Submitted",
  in_progress: "In progress",
  not_started: "Not started",
};

function deriveFilter(row: RegFamilyRow): ProgressFilter {
  // Completed takes precedence — once admin has confirmed the
  // family's registration, the row drops out of the active queues
  // and lands in the Completed bucket regardless of section state.
  if (row.is_registration_confirmed) return "completed";
  if (row.registration_submitted) return "submitted";
  if (row.sections_complete > 0) return "in_progress";
  return "not_started";
}

/**
 * Fold per-student rows into per-family rows. Every student in the
 * same family shares the packet booleans + agreement state (those
 * live on the family-level progress row), so we read them off the
 * first match and just append student names + bump the count.
 *
 * Sort: alphabetical by family name. The outer page resorts within
 * each progress group anyway, so this primary sort is just for
 * deterministic order before grouping.
 */
function aggregateByFamily(rows: RegStudentRow[]): RegFamilyRow[] {
  // Documents are per-student; each student row contributes 0/1 to
  // the family's per-document submitted/approved tallies.
  const docCountsFor = (r: RegStudentRow): Record<DocKey, DocCount> => ({
    immunization: {
      submitted: r.doc_immunization_submitted ? 1 : 0,
      approved: r.doc_immunization_approved ? 1 : 0,
    },
    birth_certificate: {
      submitted: r.doc_birth_certificate_submitted ? 1 : 0,
      approved: r.doc_birth_certificate_approved ? 1 : 0,
    },
    school_health_form: {
      submitted: r.doc_school_health_form_submitted ? 1 : 0,
      approved: r.doc_school_health_form_approved ? 1 : 0,
    },
    transcripts: {
      submitted: r.doc_transcripts_submitted ? 1 : 0,
      approved: r.doc_transcripts_approved ? 1 : 0,
    },
  });

  const byFamily = new Map<number, RegFamilyRow>();
  for (const r of rows) {
    const existing = byFamily.get(r.family_id);
    if (existing) {
      existing.student_count += 1;
      existing.student_names = [
        existing.student_names,
        r.student_full_name,
      ]
        .filter(Boolean)
        .join(", ");
      const add = docCountsFor(r);
      for (const d of DOC_DEFS) {
        existing.doc_counts[d.key].submitted += add[d.key].submitted;
        existing.doc_counts[d.key].approved += add[d.key].approved;
        existing.docs_approved_total += add[d.key].approved;
      }
      continue;
    }
    byFamily.set(r.family_id, {
      id: r.family_id,
      family_id: r.family_id,
      year_id: r.year_id,
      family_name: r.family_name,
      primary_name: r.primary_name,
      primary_email: r.primary_email,
      student_count: 1,
      student_names: r.student_full_name,
      isTuition: r.isTuition,
      isEnrollment: r.isEnrollment,
      isRegistration: r.isRegistration,
      isVolunteerHours: r.isVolunteerHours,
      sections_complete: r.sections_complete,
      sections_total: r.sections_total,
      registration_submitted: r.registration_submitted,
      registration_submitted_date: r.registration_submitted_date,
      is_registration_confirmed: r.is_registration_confirmed,
      last_edited: r.last_edited,
      enrollment_agreement_status: r.enrollment_agreement_status,
      is_enrollment_agreement_signed: r.is_enrollment_agreement_signed,
      doc_counts: docCountsFor(r),
      docs_approved_total: [
        r.doc_immunization_approved,
        r.doc_birth_certificate_approved,
        r.doc_school_health_form_approved,
        r.doc_transcripts_approved,
      ].filter(Boolean).length,
    });
  }
  return Array.from(byFamily.values()).sort((a, b) =>
    a.family_name.localeCompare(b.family_name)
  );
}

/**
 * Admin Registrations list — one row per family with at least one
 * accepted student for the selected year. Three tables (Submitted /
 * In Progress / Not Started) with shared column widths so the
 * headers line up across groups.
 *
 * Per-student confirmation happens after click-through to the
 * family registration detail page (the four section cards there;
 * Registration Packet has the per-student Mark Confirmed buttons).
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

  const all = useMemo(
    () => aggregateByFamily(Array.isArray(data) ? data : []),
    [data]
  );

  const groups = useMemo(() => {
    const completed: RegFamilyRow[] = [];
    const submitted: RegFamilyRow[] = [];
    const inProgress: RegFamilyRow[] = [];
    const notStarted: RegFamilyRow[] = [];
    for (const r of all) {
      const f = deriveFilter(r);
      if (f === "completed") completed.push(r);
      else if (f === "submitted") submitted.push(r);
      else if (f === "in_progress") inProgress.push(r);
      else notStarted.push(r);
    }
    return { completed, submitted, inProgress, notStarted };
  }, [all]);

  const visibleGroups = useMemo(() => {
    if (filter === "all") return groups;
    return {
      completed: filter === "completed" ? groups.completed : [],
      submitted: filter === "submitted" ? groups.submitted : [],
      inProgress: filter === "in_progress" ? groups.inProgress : [],
      notStarted: filter === "not_started" ? groups.notStarted : [],
    };
  }, [filter, groups]);

  const counts = useMemo(() => {
    return {
      all: all.length,
      completed: groups.completed.length,
      submitted: groups.submitted.length,
      in_progress: groups.inProgress.length,
      not_started: groups.notStarted.length,
    } satisfies Record<ProgressFilter, number>;
  }, [all, groups]);

  // Shared column shape across all three tables so widths line up
  // vertically — same pattern the Applications page uses.
  const columns: ColumnDef<RegFamilyRow>[] = [
    {
      key: "family_name",
      header: "Family",
      sortable: true,
      searchable: true,
      width: "w-[20%]",
      render: (row) => (
        <span className="block truncate font-medium">{row.family_name}</span>
      ),
    },
    {
      key: "student_names",
      header: "Students",
      sortable: true,
      searchable: true,
      width: "w-[22%]",
      render: (row) => (
        <span className="inline-flex items-center gap-2 min-w-0 max-w-full">
          <span className="text-xs tabular-nums text-muted-foreground shrink-0">
            {row.student_count}
          </span>
          <span className="block truncate" title={row.student_names}>
            {row.student_names || "—"}
          </span>
        </span>
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
      key: "sections_complete",
      header: "Packet",
      sortable: true,
      width: "w-[12%]",
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
      // Four required-document dots — per-student states rolled up to
      // the family: gray = not submitted, blue eye = uploaded and
      // waiting on review (faded = only some students so far),
      // green check = approved by admin. Sorts by total approvals so
      // the most-reviewed families cluster.
      key: "docs_approved_total",
      header: "Documents",
      sortable: true,
      width: "w-[12%]",
      accessor: (row) => row.docs_approved_total,
      render: (row) => <DocumentDots row={row} />,
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
          <span
            className={cn(
              "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider",
              // Signed (PandaDoc "completed") reads as a done-state, so
              // it gets the green pill; every other state — Sent, Viewed,
              // not-yet-sent — stays muted/gray.
              row.is_enrollment_agreement_signed
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-border bg-muted text-muted-foreground"
            )}
          >
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

  // True empty state — neither loading nor an error, year is selected,
  // but there are zero accepted families for the year. Shown ONCE
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
            One row per family with at least one accepted student for
            the selected year. Click into a row to land on the family
            detail page where post-acceptance packets and per-student
            confirmation live.
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
              [
                "all",
                "completed",
                "submitted",
                "in_progress",
                "not_started",
              ] as const
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
          {/* Status dots on each card header mirror the Applications
              page palette so admin reads the two surfaces with the
              same color language:
                - green  = Completed (registration confirmed)
                - blue   = Submitted (queued for admin work)
                - yellow = In Progress (waiting on the family)
                - red    = Not Started (no movement) */}
          <RegistrationsGroup
            title="Completed"
            description="Family registration is confirmed. Students are enrolled."
            dotColor="bg-green-500"
            rows={visibleGroups.completed}
            isLoading={
              isLoading &&
              filter !== "submitted" &&
              filter !== "in_progress" &&
              filter !== "not_started"
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
            title="Submitted"
            description="Family has submitted the post-acceptance packet."
            dotColor="bg-blue-500"
            rows={visibleGroups.submitted}
            isLoading={
              isLoading &&
              filter !== "completed" &&
              filter !== "in_progress" &&
              filter !== "not_started"
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
            dotColor="bg-amber-500"
            rows={visibleGroups.inProgress}
            isLoading={
              isLoading &&
              filter !== "completed" &&
              filter !== "submitted" &&
              filter !== "not_started"
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
            dotColor="bg-red-500"
            rows={visibleGroups.notStarted}
            isLoading={
              isLoading &&
              filter !== "completed" &&
              filter !== "submitted" &&
              filter !== "in_progress"
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
 * Shown when no families are accepted for the year yet. A registration
 * row only exists once an admin Approves a family, so this state is
 * "no acceptance decisions made yet" — the action the admin needs to
 * take is over on the Applications page.
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
          A family appears here once at least one student has been
          accepted for this academic year. Head to{" "}
          <strong>Applications</strong> to review submitted apps and
          accept families.
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
  dotColor,
}: {
  title: string;
  description: string;
  rows: RegFamilyRow[];
  isLoading: boolean;
  error: unknown;
  columns: ColumnDef<RegFamilyRow>[];
  onRowClick: (row: RegFamilyRow) => void;
  /** Tailwind bg-... class for the status dot rendered before the
   *  title. Blue / amber / red mirror the Applications page palette
   *  so the two queues read with the same visual language. */
  dotColor: string;
}) {
  if (!isLoading && !error && rows.length === 0) return null;
  return (
    <Card className="overflow-hidden bg-white py-0 gap-0">
      <CardHeader className="py-4 border-b bg-white">
        <div className="flex items-baseline gap-3">
          {/* `self-center` so the dot vertically aligns to the
              uppercase title text rather than its baseline —
              matches the Applications page's group headers. */}
          <span
            className={cn(
              "size-2.5 shrink-0 self-center rounded-full",
              dotColor
            )}
            aria-hidden
          />
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
        <DataTable<RegFamilyRow>
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
/**
 * Four required-document dots — same visual language as the packet
 * SectionDots, one dot per document, rolled up across the family's
 * students. Per document (n students):
 *
 *   - green check — approved for every student (admin doc-confirm)
 *   - blue eye    — submitted for every student, awaiting admin
 *                   review ("look at this")
 *   - faded eye   — submitted for SOME students (multi-student
 *                   families mid-upload), lighter blue so a full
 *                   review queue reads stronger than a partial one
 *   - gray empty  — nothing uploaded yet
 *
 * Hover any dot for the exact counts.
 */
function DocumentDots({ row }: { row: RegFamilyRow }) {
  const n = row.student_count;
  return (
    <span className="inline-flex items-center gap-1">
      {DOC_DEFS.map((d) => {
        const c = row.doc_counts[d.key];
        const title = `${d.label} — ${c.submitted}/${n} submitted · ${c.approved}/${n} approved`;
        if (n > 0 && c.approved === n) {
          return (
            <CheckCircle2
              key={d.key}
              className="size-3 text-green-600"
              aria-label={`${d.label} approved`}
            >
              <title>{title}</title>
            </CheckCircle2>
          );
        }
        if (n > 0 && c.submitted === n) {
          return (
            <Eye
              key={d.key}
              className="size-3 text-blue-600"
              aria-label={`${d.label} submitted, awaiting review`}
            >
              <title>{title}</title>
            </Eye>
          );
        }
        if (c.submitted > 0) {
          return (
            <Eye
              key={d.key}
              className="size-3 text-blue-400/70"
              aria-label={`${d.label} partially submitted`}
            >
              <title>{title}</title>
            </Eye>
          );
        }
        return (
          <Circle
            key={d.key}
            className="size-3 text-muted-foreground/40"
            aria-label={`${d.label} not submitted`}
          >
            <title>{title}</title>
          </Circle>
        );
      })}
    </span>
  );
}

function SectionDots({ row }: { row: RegFamilyRow }) {
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

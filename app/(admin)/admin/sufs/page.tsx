"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import { Download, Inbox } from "lucide-react";
import { DataTable, type ColumnDef } from "@/components/admin/data-table";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { adminFetcher } from "@/lib/admin-fetcher";
import { cn } from "@/lib/utils";
import type { SufsStudentRow } from "@/app/api/admin/sufs/route";

/**
 * Row shape driving the tables. `SufsStudentRow` from the API plus the
 * index signature `DataTable`'s `<T extends Record<string, unknown>>`
 * constraint needs — same pattern the Registrations page uses.
 */
type SufsRow = SufsStudentRow & { [key: string]: unknown };

/**
 * Award-tier labels. Keys match `sufs_type` on the application row.
 *
 * NOTE: unlike the three other SUFS_LABELS maps in this codebase (the
 * two tuition pages and the registration detail page), this one
 * includes `custom` — those maps predate the custom tier and render a
 * blank label for it. Since reconciling against the Step Up portal is
 * exactly when a custom award matters, it gets a real label here.
 */
const SUFS_LABELS: Record<string, string> = {
  fes_eo_8: "FES-EO · Grade 8",
  fes_eo_9: "FES-EO · Grade 9",
  ftc_8: "FTC · Grade 8",
  ftc_9: "FTC · Grade 9",
  fes_ua_8_ese_1_3: "FES-UA · ESE 1-3 · Grade 8",
  fes_ua_9_ese_1_3: "FES-UA · ESE 1-3 · Grade 9",
  fes_ua_ese_4: "FES-UA · ESE 4",
  fes_ua_ese_5: "FES-UA · ESE 5",
  custom: "Custom amount",
};

/**
 * Three-stage pipeline per student, derived from the two bools:
 *   - not_sent   — admin hasn't sent the Step Up enrollment request
 *   - pending    — request sent, waiting on the parent to complete it
 *   - confirmed  — parent completed enrollment; quarterly payments
 *                  are now trackable
 * Confirmation wins over request-sent so an inconsistent row (confirmed
 * but request flag off) still lands in the most-progressed bucket.
 */
type SufsStatus = "not_sent" | "pending" | "confirmed";

function rowStatus(r: SufsStudentRow): SufsStatus {
  if (r.sufs_parent_enrollment_confirmation) return "confirmed";
  if (r.sufs_enrollment_request_sent) return "pending";
  return "not_sent";
}

type StatusFilter = "all" | SufsStatus;

const FILTER_LABEL: Record<StatusFilter, string> = {
  all: "All students",
  not_sent: "Request not sent",
  pending: "Parent pending",
  confirmed: "Confirmed",
};

const QUARTERS = [1, 2, 3, 4] as const;
type Quarter = (typeof QUARTERS)[number];

/** Typed access into the flat per-quarter columns. */
const qPaid = (r: SufsRow, q: Quarter) =>
  r[`sufs_q${q}_payment`] === true;
const qTime = (r: SufsRow, q: Quarter) =>
  (r[`sufs_q${q}_payment_confirmed`] as number | null | undefined) ?? null;
const qBy = (r: SufsRow, q: Quarter) =>
  (r[`sufs_q${q}_payment_confirmed_by`] as string | undefined) ?? "";

const money = (n: number | null) =>
  typeof n === "number"
    ? n.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      })
    : "—";

/** ms timestamp → "YYYY-MM-DD" in local time, or "" for missing/zero. */
function fmtDate(ms: number | null | undefined): string {
  if (!ms || !Number.isFinite(ms)) return "";
  const d = new Date(ms);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** ms timestamp → compact "7/21/26" for tight table cells. */
function fmtShort(ms: number | null | undefined): string {
  if (!ms || !Number.isFinite(ms)) return "";
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
}

/** RFC-4180 cell escaping — quote when the value holds a comma, quote,
 *  or newline; double any embedded quotes. */
function csvCell(v: string | number | null | undefined): string {
  if (v == null) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const STATUS_CSV_LABEL: Record<SufsStatus, string> = {
  not_sent: "Request Not Sent",
  pending: "Parent Pending",
  confirmed: "Confirmed",
};

/**
 * Build the SUFS CSV from the full year dataset (not the filtered
 * view). Numbers stay raw (award id, amount) so the spreadsheet can do
 * math on them; the tier renders as its human label. A UTF-8 BOM is
 * prepended so Excel reads accented names correctly, and rows are
 * CRLF-joined per RFC 4180.
 */
function buildSufsCsv(rows: SufsRow[]): string {
  const headers = [
    "First Name",
    "Last Name",
    "Family",
    "Grade",
    "SUFS Award ID",
    "Award Type",
    "Award Status",
    "SUFS Amount",
    "Enrollment Status",
    "Request Sent Date",
    "Request Sent By",
    "Parent Confirmed Date",
    "Parent Confirmed By",
    "Note",
    ...QUARTERS.flatMap((q) => [
      `Q${q} Paid`,
      `Q${q} Confirmed Date`,
      `Q${q} Confirmed By`,
    ]),
  ];
  const lines = [headers.map(csvCell).join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.student_first_name,
        r.student_last_name,
        r.family_name,
        r.student_grade,
        r.sufs_award_id ?? "",
        r.sufs_type ? SUFS_LABELS[r.sufs_type] ?? r.sufs_type : "",
        r.sufs_status,
        r.sufs_amount ?? "",
        STATUS_CSV_LABEL[rowStatus(r)],
        // Audit stamps gated on their bools upstream in the API, so
        // these are already clean for un-ticked rows.
        fmtDate(r.sufs_enrollment_request_time),
        r.sufs_enrollment_request_by,
        fmtDate(r.sufs_parent_enrollment_request_time),
        r.sufs_parent_enrollment_request_by,
        r.sufs_enrollment_request_notes,
        ...QUARTERS.flatMap((q) => [
          qPaid(r, q) ? "Yes" : "No",
          fmtDate(qTime(r, q)),
          qBy(r, q),
        ]),
      ]
        .map(csvCell)
        .join(",")
    );
  }
  // Leading UTF-8 BOM (U+FEFF) so Excel detects the encoding and
  // renders accented names correctly.
  return String.fromCharCode(0xfeff) + lines.join("\r\n");
}

/** Trigger a client-side file download of `text` as `filename`. */
function downloadTextFile(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Admin Step Up for Students Confirmation page.
 *
 * One row per student whose family registration is confirmed for the
 * selected year, split into the three pipeline tables:
 *
 *   - red    — enrollment request not sent yet (admin's queue)
 *   - yellow — request sent, waiting on the parent
 *   - green  — parent confirmed; track Q1–Q4 payment confirmations
 *
 * Grouping is computed CLIENT-side from the SWR cache, so an
 * optimistic checkbox flip moves the row between tables instantly —
 * the server deliberately returns name-sorted rows with no status
 * ordering (see the route). The post-save revalidation then lands the
 * server's audit stamps without visibly reshuffling anything.
 *
 * Deliberately no row-click navigation — rows carry interactive
 * controls and DataTable's `onRowClick` fires from the `<tr>` without
 * stopping propagation. The student name is an explicit link instead.
 */
export default function SufsPage() {
  const searchParams = useSearchParams();
  const yearId = searchParams.get("yearId");
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [savingId, setSavingId] = useState<number | null>(null);

  const key = yearId ? `/api/admin/sufs?yearId=${yearId}` : null;
  const { data, isLoading, error, mutate } = useSWR<SufsStudentRow[]>(
    key,
    adminFetcher
  );

  const all = useMemo<SufsRow[]>(
    () => (Array.isArray(data) ? (data as SufsRow[]) : []),
    [data]
  );

  const groups = useMemo(() => {
    const notSent: SufsRow[] = [];
    const pending: SufsRow[] = [];
    const confirmed: SufsRow[] = [];
    for (const r of all) {
      const s = rowStatus(r);
      if (s === "confirmed") confirmed.push(r);
      else if (s === "pending") pending.push(r);
      else notSent.push(r);
    }
    return { notSent, pending, confirmed };
  }, [all]);

  const counts = useMemo(
    () =>
      ({
        all: all.length,
        not_sent: groups.notSent.length,
        pending: groups.pending.length,
        confirmed: groups.confirmed.length,
      }) satisfies Record<StatusFilter, number>,
    [all, groups]
  );

  const visibleGroups = useMemo(() => {
    if (filter === "all") return groups;
    return {
      notSent: filter === "not_sent" ? groups.notSent : [],
      pending: filter === "pending" ? groups.pending : [],
      confirmed: filter === "confirmed" ? groups.confirmed : [],
    };
  }, [filter, groups]);

  /**
   * PATCH one student's registration packet and optimistically fold the
   * change into the cached list. The optimistic patch may carry audit
   * stamps (time = now) purely for instant display — the admin route
   * allowlists only the bools/note from the body and re-stamps the
   * audit pairs itself, and the background revalidation replaces the
   * optimistic values with the server's.
   */
  async function patchRow(
    row: SufsRow,
    patch: Partial<SufsStudentRow> & Record<string, unknown>
  ) {
    if (row.packet_id == null) {
      toast.error(
        `${row.student_full_name} has no registration packet to update.`
      );
      return false;
    }
    setSavingId(row.id);
    const optimistic = (curr: SufsStudentRow[] | undefined) =>
      (curr ?? []).map((r) => (r.id === row.id ? { ...r, ...patch } : r));
    try {
      mutate(optimistic, { revalidate: false });
      const res = await fetch(
        `/api/admin/student-registration/${row.packet_id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        }
      );
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      // Background reconcile — lands the server's audit stamps (and
      // the note sentinel round-trip). Grouping is derived
      // client-side from the same data, so this never reshuffles rows.
      mutate();
      return true;
    } catch (err) {
      console.error("Failed to update SUFS row:", err);
      toast.error(`Couldn't update ${row.student_full_name}.`);
      mutate();
      return false;
    } finally {
      setSavingId(null);
    }
  }

  function toggleRequestSent(row: SufsRow, next: boolean) {
    // The time stamp rides along purely for optimistic display — the
    // admin route ignores it (not allowlisted) and stamps its own,
    // including the admin's name, which lands on revalidation.
    void patchRow(row, {
      sufs_enrollment_request_sent: next,
      sufs_enrollment_request_time: next ? Date.now() : null,
      sufs_enrollment_request_by: "",
    });
  }

  function toggleParentConfirmed(row: SufsRow, next: boolean) {
    void patchRow(row, {
      sufs_parent_enrollment_confirmation: next,
      sufs_parent_enrollment_request_time: next ? Date.now() : null,
      sufs_parent_enrollment_request_by: "",
    });
  }

  function toggleQuarter(row: SufsRow, q: Quarter, next: boolean) {
    void patchRow(row, {
      [`sufs_q${q}_payment`]: next,
      [`sufs_q${q}_payment_confirmed`]: next ? Date.now() : null,
      [`sufs_q${q}_payment_confirmed_by`]: "",
    });
  }

  // ── Column factories (widths vary per table) ──────────────────────

  const studentCol = (w: string): ColumnDef<SufsRow> => ({
    key: "student_full_name",
    header: "Student",
    sortable: true,
    searchable: true,
    width: w,
    render: (row) => (
      <Link
        href={`/admin/registrations/${row.family_id}?yearId=${row.year_id}`}
        className="block min-w-0 hover:underline"
      >
        <span className="block truncate font-medium">
          {row.student_full_name}
        </span>
        {/* Family · incoming grade, dot-separated. */}
        <span className="block truncate text-xs text-muted-foreground">
          {row.family_name}
          {row.student_grade ? ` · Grade ${row.student_grade}` : ""}
        </span>
      </Link>
    ),
  });

  const awardIdCol = (w: string): ColumnDef<SufsRow> => ({
    key: "sufs_award_id",
    header: "Award ID",
    sortable: true,
    searchable: true,
    width: w,
    accessor: (row) => row.sufs_award_id ?? "",
    render: (row) =>
      row.sufs_award_id ? (
        <span className="tabular-nums">{row.sufs_award_id}</span>
      ) : (
        // A confirmed registration with no award ID is actionable —
        // the parent never filled it in and it can't be reconciled
        // against the portal without it.
        <span className="text-xs font-medium text-amber-700">Missing</span>
      ),
  });

  const awardTypeCol = (w: string): ColumnDef<SufsRow> => ({
    key: "sufs_type",
    header: "Award Type",
    sortable: true,
    searchable: true,
    width: w,
    accessor: (row) => SUFS_LABELS[row.sufs_type] ?? row.sufs_type,
    render: (row) => {
      if (!row.sufs_type) {
        return (
          <span className="text-xs text-muted-foreground">Not on SUFS</span>
        );
      }
      return (
        <span className="block min-w-0">
          <span className="block truncate">
            {SUFS_LABELS[row.sufs_type] ?? row.sufs_type}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {money(row.sufs_amount)}
            {row.sufs_status ? ` · ${row.sufs_status}` : ""}
          </span>
        </span>
      );
    },
  });

  const noteCol = (w: string): ColumnDef<SufsRow> => ({
    key: "sufs_enrollment_request_notes",
    header: "Note",
    searchable: true,
    width: w,
    render: (row) => (
      // `key` on the row id is load-bearing: DataTable keys its rows
      // by array index, and rows shift indices when a checkbox moves
      // one between the status tables. Keying by id remounts a
      // NoteCell whose slot changed identity so a draft can never
      // commit onto the wrong student.
      <NoteCell
        key={row.id}
        row={row}
        disabled={savingId === row.id || row.packet_id == null}
        onSave={(note) => {
          if (note === row.sufs_enrollment_request_notes) return;
          void patchRow(row, { sufs_enrollment_request_notes: note });
        }}
      />
    ),
  });

  const requestSentCol = (w: string): ColumnDef<SufsRow> => ({
    key: "sufs_enrollment_request_sent",
    header: "Request Sent",
    sortable: true,
    align: "center",
    width: w,
    accessor: (row) => (row.sufs_enrollment_request_sent ? 1 : 0),
    render: (row) => {
      const sent = row.sufs_enrollment_request_sent;
      const title = sent
        ? `Sent${
            row.sufs_enrollment_request_by
              ? ` by ${row.sufs_enrollment_request_by}`
              : ""
          }${
            row.sufs_enrollment_request_time
              ? ` · ${fmtDate(row.sufs_enrollment_request_time)}`
              : ""
          }`
        : row.packet_id == null
          ? "No registration packet on file for this student yet"
          : "Mark once the Step Up enrollment request has been sent";
      return (
        <span
          className="inline-flex flex-col items-center gap-0.5"
          title={title}
        >
          <Checkbox
            checked={sent}
            disabled={savingId === row.id || row.packet_id == null}
            onCheckedChange={(v) => toggleRequestSent(row, v === true)}
            aria-label={`Mark enrollment request sent for ${row.student_full_name}`}
          />
          {sent && row.sufs_enrollment_request_time ? (
            <span className="text-[10px] tabular-nums text-muted-foreground">
              {fmtShort(row.sufs_enrollment_request_time)}
            </span>
          ) : null}
        </span>
      );
    },
  });

  const parentConfirmedCol = (w: string): ColumnDef<SufsRow> => ({
    key: "sufs_parent_enrollment_confirmation",
    header: "Parent Confirmed",
    sortable: true,
    align: "center",
    width: w,
    accessor: (row) => (row.sufs_parent_enrollment_confirmation ? 1 : 0),
    render: (row) => {
      const confirmed = row.sufs_parent_enrollment_confirmation;
      const title = confirmed
        ? `Marked${
            row.sufs_parent_enrollment_request_by
              ? ` by ${row.sufs_parent_enrollment_request_by}`
              : ""
          }${
            row.sufs_parent_enrollment_request_time
              ? ` · ${fmtDate(row.sufs_parent_enrollment_request_time)}`
              : ""
          }`
        : "Mark once the parent has completed the Step Up enrollment";
      return (
        <span
          className="inline-flex flex-col items-center gap-0.5"
          title={title}
        >
          <Checkbox
            checked={confirmed}
            disabled={savingId === row.id || row.packet_id == null}
            onCheckedChange={(v) => toggleParentConfirmed(row, v === true)}
            aria-label={`Mark parent enrollment confirmed for ${row.student_full_name}`}
          />
          {confirmed && row.sufs_parent_enrollment_request_time ? (
            <span className="text-[10px] tabular-nums text-muted-foreground">
              {fmtShort(row.sufs_parent_enrollment_request_time)}
            </span>
          ) : null}
        </span>
      );
    },
  });

  const quarterCol = (q: Quarter, w: string): ColumnDef<SufsRow> => ({
    key: `sufs_q${q}_payment`,
    header: `Q${q}`,
    sortable: true,
    align: "center",
    width: w,
    accessor: (row) => (qPaid(row, q) ? 1 : 0),
    render: (row) => {
      const paid = qPaid(row, q);
      const time = qTime(row, q);
      const by = qBy(row, q);
      const title = paid
        ? `Q${q} payment confirmed${by ? ` by ${by}` : ""}${
            time ? ` · ${fmtDate(time)}` : ""
          }`
        : `Mark the Q${q} Step Up payment confirmed`;
      return (
        <span
          className="inline-flex flex-col items-center gap-0.5 min-w-0"
          title={title}
        >
          <Checkbox
            checked={paid}
            disabled={savingId === row.id || row.packet_id == null}
            onCheckedChange={(v) => toggleQuarter(row, q, v === true)}
            aria-label={`Mark Q${q} payment confirmed for ${row.student_full_name}`}
          />
          {paid && time ? (
            <span className="block max-w-full truncate text-[10px] tabular-nums text-muted-foreground">
              {fmtShort(time)}
              {by ? ` · ${by}` : ""}
            </span>
          ) : null}
        </span>
      );
    },
  });

  // Per-group column sets. Widths total 100% within each table; the
  // three tables carry different actions so their columns don't need
  // to line up across groups.
  const notSentColumns: ColumnDef<SufsRow>[] = [
    studentCol("w-[26%]"),
    awardIdCol("w-[14%]"),
    awardTypeCol("w-[18%]"),
    noteCol("w-[28%]"),
    requestSentCol("w-[14%]"),
  ];
  const pendingColumns: ColumnDef<SufsRow>[] = [
    studentCol("w-[23%]"),
    awardIdCol("w-[12%]"),
    awardTypeCol("w-[16%]"),
    noteCol("w-[23%]"),
    requestSentCol("w-[13%]"),
    parentConfirmedCol("w-[13%]"),
  ];
  const confirmedColumns: ColumnDef<SufsRow>[] = [
    studentCol("w-[22%]"),
    awardTypeCol("w-[14%]"),
    noteCol("w-[16%]"),
    parentConfirmedCol("w-[12%]"),
    quarterCol(1, "w-[9%]"),
    quarterCol(2, "w-[9%]"),
    quarterCol(3, "w-[9%]"),
    quarterCol(4, "w-[9%]"),
  ];

  // Export the FULL year dataset (`all`), not the filtered view — a
  // CSV export is expected to be the complete list regardless of which
  // filter chip is active.
  function handleExport() {
    if (all.length === 0) {
      toast.error("Nothing to export for this year yet.");
      return;
    }
    const csv = buildSufsCsv(all);
    const stamp = fmtDate(Date.now()) || "export";
    downloadTextFile(
      `sufs-year-${yearId}-${stamp}.csv`,
      csv,
      "text/csv;charset=utf-8;"
    );
    toast.success(
      `Exported ${all.length} student${all.length === 1 ? "" : "s"} to CSV.`
    );
  }

  const showEmptyState = !!yearId && !isLoading && !error && all.length === 0;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">
            Step Up for Students Confirmation
          </h1>
          <p className="text-sm text-muted-foreground">
            Every student with a confirmed registration for the selected
            year. Send the Step Up enrollment request, mark when the
            parent completes it, then track quarterly payment
            confirmations.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="outline"
            onClick={handleExport}
            disabled={all.length === 0}
            className="bg-white"
          >
            <Download className="size-4" />
            Export CSV
          </Button>
          <Select
            value={filter}
            onValueChange={(v) => setFilter(v as StatusFilter)}
          >
            <SelectTrigger className="w-[210px] bg-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(["all", "not_sent", "pending", "confirmed"] as const).map(
                (f) => (
                  <SelectItem key={f} value={f}>
                    {FILTER_LABEL[f]} ({counts[f]})
                  </SelectItem>
                )
              )}
            </SelectContent>
          </Select>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
          Failed to load SUFS students:{" "}
          {error instanceof Error ? error.message : "unknown error"}
        </div>
      ) : null}

      {!yearId ? (
        <div className="rounded-lg border bg-white px-6 py-12 text-center text-sm text-muted-foreground">
          Pick a school year above to view its SUFS students.
        </div>
      ) : showEmptyState ? (
        <SufsEmptyState />
      ) : (
        <div className="space-y-8">
          <SufsGroup
            title="Enrollment Request Not Sent"
            description="Registration confirmed — the Step Up enrollment request hasn't been sent yet."
            dotColor="bg-red-500"
            rows={visibleGroups.notSent}
            isLoading={isLoading && filter !== "pending" && filter !== "confirmed"}
            columns={notSentColumns}
          />
          <SufsGroup
            title="Awaiting Parent Confirmation"
            description="Request sent — waiting on the parent to complete enrollment in the Step Up portal."
            dotColor="bg-amber-500"
            rows={visibleGroups.pending}
            isLoading={isLoading && filter !== "not_sent" && filter !== "confirmed"}
            columns={pendingColumns}
          />
          <SufsGroup
            title="Enrollment Confirmed"
            description="Parent completed Step Up enrollment. Tick off each quarterly payment as it's confirmed."
            dotColor="bg-green-500"
            rows={visibleGroups.confirmed}
            isLoading={isLoading && filter !== "not_sent" && filter !== "pending"}
            columns={confirmedColumns}
          />
        </div>
      )}
    </div>
  );
}

function SufsGroup({
  title,
  description,
  rows,
  isLoading,
  columns,
  dotColor,
}: {
  title: string;
  description: string;
  rows: SufsRow[];
  isLoading: boolean;
  columns: ColumnDef<SufsRow>[];
  /** Tailwind bg-... class for the status dot before the title —
   *  red / amber / green mirror the Registrations page's group
   *  headers so the pipeline reads with the same color language. */
  dotColor: string;
}) {
  if (!isLoading && rows.length === 0) return null;
  return (
    <Card className="overflow-hidden bg-white py-0 gap-0">
      <CardHeader className="py-4 border-b bg-white">
        <div className="flex items-baseline gap-3">
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
        <DataTable<SufsRow>
          columns={columns}
          data={rows}
          isLoading={isLoading}
          searchPlaceholder={`Search ${title.toLowerCase()}…`}
        />
      </CardContent>
    </Card>
  );
}

/**
 * Shown when the year has no confirmed registrations yet. The action
 * that populates this page lives on the Registrations detail view
 * (Confirm Family Registration), so point there.
 */
function SufsEmptyState() {
  return (
    <Card className="bg-white">
      <CardContent className="py-16 px-6 text-center">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-muted">
          <Inbox className="size-6 text-muted-foreground" />
        </div>
        <h3 className="text-base font-semibold">
          No completed registrations yet
        </h3>
        <p className="mt-1 text-sm text-muted-foreground max-w-md mx-auto">
          A student shows up here once their family&rsquo;s registration
          has been confirmed for this year. Head to{" "}
          <strong>Registrations</strong> to review submitted packets and
          confirm families.
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * Inline note field. Keeps its own draft state while focused and
 * commits on blur (or Enter) — the same cheap blur-PATCH convention
 * the parent-facing SUFS award-ID input uses. Escape reverts.
 *
 * The caller keys this on the row id so DataTable's index-keyed rows
 * can't hand a live draft to a different student; we only re-sync from
 * props when not focused.
 */
function NoteCell({
  row,
  disabled,
  onSave,
}: {
  row: SufsRow;
  disabled: boolean;
  onSave: (note: string) => void;
}) {
  const [draft, setDraft] = useState(row.sufs_enrollment_request_notes);
  const [focused, setFocused] = useState(false);
  // Escape sets this so the synchronous blur it triggers skips the
  // commit. `HTMLElement.blur()` dispatches `onBlur` before React
  // flushes the reverted-draft state update in the same handler, so
  // without this flag the blur would save the very text Escape asked
  // to discard.
  const skipSaveRef = useRef(false);

  // Re-sync from the server value whenever the field isn't being
  // edited — covers revalidation landing a note edited elsewhere.
  const value = focused ? draft : row.sufs_enrollment_request_notes;

  return (
    <Input
      value={value}
      disabled={disabled}
      placeholder="Add a note…"
      className="h-8 border-transparent bg-transparent px-2 text-sm shadow-none hover:border-input focus-visible:border-input"
      onFocus={() => {
        setDraft(row.sufs_enrollment_request_notes);
        setFocused(true);
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setFocused(false);
        if (skipSaveRef.current) {
          skipSaveRef.current = false;
          return;
        }
        onSave(draft.trim());
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          skipSaveRef.current = true;
          setDraft(row.sufs_enrollment_request_notes);
          setFocused(false);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

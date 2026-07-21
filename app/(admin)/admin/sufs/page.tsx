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
 * Row shape driving the table. `SufsStudentRow` from the API plus the
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

type EnrolledFilter = "all" | "not_enrolled" | "enrolled";

const FILTER_LABEL: Record<EnrolledFilter, string> = {
  all: "All students",
  not_enrolled: "Not enrolled",
  enrolled: "Enrolled",
};

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

/** RFC-4180 cell escaping — quote when the value holds a comma, quote,
 *  or newline; double any embedded quotes. */
function csvCell(v: string | number | null | undefined): string {
  if (v == null) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

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
    "Enrolled",
    "Enrolled Date",
    "Enrolled By",
    "Note",
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
        r.sufs_enrolled ? "Yes" : "No",
        // Gated on the latch, matching the on-screen tooltip: after an
        // un-enroll, Xano drops the null/"" audit clears, so the stored
        // time/name linger — printing them for a "No" row would falsely
        // imply an active enrollment.
        r.sufs_enrolled ? fmtDate(r.sufs_enrolled_time) : "",
        r.sufs_enrolled ? r.sufs_enrolled_by : "",
        r.sufs_enrolled_notes,
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
 * Admin SUFS page — the Step Up For Students reconciliation list.
 *
 * One row per student whose family registration is confirmed for the
 * selected year. Admin works this against the Step Up portal: check
 * the award ID and tier, enroll the student over there, then tick the
 * Enrolled box here. The note column is scratch space for whatever
 * blocked a given student.
 *
 * Deliberately has no row-click navigation — the row carries two
 * interactive controls (a checkbox and a text input) and DataTable
 * fires `onRowClick` from the `<tr>` without stopping propagation, so
 * a row-level handler would hijack every note edit. The student name
 * is an explicit link instead.
 */
export default function SufsPage() {
  const searchParams = useSearchParams();
  const yearId = searchParams.get("yearId");
  const [filter, setFilter] = useState<EnrolledFilter>("all");
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

  const counts = useMemo(() => {
    const enrolled = all.filter((r) => r.sufs_enrolled).length;
    return {
      all: all.length,
      enrolled,
      not_enrolled: all.length - enrolled,
    } satisfies Record<EnrolledFilter, number>;
  }, [all]);

  const rows = useMemo(() => {
    if (filter === "enrolled") return all.filter((r) => r.sufs_enrolled);
    if (filter === "not_enrolled") return all.filter((r) => !r.sufs_enrolled);
    return all;
  }, [all, filter]);

  /**
   * PATCH one student's registration packet and optimistically fold the
   * change into the cached list. Mirrors the Inquiries page's
   * `updateStatus` — optimistic `mutate` with `revalidate: false`, then
   * a full refetch to reconcile (and to snap back on failure).
   *
   * Targets the packet (`registration_student_registration`), where the
   * SUFS enrolled flag + note live — not the application row. A row with
   * no `packet_id` can't be written; callers guard on it first.
   */
  async function patchRow(row: SufsRow, patch: Partial<SufsStudentRow>) {
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
      // Reconcile with the server (e.g. the note sentinel round-trip)
      // rather than leaving the optimistic value in place.
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

  async function toggleEnrolled(row: SufsRow, next: boolean) {
    const ok = await patchRow(row, { sufs_enrolled: next });
    if (ok) {
      toast.success(
        next
          ? `${row.student_full_name} marked enrolled in Step Up.`
          : `${row.student_full_name} unmarked.`
      );
    }
  }

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

  const columns: ColumnDef<SufsRow>[] = [
    {
      key: "student_full_name",
      header: "Student",
      sortable: true,
      searchable: true,
      width: "w-[24%]",
      render: (row) => (
        <Link
          href={`/admin/registrations/${row.family_id}?yearId=${row.year_id}`}
          className="block min-w-0 hover:underline"
        >
          <span className="block truncate font-medium">
            {row.student_full_name}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {row.family_name}
            {row.student_grade ? ` · Grade ${row.student_grade}` : ""}
          </span>
        </Link>
      ),
    },
    {
      key: "sufs_award_id",
      header: "Award ID",
      sortable: true,
      searchable: true,
      width: "w-[13%]",
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
    },
    {
      key: "sufs_type",
      header: "Award Type",
      sortable: true,
      searchable: true,
      width: "w-[18%]",
      accessor: (row) => SUFS_LABELS[row.sufs_type] ?? row.sufs_type,
      render: (row) => {
        if (!row.sufs_type) {
          return (
            <span className="text-xs text-muted-foreground">
              Not on SUFS
            </span>
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
    },
    {
      key: "sufs_enrolled_notes",
      header: "Note",
      searchable: true,
      width: "w-[27%]",
      render: (row) => (
        // `key` on the student id is load-bearing: DataTable keys its
        // rows by array index, and this list re-sorts after every
        // enroll toggle (not-enrolled float to the top). Without a
        // stable key, React would reuse the NoteCell instance sitting
        // at a given index and feed it a *different* student's row —
        // so an in-flight note edit could commit onto the wrong
        // student. Keying by id makes the cell follow its student
        // across reorders (focus + draft included).
        <NoteCell
          key={row.id}
          row={row}
          disabled={savingId === row.id || row.packet_id == null}
          onSave={(note) => {
            if (note === row.sufs_enrolled_notes) return;
            void patchRow(row, { sufs_enrolled_notes: note });
          }}
        />
      ),
    },
    {
      key: "sufs_enrolled",
      header: "Enrolled",
      sortable: true,
      align: "center",
      width: "w-[10%]",
      accessor: (row) => (row.sufs_enrolled ? 1 : 0),
      render: (row) => {
        const enrolledTitle =
          row.sufs_enrolled && row.sufs_enrolled_by
            ? `Marked by ${row.sufs_enrolled_by}${
                row.sufs_enrolled_time
                  ? ` · ${fmtDate(row.sufs_enrolled_time)}`
                  : ""
              }`
            : row.packet_id == null
              ? "No registration packet on file for this student yet"
              : "Mark once this student is enrolled in the Step Up portal";
        return (
          <span
            className="inline-flex items-center justify-center"
            title={enrolledTitle}
          >
            <Checkbox
              checked={row.sufs_enrolled}
              disabled={savingId === row.id || row.packet_id == null}
              onCheckedChange={(v) => void toggleEnrolled(row, v === true)}
              aria-label={`Mark ${row.student_full_name} enrolled in Step Up`}
            />
          </span>
        );
      },
    },
  ];

  const showEmptyState = !!yearId && !isLoading && !error && all.length === 0;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">SUFS</h1>
          <p className="text-sm text-muted-foreground">
            Every student with a confirmed registration for the selected
            year, with their Step Up For Students award. Tick a student
            off once they&rsquo;ve been enrolled in the Step Up portal.
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
            onValueChange={(v) => setFilter(v as EnrolledFilter)}
          >
            <SelectTrigger className="w-[200px] bg-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(["all", "not_enrolled", "enrolled"] as const).map((f) => (
                <SelectItem key={f} value={f}>
                  {FILTER_LABEL[f]} ({counts[f]})
                </SelectItem>
              ))}
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
        <Card className="overflow-hidden bg-white py-0 gap-0">
          <CardHeader className="py-4 border-b bg-white">
            <div className="flex items-baseline gap-3">
              {/* Green once every student is enrolled on the portal,
                  amber while there's still work outstanding — same
                  dot language as the Registrations group headers. */}
              <span
                className={cn(
                  "size-2.5 shrink-0 self-center rounded-full",
                  counts.not_enrolled === 0 && counts.all > 0
                    ? "bg-green-500"
                    : "bg-amber-500"
                )}
                aria-hidden
              />
              <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Completed Registrations
              </CardTitle>
              <span className="text-xs tabular-nums text-muted-foreground">
                ({counts.enrolled}/{counts.all} enrolled)
              </span>
              <p className="text-xs text-muted-foreground">
                Registration confirmed — ready to enroll in Step Up.
              </p>
            </div>
          </CardHeader>
          <CardContent className="p-4 bg-white">
            <DataTable<SufsRow>
              columns={columns}
              data={rows}
              isLoading={isLoading}
              searchPlaceholder="Search students, award IDs, notes…"
            />
          </CardContent>
        </Card>
      )}
    </div>
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
 * `key`ed on the persisted value by the caller's row identity, so a
 * successful save that changes the server value doesn't fight the
 * draft: we only re-sync from props when not focused.
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
  const [draft, setDraft] = useState(row.sufs_enrolled_notes);
  const [focused, setFocused] = useState(false);
  // Escape sets this so the synchronous blur it triggers skips the
  // commit. `HTMLElement.blur()` dispatches `onBlur` before React
  // flushes the reverted-draft state update in the same handler, so
  // without this flag the blur would save the very text Escape asked
  // to discard.
  const skipSaveRef = useRef(false);

  // Re-sync from the server value whenever the field isn't being
  // edited — covers revalidation landing a note edited elsewhere.
  const value = focused ? draft : row.sufs_enrolled_notes;

  return (
    <Input
      value={value}
      disabled={disabled}
      placeholder="Add a note…"
      className="h-8 border-transparent bg-transparent px-2 text-sm shadow-none hover:border-input focus-visible:border-input"
      onFocus={() => {
        setDraft(row.sufs_enrolled_notes);
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
          setDraft(row.sufs_enrolled_notes);
          setFocused(false);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

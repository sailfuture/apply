"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { adminFetcher } from "@/lib/admin-fetcher";
import type { PipelineFamilyRow } from "@/app/api/admin/pipeline/route";
import {
  PIPELINE_EXPORT_COLUMNS,
  PIPELINE_EXPORT_COLUMN_GROUPS,
  buildPipelineExportRows,
  type PipelineExportColumnKey,
  type PipelineExportRowPer,
} from "@/lib/pipeline-export-columns";

/**
 * "Export" button + modal for the Admissions Pipeline page. Opens a
 * dialog to pick a filename, the columns to include (grouped, with a
 * Select-all toggle), and which pipeline stages to include. Archived
 * families are always excluded. Generates the .xlsx client-side and
 * downloads it. The body — and its data fetch — only mount while the
 * dialog is open. Mirrors `EnrolledExportDialog`.
 */
export function PipelineExportDialog({
  yearId,
  yearName,
}: {
  yearId: number;
  yearName?: string | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {/* Default (h-9) size so the trigger lines up with the search
            input it shares a row with on the pipeline page. */}
        <Button variant="outline" className="bg-white shrink-0">
          <Download className="size-3.5 mr-1.5" aria-hidden="true" />
          Export
        </Button>
      </DialogTrigger>
      {open ? (
        <ExportDialogBody
          yearId={yearId}
          yearName={yearName}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </Dialog>
  );
}

function ExportDialogBody({
  yearId,
  yearName,
  onClose,
}: {
  yearId: number;
  yearName?: string | null;
  onClose: () => void;
}) {
  const { data, isLoading, error } = useSWR<PipelineFamilyRow[]>(
    `/api/admin/pipeline?yearId=${yearId}`,
    adminFetcher
  );
  const rows = useMemo(() => (Array.isArray(data) ? data : []), [data]);

  const [filename, setFilename] = useState(() => {
    const slug = (yearName ?? `year-${yearId}`)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
    return `admissions-pipeline-${slug || yearId}`;
  });
  const [selected, setSelected] = useState<Set<PipelineExportColumnKey>>(
    () =>
      new Set(
        PIPELINE_EXPORT_COLUMNS.filter((c) => c.defaultSelected).map(
          (c) => c.key
        )
      )
  );
  const [stages, setStages] = useState({
    application: true,
    registration: true,
    enrollment: true,
  });
  // Row shape — "family" is the original one-row-per-family export;
  // "student" puts every applicant on their own row (the shape bus-stop
  // routing needs). Switching to student mode auto-selects the Student
  // Name column (a per-student sheet without it is unreadable); it
  // never deselects anything.
  const [rowPer, setRowPerState] = useState<PipelineExportRowPer>("family");
  function setRowPer(mode: PipelineExportRowPer) {
    setRowPerState(mode);
    if (mode === "student") {
      setSelected((prev) =>
        prev.has("student_name")
          ? prev
          : new Set([...prev, "student_name" as PipelineExportColumnKey])
      );
    }
  }
  const [downloading, setDownloading] = useState(false);

  // Archived families never export — the pipeline export is the
  // active-funnel snapshot.
  const filtered = useMemo(
    () => rows.filter((r) => !r.is_archived && stages[r.stage]),
    [rows, stages]
  );

  const selectedColumns = useMemo(
    () => PIPELINE_EXPORT_COLUMNS.filter((c) => selected.has(c.key)),
    [selected]
  );
  const allSelected = selected.size === PIPELINE_EXPORT_COLUMNS.length;

  function toggleColumn(key: PipelineExportColumnKey) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  function toggleAll() {
    setSelected((prev) =>
      prev.size === PIPELINE_EXPORT_COLUMNS.length
        ? new Set<PipelineExportColumnKey>()
        : new Set(PIPELINE_EXPORT_COLUMNS.map((c) => c.key))
    );
  }
  function toggleGroup(group: string) {
    const groupKeys = PIPELINE_EXPORT_COLUMNS.filter(
      (c) => c.group === group
    ).map((c) => c.key);
    setSelected((prev) => {
      const next = new Set(prev);
      const allOn = groupKeys.every((k) => next.has(k));
      for (const k of groupKeys) {
        if (allOn) next.delete(k);
        else next.add(k);
      }
      return next;
    });
  }

  const exportRows = useMemo(
    () => buildPipelineExportRows(filtered, rowPer),
    [filtered, rowPer]
  );

  const canExport =
    selectedColumns.length > 0 &&
    exportRows.length > 0 &&
    filename.trim().length > 0 &&
    !downloading;

  async function runExport() {
    if (!canExport) return;
    setDownloading(true);
    try {
      const { exportPipelineXlsx } = await import("@/lib/pipeline-export");
      await exportPipelineXlsx({
        rows: exportRows,
        columns: selectedColumns,
        filename: filename.trim(),
      });
      toast.success(
        rowPer === "student"
          ? `Exported ${exportRows.length} student${exportRows.length === 1 ? "" : "s"}.`
          : `Exported ${filtered.length} famil${filtered.length === 1 ? "y" : "ies"}.`
      );
      onClose();
    } catch (err) {
      console.error("[PipelineExportDialog.runExport]", err);
      toast.error(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <DialogContent className="sm:max-w-2xl max-h-[88vh] flex flex-col gap-0 overflow-hidden">
      <DialogHeader>
        <DialogTitle>Export admissions pipeline</DialogTitle>
        <DialogDescription>
          Pick a filename, the row format, the columns to include, and
          which stages to export. Archived families are always excluded.
        </DialogDescription>
      </DialogHeader>

      <div className="flex-1 overflow-y-auto overscroll-contain space-y-5 py-4 pr-1">
        {/* Filename */}
        <div className="space-y-1.5">
          <Label htmlFor="pipeline-export-filename">File name</Label>
          <div className="flex items-center gap-2">
            <Input
              id="pipeline-export-filename"
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              className="bg-white"
              placeholder="admissions-pipeline"
            />
            <span className="text-sm text-muted-foreground shrink-0">
              .xlsx
            </span>
          </div>
        </div>

        {/* Row format */}
        <div className="rounded-md border bg-muted/10 p-3 space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Rows
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            <RadioRow
              name="pipeline-export-row-per"
              label="One row per family"
              checked={rowPer === "family"}
              onSelect={() => setRowPer("family")}
            />
            <RadioRow
              name="pipeline-export-row-per"
              label="One row per student"
              checked={rowPer === "student"}
              onSelect={() => setRowPer("student")}
            />
          </div>
          {rowPer === "student" ? (
            <p className="text-xs text-muted-foreground">
              Each applicant gets their own row — pair with the Students
              columns (bus stop, grade, pickup address) for bus-route
              planning. Family columns repeat per student.
            </p>
          ) : null}
        </div>

        {/* Stage filter */}
        <div className="rounded-md border bg-muted/10 p-3 space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Pipeline stages
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
            <CheckRow
              label="Applications"
              checked={stages.application}
              onChange={(v) => setStages((s) => ({ ...s, application: v }))}
            />
            <CheckRow
              label="Registrations"
              checked={stages.registration}
              onChange={(v) => setStages((s) => ({ ...s, registration: v }))}
            />
            <CheckRow
              label="Enrollments"
              checked={stages.enrollment}
              onChange={(v) => setStages((s) => ({ ...s, enrollment: v }))}
            />
          </div>
        </div>

        {/* Columns */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Columns</Label>
            <button
              type="button"
              onClick={toggleAll}
              className="text-xs font-medium text-blue-600 hover:underline"
            >
              {allSelected ? "Clear all" : "Select all"}
            </button>
          </div>
          <div className="rounded-md border bg-muted/10 p-3 space-y-3">
            {PIPELINE_EXPORT_COLUMN_GROUPS.map((group) => (
              <div key={group} className="space-y-1.5">
                <button
                  type="button"
                  onClick={() => toggleGroup(group)}
                  className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
                  title="Toggle this group"
                >
                  {group}
                </button>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-1.5">
                  {PIPELINE_EXPORT_COLUMNS.filter(
                    (c) => c.group === group
                  ).map((c) => (
                    <CheckRow
                      key={c.key}
                      label={c.label}
                      checked={selected.has(c.key)}
                      onChange={() => toggleColumn(c.key)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <DialogFooter className="flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-t pt-4">
        <p className="text-xs text-muted-foreground">
          {isLoading
            ? "Loading families…"
            : error
              ? "Failed to load families."
              : rowPer === "student"
                ? `${exportRows.length} student${exportRows.length === 1 ? "" : "s"} across ${filtered.length} famil${filtered.length === 1 ? "y" : "ies"} · ${selectedColumns.length} column${selectedColumns.length === 1 ? "" : "s"}`
                : `${filtered.length} famil${filtered.length === 1 ? "y" : "ies"} · ${selectedColumns.length} column${selectedColumns.length === 1 ? "" : "s"}`}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={onClose} disabled={downloading}>
            Cancel
          </Button>
          <Button onClick={() => void runExport()} disabled={!canExport}>
            {downloading ? (
              <Loader2
                className="size-3.5 mr-1.5 animate-spin"
                aria-hidden="true"
              />
            ) : (
              <Download className="size-3.5 mr-1.5" aria-hidden="true" />
            )}
            Export XLSX
          </Button>
        </div>
      </DialogFooter>
    </DialogContent>
  );
}

function RadioRow({
  name,
  label,
  checked,
  onSelect,
}: {
  name: string;
  label: string;
  checked: boolean;
  onSelect: () => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onSelect}
        className="size-4 shrink-0 border-input accent-foreground"
      />
      <span className="truncate">{label}</span>
    </label>
  );
}

function CheckRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 shrink-0 rounded border-input accent-foreground"
      />
      <span className="truncate">{label}</span>
    </label>
  );
}

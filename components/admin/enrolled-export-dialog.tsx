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
import {
  EXPORT_COLUMNS,
  EXPORT_COLUMN_GROUPS,
  type EnrolledExportRow,
  type ExportColumnKey,
} from "@/lib/enrolled-export-columns";

/**
 * "Export" button + modal for the Enrolled Students page. Opens a
 * dialog to pick a filename, the columns to include (grouped, with a
 * Select-all toggle), and which students to include (enrolled /
 * unenrolled × community / residential). Generates the .xlsx
 * client-side and downloads it. The body — and its data fetch — only
 * mount while the dialog is open.
 *
 * Pass `scope` to export just one grade card: the dialog then covers
 * only those students (the card already reflects the page's search +
 * chips), so the status/program filters are hidden.
 */
export function EnrolledExportDialog({
  yearId,
  yearName,
  scope,
}: {
  yearId: number;
  yearName?: string | null;
  scope?: { label: string; studentIds: number[] };
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {scope ? (
          <Button
            variant="outline"
            size="sm"
            className="h-7 bg-white px-2.5 text-xs"
            disabled={scope.studentIds.length === 0}
            title={`Export the ${scope.studentIds.length} student${scope.studentIds.length === 1 ? "" : "s"} in this card`}
          >
            <Download className="size-3.5 mr-1" aria-hidden="true" />
            Export
          </Button>
        ) : (
          <Button variant="outline" size="sm" className="bg-white shrink-0">
            <Download className="size-3.5 mr-1.5" aria-hidden="true" />
            Export
          </Button>
        )}
      </DialogTrigger>
      {open ? (
        <ExportDialogBody
          yearId={yearId}
          yearName={yearName}
          scope={scope}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </Dialog>
  );
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function ExportDialogBody({
  yearId,
  yearName,
  scope,
  onClose,
}: {
  yearId: number;
  yearName?: string | null;
  scope?: { label: string; studentIds: number[] };
  onClose: () => void;
}) {
  const { data, isLoading, error } = useSWR<EnrolledExportRow[]>(
    `/api/admin/enrolled/export?yearId=${yearId}`,
    adminFetcher
  );
  const rows = useMemo(() => (Array.isArray(data) ? data : []), [data]);

  const [filename, setFilename] = useState(() => {
    const slug = slugify(yearName ?? `year-${yearId}`);
    const scopeSlug = scope ? slugify(scope.label) : "";
    return `enrolled-students-${scopeSlug ? `${scopeSlug}-` : ""}${slug || yearId}`;
  });
  const scopeIds = useMemo(
    () => (scope ? new Set(scope.studentIds) : null),
    [scope]
  );
  const [selected, setSelected] = useState<Set<ExportColumnKey>>(
    () =>
      new Set(
        EXPORT_COLUMNS.filter((c) => c.defaultSelected).map((c) => c.key)
      )
  );
  const [status, setStatus] = useState({ enrolled: true, unenrolled: true });
  const [program, setProgram] = useState({
    community: true,
    residential: true,
  });
  const [downloading, setDownloading] = useState(false);

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        // A grade-card export covers exactly that card's students.
        if (scopeIds) return scopeIds.has(r.student_id);
        const statusOk =
          (r.is_enrolled && status.enrolled) ||
          (r.is_archived && status.unenrolled);
        const programOk = r.is_residential
          ? program.residential
          : program.community;
        return statusOk && programOk;
      }),
    [rows, status, program, scopeIds]
  );

  const selectedColumns = useMemo(
    () => EXPORT_COLUMNS.filter((c) => selected.has(c.key)),
    [selected]
  );
  const allSelected = selected.size === EXPORT_COLUMNS.length;

  function toggleColumn(key: ExportColumnKey) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  function toggleAll() {
    setSelected((prev) =>
      prev.size === EXPORT_COLUMNS.length
        ? new Set<ExportColumnKey>()
        : new Set(EXPORT_COLUMNS.map((c) => c.key))
    );
  }
  function toggleGroup(group: string) {
    const groupKeys = EXPORT_COLUMNS.filter((c) => c.group === group).map(
      (c) => c.key
    );
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

  const canExport =
    selectedColumns.length > 0 &&
    filtered.length > 0 &&
    filename.trim().length > 0 &&
    !downloading;

  async function runExport() {
    if (!canExport) return;
    setDownloading(true);
    try {
      const { exportEnrolledXlsx } = await import("@/lib/enrolled-export");
      await exportEnrolledXlsx({
        rows: filtered,
        columns: selectedColumns,
        filename: filename.trim(),
      });
      toast.success(
        `Exported ${filtered.length} student${filtered.length === 1 ? "" : "s"}.`
      );
      onClose();
    } catch (err) {
      console.error("[EnrolledExportDialog.runExport]", err);
      toast.error(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <DialogContent className="sm:max-w-2xl max-h-[88vh] flex flex-col gap-0 overflow-hidden">
      <DialogHeader>
        <DialogTitle>
          {scope ? `Export ${scope.label}` : "Export enrolled students"}
        </DialogTitle>
        <DialogDescription>
          {scope
            ? `Pick a filename and the columns to include for the students shown in the ${scope.label} card. Each row is a student; the columns are the fields you choose.`
            : "Pick a filename, the columns to include, and which students to export. Each row is a student; the columns are the fields you choose."}
        </DialogDescription>
      </DialogHeader>

      <div className="flex-1 overflow-y-auto overscroll-contain space-y-5 py-4 pr-1">
        {/* Filename */}
        <div className="space-y-1.5">
          <Label htmlFor="export-filename">File name</Label>
          <div className="flex items-center gap-2">
            <Input
              id="export-filename"
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              className="bg-white"
              placeholder="enrolled-students"
            />
            <span className="text-sm text-muted-foreground shrink-0">.xlsx</span>
          </div>
        </div>

        {/* Filters — hidden for a grade-card export, whose students
            are fixed by the card. */}
        {scope ? null : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FilterGroup title="Enrollment status">
            <CheckRow
              label="Enrolled"
              checked={status.enrolled}
              onChange={(v) => setStatus((s) => ({ ...s, enrolled: v }))}
            />
            <CheckRow
              label="Unenrolled"
              checked={status.unenrolled}
              onChange={(v) => setStatus((s) => ({ ...s, unenrolled: v }))}
            />
          </FilterGroup>
          <FilterGroup title="Program">
            <CheckRow
              label="Community"
              checked={program.community}
              onChange={(v) => setProgram((p) => ({ ...p, community: v }))}
            />
            <CheckRow
              label="Residential"
              checked={program.residential}
              onChange={(v) => setProgram((p) => ({ ...p, residential: v }))}
            />
          </FilterGroup>
        </div>
        )}

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
            {EXPORT_COLUMN_GROUPS.map((group) => (
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
                  {EXPORT_COLUMNS.filter((c) => c.group === group).map((c) => (
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
            ? "Loading students…"
            : error
              ? "Failed to load students."
              : `${filtered.length} student${filtered.length === 1 ? "" : "s"} · ${selectedColumns.length} column${selectedColumns.length === 1 ? "" : "s"}`}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={onClose} disabled={downloading}>
            Cancel
          </Button>
          <Button onClick={() => void runExport()} disabled={!canExport}>
            {downloading ? (
              <Loader2 className="size-3.5 mr-1.5 animate-spin" aria-hidden="true" />
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

function FilterGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border bg-muted/10 p-3 space-y-1.5">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </p>
      {children}
    </div>
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

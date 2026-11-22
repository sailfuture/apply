"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { AllLeadRow } from "@/app/api/admin/all-leads/route";
import {
  LEAD_EXPORT_COLUMNS,
  type LeadExportFormat,
} from "@/lib/lead-export";

/** "view" = what the board is showing right now (filters + search);
 *  "all" = every lead in every year, ignoring the filters. */
export type LeadExportScope = "view" | "all";

/**
 * "Export" button + dialog for the All Leads page. Downloads one row
 * per lead as an .xlsx (opens in Google Sheets) or a .csv.
 *
 * The page owns the filtering — `rowsFor` hands back the leads for a
 * scope, already in the board's order with duplicates folded — so the
 * file always matches the board and the two can't drift. Archived
 * leads are a visible, explicit choice here: off by default, exactly
 * like the board, with the count they would add shown on the toggle.
 */
export function LeadExportDialog({
  rowsFor,
  viewSummary,
  archivedOnlyView,
  disabled,
}: {
  /** Leads for a scope, in export order. With `includeArchived`, the
   *  archived leads matching the same scope ride along. */
  rowsFor: (scope: LeadExportScope, includeArchived: boolean) => AllLeadRow[];
  /** The board's active filters, in words, for the "current view"
   *  option — so it's plain what the export is narrowed to. */
  viewSummary: string[];
  /** The Status filter is on "Archived": the current view IS the
   *  archived leads, and nothing else. */
  archivedOnlyView: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 shrink-0 bg-white"
          disabled={disabled}
          title="Download these leads as a spreadsheet for Google Sheets or Excel"
        >
          <Download className="size-3.5 mr-1.5" aria-hidden="true" />
          Export
        </Button>
      </DialogTrigger>
      {open ? (
        <ExportDialogBody
          rowsFor={rowsFor}
          viewSummary={viewSummary}
          archivedOnlyView={archivedOnlyView}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </Dialog>
  );
}

function ExportDialogBody({
  rowsFor,
  viewSummary,
  archivedOnlyView,
  onClose,
}: {
  rowsFor: (scope: LeadExportScope, includeArchived: boolean) => AllLeadRow[];
  viewSummary: string[];
  archivedOnlyView: boolean;
  onClose: () => void;
}) {
  const [scope, setScope] = useState<LeadExportScope>("view");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [format, setFormat] = useState<LeadExportFormat>("xlsx");
  const [downloading, setDownloading] = useState(false);

  // Every combination up front — the option labels carry their counts.
  const sets = useMemo(
    () => ({
      view: { board: rowsFor("view", false), withArchived: rowsFor("view", true) },
      all: { board: rowsFor("all", false), withArchived: rowsFor("all", true) },
    }),
    [rowsFor]
  );

  // On the Archived view the toggle has nothing to add: that view is
  // the archived leads already.
  const archivedLocked = scope === "view" && archivedOnlyView;
  const rows =
    includeArchived && !archivedLocked
      ? sets[scope].withArchived
      : sets[scope].board;
  const archivedExtra =
    sets[scope].withArchived.length - sets[scope].board.length;

  const archivedNote = archivedLocked
    ? "archived leads only"
    : includeArchived && archivedExtra > 0
      ? `including ${archivedExtra} archived`
      : "archived leads not included";

  const canExport = rows.length > 0 && !downloading;

  async function runExport() {
    if (!canExport) return;
    setDownloading(true);
    try {
      const { exportLeads } = await import("@/lib/lead-export");
      await exportLeads({
        rows,
        format,
        scope: scope === "view" ? "current-view" : "all",
      });
      toast.success(
        `Exported ${rows.length} lead${rows.length === 1 ? "" : "s"}.`
      );
      onClose();
    } catch (err) {
      console.error("[LeadExportDialog.runExport]", err);
      toast.error(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <DialogContent className="sm:max-w-lg max-h-[88vh] flex flex-col gap-0 overflow-hidden">
      <DialogHeader>
        <DialogTitle>Export leads</DialogTitle>
        <DialogDescription>
          Downloads a spreadsheet with one row per lead. To open it in
          Google Sheets, use File &rarr; Import, or upload it to Drive.
        </DialogDescription>
      </DialogHeader>

      <div className="flex-1 overflow-y-auto overscroll-contain space-y-4 py-4 pr-1">
        <div className="rounded-md border bg-muted/10 p-3 space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Which leads
          </p>
          <RadioRow
            name="lead-export-scope"
            label={`Leads in the current view (${sets.view.board.length.toLocaleString()})`}
            checked={scope === "view"}
            onSelect={() => setScope("view")}
          />
          <p className="pl-6 text-xs text-muted-foreground">
            {viewSummary.join(" · ")}
          </p>
          <RadioRow
            name="lead-export-scope"
            label={`Every lead, all years (${sets.all.board.length.toLocaleString()})`}
            checked={scope === "all"}
            onSelect={() => setScope("all")}
          />
        </div>

        <div className="rounded-md border bg-muted/10 p-3 space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Archived leads
          </p>
          {archivedLocked ? (
            <p className="text-sm">
              The current view is the archived leads, so this export is
              archived leads only.
            </p>
          ) : (
            <>
              <CheckRow
                label={`Include archived leads (${archivedExtra.toLocaleString()})`}
                checked={includeArchived}
                disabled={archivedExtra === 0}
                onChange={setIncludeArchived}
              />
              <p className="pl-6 text-xs text-muted-foreground">
                Duplicates, junk and test rows parked off the board. Left
                out unless you tick this; the Status column marks them.
              </p>
            </>
          )}
        </div>

        <div className="rounded-md border bg-muted/10 p-3 space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            File type
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            <RadioRow
              name="lead-export-format"
              label="Spreadsheet (.xlsx)"
              checked={format === "xlsx"}
              onSelect={() => setFormat("xlsx")}
            />
            <RadioRow
              name="lead-export-format"
              label="CSV (.csv)"
              checked={format === "csv"}
              onSelect={() => setFormat("csv")}
            />
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Linked duplicates count once, under their main lead, as on the
          board. The &ldquo;Also Signed Up Via&rdquo; column names the
          other sign-ups folded into each one.
        </p>
      </div>

      <DialogFooter className="flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-t pt-4">
        <p className="text-xs text-muted-foreground">
          {rows.length.toLocaleString()} lead{rows.length === 1 ? "" : "s"}{" "}
          · {LEAD_EXPORT_COLUMNS.length} columns · {archivedNote}
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
            Export
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
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      className={
        disabled
          ? "flex items-center gap-2 text-sm select-none text-muted-foreground"
          : "flex items-center gap-2 text-sm cursor-pointer select-none"
      }
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 shrink-0 rounded border-input accent-foreground"
      />
      <span className="truncate">{label}</span>
    </label>
  );
}

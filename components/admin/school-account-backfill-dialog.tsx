"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { KeyRound, Loader2 } from "lucide-react";
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
import { cn } from "@/lib/utils";
import type {
  BackfillResponse,
  BackfillRow,
  BackfillStatus,
} from "@/app/api/admin/school-accounts/backfill/route";

const STATUS_META: Record<
  BackfillStatus,
  { label: string; className: string }
> = {
  planned: {
    label: "Will generate",
    className: "bg-blue-50 text-blue-700 border-blue-200",
  },
  updated: {
    label: "Generated",
    className: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  skipped_existing: {
    label: "Already has account",
    className: "bg-muted text-muted-foreground border-border",
  },
  no_year: {
    label: "No school year",
    className: "bg-amber-50 text-amber-700 border-amber-200",
  },
  no_name: {
    label: "Name incomplete",
    className: "bg-amber-50 text-amber-700 border-amber-200",
  },
  conflict: {
    label: "Email conflict",
    className: "bg-red-50 text-red-700 border-red-200",
  },
  error: {
    label: "Write failed",
    className: "bg-red-50 text-red-700 border-red-200",
  },
};

/**
 * "Generate school accounts" button + modal for the Enrolled Students
 * page. Opening the dialog runs a DRY RUN of
 * `/api/admin/school-accounts/backfill` and shows the full plan —
 * who gets an email generated (from their earliest associated school
 * year), who already has one, and who needs attention (missing year,
 * duplicate email). Confirming re-POSTs without `dryRun` to write the
 * accounts. Idempotent: students with a stored `school_email` are
 * never touched, so re-running is always safe.
 */
export function SchoolAccountBackfillDialog({
  onDone,
}: {
  /** Fired after a successful live run so the host can revalidate. */
  onDone?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="bg-white shrink-0">
          <KeyRound className="size-3.5 mr-1.5" aria-hidden="true" />
          Create Student Emails
        </Button>
      </DialogTrigger>
      {open ? (
        <BackfillDialogBody onClose={() => setOpen(false)} onDone={onDone} />
      ) : null}
    </Dialog>
  );
}

function BackfillDialogBody({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone?: () => void;
}) {
  const [preview, setPreview] = useState<BackfillResponse | null>(null);
  const [result, setResult] = useState<BackfillResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  // Dry-run on mount — the plan IS the dialog content.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/school-accounts/backfill", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dryRun: true }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(data?.error ?? `Preview failed (${res.status})`);
        }
        if (!cancelled) setPreview(data as BackfillResponse);
      } catch (err) {
        console.error("[SchoolAccountBackfillDialog.preview]", err);
        if (!cancelled) {
          setLoadError(
            err instanceof Error ? err.message : "Couldn't load the preview."
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function runBackfill() {
    setRunning(true);
    try {
      const res = await fetch("/api/admin/school-accounts/backfill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: false }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error ?? `Backfill failed (${res.status})`);
      }
      const live = data as BackfillResponse;
      setResult(live);
      const failures = live.totals.error + live.totals.conflict;
      if (live.totals.updated > 0) {
        toast.success(
          `Generated ${live.totals.updated} school account${live.totals.updated === 1 ? "" : "s"}.`
        );
      } else if (failures === 0) {
        toast.info("Nothing to generate — every student is covered.");
      }
      if (failures > 0) {
        toast.error(
          `${failures} student${failures === 1 ? "" : "s"} need attention — see the list.`
        );
      }
      onDone?.();
    } catch (err) {
      console.error("[SchoolAccountBackfillDialog.run]", err);
      toast.error(
        err instanceof Error ? err.message : "Couldn't run the backfill."
      );
    } finally {
      setRunning(false);
    }
  }

  const shown = result ?? preview;
  const actionable = preview ? preview.totals.planned : 0;

  return (
    <DialogContent className="sm:max-w-4xl max-h-[88vh] flex flex-col gap-0 overflow-hidden">
      <DialogHeader>
        <DialogTitle>Create Student Emails</DialogTitle>
        <DialogDescription>
          Creates the school email + starter password for every enrolled
          student who doesn&rsquo;t have one, using each student&rsquo;s
          earliest school year for the email&rsquo;s two-digit suffix.
          Students with an existing account are never touched.
        </DialogDescription>
      </DialogHeader>

      <div className="flex-1 overflow-y-auto overscroll-contain py-4 pr-1 space-y-4">
        {loadError ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            {loadError}
          </p>
        ) : !shown ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Computing the plan…
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(STATUS_META) as BackfillStatus[])
                .filter((k) => shown.totals[k] > 0)
                .map((k) => (
                  <span
                    key={k}
                    className={cn(
                      "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
                      STATUS_META[k].className
                    )}
                  >
                    {shown.totals[k]} · {STATUS_META[k].label}
                  </span>
                ))}
            </div>
            {/* Two groups: students WITHOUT an account first (the ones
                this action is for — planned generates and anything
                blocking one), then the already-covered roster below. */}
            <RowGroup
              title="Without an email account"
              emptyText="Every enrolled student already has an email account."
              rows={shown.rows.filter((r) => r.status !== "skipped_existing")}
            />
            <RowGroup
              title="Already has an email account"
              rows={shown.rows.filter((r) => r.status === "skipped_existing")}
            />
          </>
        )}
      </div>

      <DialogFooter className="flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-t pt-4">
        <p className="text-xs text-muted-foreground">
          {result
            ? "Done — accounts are saved on each student's School Account card."
            : preview
              ? `${actionable} account${actionable === 1 ? "" : "s"} will be generated.`
              : ""}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={onClose} disabled={running}>
            {result ? "Close" : "Cancel"}
          </Button>
          {!result ? (
            <Button
              onClick={() => void runBackfill()}
              disabled={running || !preview || actionable === 0}
            >
              {running ? (
                <Loader2
                  className="size-3.5 mr-1.5 animate-spin"
                  aria-hidden="true"
                />
              ) : (
                <KeyRound className="size-3.5 mr-1.5" aria-hidden="true" />
              )}
              Generate {actionable > 0 ? actionable : ""} account
              {actionable === 1 ? "" : "s"}
            </Button>
          ) : null}
        </div>
      </DialogFooter>
    </DialogContent>
  );
}

/** One bordered table card for a group of rows, headed by the group
 *  title + count. Passwords are deliberately NOT shown here — each
 *  student's School Account card is the place to read them. */
function RowGroup({
  title,
  rows,
  emptyText,
}: {
  title: string;
  rows: BackfillRow[];
  /** Rendered instead of the card when the group is empty; omit to
   *  hide an empty group entirely. */
  emptyText?: string;
}) {
  if (rows.length === 0) {
    return emptyText ? (
      <p className="text-sm text-muted-foreground">{emptyText}</p>
    ) : null;
  }
  return (
    <div className="rounded-md border overflow-hidden">
      <p className="border-b bg-muted/40 px-3 py-2 text-xs font-semibold">
        {title} ({rows.length})
      </p>
      {/* Fixed layout with per-column widths so the table always fits
          the dialog — long values truncate (full value on hover)
          instead of forcing a horizontal scroll. */}
      <table className="w-full table-fixed text-sm">
        <colgroup>
          <col className="w-[26%]" />
          <col className="w-[14%]" />
          <col className="w-[38%]" />
          <col className="w-[22%]" />
        </colgroup>
        <thead>
          <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
            <th className="px-3 py-2 font-medium">Student</th>
            <th className="px-3 py-2 font-medium">Year</th>
            <th className="px-3 py-2 font-medium">Email</th>
            <th className="px-3 py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((row) => (
            <BackfillRowView key={row.student_id} row={row} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BackfillRowView({ row }: { row: BackfillRow }) {
  const meta = STATUS_META[row.status];
  return (
    <tr className="align-top">
      <td
        className="px-3 py-2 font-medium overflow-hidden text-ellipsis whitespace-nowrap"
        title={row.student_name}
      >
        {row.student_name}
      </td>
      <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
        {row.year_name || "—"}
      </td>
      <td
        className="px-3 py-2 font-mono text-[13px] overflow-hidden text-ellipsis whitespace-nowrap"
        title={row.email || undefined}
      >
        {row.email || "—"}
      </td>
      <td className="px-3 py-2 overflow-hidden whitespace-nowrap">
        {/* Row-level explanation (missing year, conflict, write error)
            lives on the badge tooltip — the table itself stays terse. */}
        <span
          title={row.detail || undefined}
          className={cn(
            "inline-flex max-w-full items-center overflow-hidden text-ellipsis rounded-full border px-2 py-0.5 text-xs font-medium",
            meta.className
          )}
        >
          {meta.label}
        </span>
      </td>
    </tr>
  );
}

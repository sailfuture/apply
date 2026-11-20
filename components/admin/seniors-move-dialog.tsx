"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { GraduationCap, Loader2 } from "lucide-react";
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
  SeniorsMoveResponse,
  SeniorsMoveRow,
  SeniorsMoveStatus,
} from "@/lib/google-student-ou";

const STATUS_META: Record<
  SeniorsMoveStatus,
  { label: string; className: string }
> = {
  planned: {
    label: "Will move",
    className: "bg-blue-50 text-blue-700 border-blue-200",
  },
  moved: {
    label: "Moved",
    className: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  moved_unlocked: {
    label: "Moved, not restricted",
    className: "bg-amber-50 text-amber-700 border-amber-200",
  },
  failed: {
    label: "Failed",
    className: "bg-red-50 text-red-700 border-red-200",
  },
  in_place: {
    label: "Already in place",
    className: "bg-muted text-muted-foreground border-border",
  },
  no_account: {
    label: "No Google account",
    className: "bg-amber-50 text-amber-700 border-amber-200",
  },
  no_email: {
    label: "No school email",
    className: "bg-amber-50 text-amber-700 border-amber-200",
  },
};

/** Rows the action is about: moved, would be moved, or tried and
 *  failed. Everything else is a skip. */
const ACTION_STATUSES: SeniorsMoveStatus[] = [
  "planned",
  "moved",
  "moved_unlocked",
  "failed",
];

/**
 * "Move to Seniors" button + modal for the 12th grade card on the
 * Enrolled Students page — the School Account card's move, for every
 * student in the card at once.
 *
 * Opening the dialog runs a DRY RUN of
 * `/api/admin/students/move-to-seniors`, which looks up each student's
 * Google account (read-only) and lists where it is, who would move and
 * who is skipped. Confirming re-POSTs with `dryRun: false`, then shows
 * each student's result. Safe to re-run: a student already in their
 * Seniors org unit is reported and left alone.
 */
export function SeniorsMoveDialog({ studentIds }: { studentIds: number[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-7 bg-white px-2.5 text-xs"
          disabled={studentIds.length === 0}
          title="Move every student in this card into their own org unit under Seniors in Google Workspace"
        >
          <GraduationCap className="mr-1 size-3.5" aria-hidden="true" />
          Move to Seniors
        </Button>
      </DialogTrigger>
      {open ? (
        <MoveDialogBody
          studentIds={studentIds}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </Dialog>
  );
}

function MoveDialogBody({
  studentIds,
  onClose,
}: {
  studentIds: number[];
  onClose: () => void;
}) {
  const [preview, setPreview] = useState<SeniorsMoveResponse | null>(null);
  const [result, setResult] = useState<SeniorsMoveResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  // The students the dialog opened on. The card's list changes with
  // the search box behind the dialog; what was previewed is what runs.
  const [ids] = useState(studentIds);

  // Dry-run on mount — the plan IS the dialog content.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/students/move-to-seniors", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ studentIds: ids, dryRun: true }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(data?.error ?? `Preview failed (${res.status})`);
        }
        if (!cancelled) setPreview(data as SeniorsMoveResponse);
      } catch (err) {
        console.error("[SeniorsMoveDialog.preview]", err);
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
  }, [ids]);

  async function runMove() {
    setRunning(true);
    try {
      const res = await fetch("/api/admin/students/move-to-seniors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentIds: ids, dryRun: false }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error ?? `Move failed (${res.status})`);
      }
      const live = data as SeniorsMoveResponse;
      setResult(live);
      const { moved_unlocked: unlocked, failed } = live.totals;
      const moved = live.totals.moved + unlocked;
      if (moved > 0) {
        toast.success(
          `Moved ${moved} student${moved === 1 ? "" : "s"} to Seniors.`
        );
      } else if (failed === 0) {
        toast.info("No one needed moving.");
      }
      if (unlocked > 0) {
        toast.warning(
          `${unlocked} moved without a sign-in restriction. See the list.`
        );
      }
      if (failed > 0) {
        toast.error(
          `${failed} student${failed === 1 ? "" : "s"} didn't move. See the list.`
        );
      }
    } catch (err) {
      console.error("[SeniorsMoveDialog.run]", err);
      toast.error(err instanceof Error ? err.message : "Couldn't run the move.");
    } finally {
      setRunning(false);
    }
  }

  const shown = result ?? preview;
  const actionable = preview ? preview.totals.planned : 0;
  const parent = shown?.seniorParentPath ?? "the Seniors org unit";

  return (
    <DialogContent className="sm:max-w-4xl max-h-[88vh] flex flex-col gap-0 overflow-hidden">
      <DialogHeader>
        <DialogTitle>Move to Seniors</DialogTitle>
        <DialogDescription>
          Moves each student&rsquo;s Google account into their own org unit
          under <span className="font-mono">{parent}</span>, created if it
          doesn&rsquo;t exist. Each org unit only lets that student sign in
          on a laptop, and a laptop they have checked out moves with them.
          Passwords and mailboxes don&rsquo;t change.
        </DialogDescription>
      </DialogHeader>

      <div className="flex-1 overflow-y-auto overscroll-contain py-4 pr-1 space-y-4">
        {loadError ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            {loadError}
          </p>
        ) : running && !result ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Moving accounts in Google… this can take a minute.
          </div>
        ) : !shown ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Checking each student&rsquo;s Google account…
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(STATUS_META) as SeniorsMoveStatus[])
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
            <RowGroup
              afterRun={Boolean(result)}
              title={result ? "Moved to Seniors" : "Will move"}
              emptyText="Every student with a Google account is already in their Seniors org unit."
              rows={shown.rows.filter((r) =>
                ACTION_STATUSES.includes(r.status)
              )}
            />
            <RowGroup
              afterRun={Boolean(result)}
              title="Skipped"
              rows={shown.rows.filter(
                (r) => !ACTION_STATUSES.includes(r.status)
              )}
            />
          </>
        )}
      </div>

      <DialogFooter className="flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-t pt-4">
        <p className="text-xs text-muted-foreground">
          {result
            ? "Done. A laptop picks up its new sign-in rule the next time it syncs."
            : preview
              ? `${actionable} Google account${actionable === 1 ? "" : "s"} will move.`
              : ""}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={onClose} disabled={running}>
            {result ? "Close" : "Cancel"}
          </Button>
          {!result ? (
            <Button
              onClick={() => void runMove()}
              disabled={running || !preview || actionable === 0}
            >
              {running ? (
                <Loader2
                  className="size-3.5 mr-1.5 animate-spin"
                  aria-hidden="true"
                />
              ) : (
                <GraduationCap className="size-3.5 mr-1.5" aria-hidden="true" />
              )}
              Move {actionable > 0 ? actionable : ""} student
              {actionable === 1 ? "" : "s"}
            </Button>
          ) : null}
        </div>
      </DialogFooter>
    </DialogContent>
  );
}

/** One bordered table card for a group of rows, headed by the group
 *  title + count. */
function RowGroup({
  title,
  rows,
  emptyText,
  afterRun,
}: {
  title: string;
  /** True once the live run has finished, so the org unit column
   *  reads as where the account was BEFORE the move. */
  afterRun: boolean;
  rows: SeniorsMoveRow[];
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
      {/* Fixed layout so the table always fits the dialog — long
          values truncate (full value on hover) instead of scrolling. */}
      <table className="w-full table-fixed text-sm">
        <colgroup>
          <col className="w-[24%]" />
          <col className="w-[28%]" />
          <col className="w-[28%]" />
          <col className="w-[20%]" />
        </colgroup>
        <thead>
          <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
            <th className="px-3 py-2 font-medium">Student</th>
            <th className="px-3 py-2 font-medium">Email</th>
            <th className="px-3 py-2 font-medium">
              {afterRun ? "Org unit before" : "Org unit now"}
            </th>
            <th className="px-3 py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((row) => (
            <MoveRowView key={row.student_id} row={row} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MoveRowView({ row }: { row: SeniorsMoveRow }) {
  const meta = STATUS_META[row.status];
  return (
    <tr className="align-top">
      <td
        className="px-3 py-2 font-medium overflow-hidden text-ellipsis whitespace-nowrap"
        title={row.student_name}
      >
        {row.student_name}
      </td>
      <td
        className="px-3 py-2 font-mono text-[13px] overflow-hidden text-ellipsis whitespace-nowrap"
        title={row.email || undefined}
      >
        {row.email || "—"}
      </td>
      {/* Where the account sits today. The destination is on the
          hover: it is always the student's own unit under Seniors. */}
      <td
        className="px-3 py-2 font-mono text-[13px] text-muted-foreground overflow-hidden text-ellipsis whitespace-nowrap"
        title={
          row.from
            ? row.to && row.to !== row.from
              ? `${row.from} → ${row.to}`
              : row.from
            : undefined
        }
      >
        {row.from || "—"}
      </td>
      <td className="px-3 py-2 overflow-hidden whitespace-nowrap">
        {/* Why a row was skipped or failed — and what happened to a
            laptop — lives on the badge tooltip; the table stays terse. */}
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

"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ImageUp, Loader2 } from "lucide-react";
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
  PhotoBackfillResponse,
  PhotoBackfillRow,
  PhotoBackfillStatus,
} from "@/lib/google-photo-backfill";

const STATUS_META: Record<
  PhotoBackfillStatus,
  { label: string; className: string }
> = {
  planned: {
    label: "Will set photo",
    className: "bg-blue-50 text-blue-700 border-blue-200",
  },
  synced: {
    label: "Photo set",
    className: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  failed: {
    label: "Failed",
    className: "bg-red-50 text-red-700 border-red-200",
  },
  no_account: {
    label: "No Google account",
    className: "bg-amber-50 text-amber-700 border-amber-200",
  },
  no_email: {
    label: "No school email",
    className: "bg-amber-50 text-amber-700 border-amber-200",
  },
  no_photo: {
    label: "No photo on file",
    className: "bg-muted text-muted-foreground border-border",
  },
};

/** Rows the action is about: pushed, would be pushed, or tried and
 *  failed. Everything else is a skip. */
const ACTION_STATUSES: PhotoBackfillStatus[] = ["planned", "synced", "failed"];

/**
 * "Sync Photos to Google" button + modal for the Enrolled Students
 * page. Opening the dialog runs a DRY RUN of
 * `/api/admin/students/google-photo-sync-all`, which looks up every
 * enrolled student's Google account (read-only) and lists who would
 * get their stored photo and who is skipped. Confirming re-POSTs
 * with `dryRun: false` to push the photos, then shows each student's
 * result. Safe to re-run: pushing a photo again just re-sets it, and
 * nothing here ever removes a Google photo.
 */
export function GooglePhotoSyncDialog() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="bg-white shrink-0">
          <ImageUp className="size-3.5 mr-1.5" aria-hidden="true" />
          Sync Photos to Google
        </Button>
      </DialogTrigger>
      {open ? <SyncDialogBody onClose={() => setOpen(false)} /> : null}
    </Dialog>
  );
}

function SyncDialogBody({ onClose }: { onClose: () => void }) {
  const [preview, setPreview] = useState<PhotoBackfillResponse | null>(null);
  const [result, setResult] = useState<PhotoBackfillResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  // Dry-run on mount — the plan IS the dialog content.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/students/google-photo-sync-all", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dryRun: true }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(data?.error ?? `Preview failed (${res.status})`);
        }
        if (!cancelled) setPreview(data as PhotoBackfillResponse);
      } catch (err) {
        console.error("[GooglePhotoSyncDialog.preview]", err);
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

  async function runSync() {
    setRunning(true);
    try {
      const res = await fetch("/api/admin/students/google-photo-sync-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: false }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error ?? `Sync failed (${res.status})`);
      }
      const live = data as PhotoBackfillResponse;
      setResult(live);
      const { synced, failed } = live.totals;
      if (synced > 0) {
        toast.success(
          `Set ${synced} Google profile photo${synced === 1 ? "" : "s"}.`
        );
      } else if (failed === 0) {
        toast.info("No photos to push.");
      }
      if (failed > 0) {
        toast.error(
          `${failed} photo${failed === 1 ? "" : "s"} didn't go through. See the list.`
        );
      }
    } catch (err) {
      console.error("[GooglePhotoSyncDialog.run]", err);
      toast.error(err instanceof Error ? err.message : "Couldn't run the sync.");
    } finally {
      setRunning(false);
    }
  }

  const shown = result ?? preview;
  const actionable = preview ? preview.totals.planned : 0;
  const replacing = preview
    ? preview.rows.filter((r) => r.status === "planned" && r.google_had_photo)
        .length
    : 0;

  return (
    <DialogContent className="sm:max-w-4xl max-h-[88vh] flex flex-col gap-0 overflow-hidden">
      <DialogHeader>
        <DialogTitle>Sync Photos to Google</DialogTitle>
        <DialogDescription>
          Sets each enrolled student&rsquo;s Google profile photo to the
          photo on their Student Photo card, so it shows in Gmail, Meet,
          Classroom, and on the Chromebook sign-in screen. Students with no
          photo on file are left alone, and no Google photo is ever removed.
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
            Pushing photos to Google…
          </div>
        ) : !shown ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Checking each student&rsquo;s Google account…
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(STATUS_META) as PhotoBackfillStatus[])
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
              title={result ? "Pushed to Google" : "Will get their photo"}
              emptyText="No enrolled student has both a photo and a Google account."
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
            ? "Done. Google can take a few hours to show a new photo everywhere."
            : preview
              ? `${actionable} Google account${actionable === 1 ? "" : "s"} will get the student's photo` +
                (replacing > 0
                  ? `, replacing an existing photo on ${replacing}.`
                  : ".")
              : ""}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={onClose} disabled={running}>
            {result ? "Close" : "Cancel"}
          </Button>
          {!result ? (
            <Button
              onClick={() => void runSync()}
              disabled={running || !preview || actionable === 0}
            >
              {running ? (
                <Loader2
                  className="size-3.5 mr-1.5 animate-spin"
                  aria-hidden="true"
                />
              ) : (
                <ImageUp className="size-3.5 mr-1.5" aria-hidden="true" />
              )}
              Set {actionable > 0 ? actionable : ""} photo
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
  /** True once the live run has finished, so the photo column reads
   *  as what the account had BEFORE the push. */
  afterRun: boolean;
  rows: PhotoBackfillRow[];
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
          <col className="w-[26%]" />
          <col className="w-[36%]" />
          <col className="w-[16%]" />
          <col className="w-[22%]" />
        </colgroup>
        <thead>
          <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
            <th className="px-3 py-2 font-medium">Student</th>
            <th className="px-3 py-2 font-medium">Email</th>
            <th className="px-3 py-2 font-medium">
              {afterRun ? "Google photo before" : "Google photo now"}
            </th>
            <th className="px-3 py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((row) => (
            <SyncRowView key={row.student_id} row={row} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SyncRowView({ row }: { row: PhotoBackfillRow }) {
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
      {/* What the account had before this run — "Has one" on a
          "Will set photo" row means the run replaces it. */}
      <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
        {row.google_had_photo === null
          ? "—"
          : row.google_had_photo
            ? "Has one"
            : "None"}
      </td>
      <td className="px-3 py-2 overflow-hidden whitespace-nowrap">
        {/* Why a row was skipped or failed lives on the badge tooltip —
            the table itself stays terse. */}
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

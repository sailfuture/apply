"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, RefreshCw } from "lucide-react";
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
import { formatNoteTimestamp } from "@/lib/format-note-time";
import { formatToddleFieldList } from "@/lib/toddle-fields";
import type {
  BulkToddleSyncResponse,
  BulkToddleSyncRow,
} from "@/app/api/admin/students/toddle-sync-all/route";

/**
 * "Sync All to Toddle" button + modal for the Enrolled Students page.
 * Runs the full per-student Toddle sync (profile fields, photo,
 * family members + contacts, crew class) for every enrolled student
 * via `/api/admin/students/toddle-sync-all`, then shows the
 * per-student results. Idempotent — students already in Toddle are
 * matched and updated, never duplicated — so re-running is safe.
 *
 * `lastSyncedAt` / `neverSyncedCount` (derived by the host from the
 * roster's `toddle_synced_at` stamps) render under the trigger as the
 * roster-wide answer to "when did we last push to Toddle?", so that
 * question doesn't require running a sync to find out.
 */
export function ToddleSyncAllDialog({
  lastSyncedAt,
  neverSyncedCount,
}: {
  /** Most recent successful sync across the shown enrolled students,
   *  or null when none of them has ever been pushed. */
  lastSyncedAt?: number | null;
  /** How many of those students have never been pushed. */
  neverSyncedCount?: number;
} = {}) {
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BulkToddleSyncResponse | null>(null);

  async function run() {
    setRunning(true);
    try {
      const res = await fetch("/api/admin/students/toddle-sync-all", {
        method: "POST",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error ?? `Sync failed (${res.status})`);
      }
      const live = data as BulkToddleSyncResponse;
      setResult(live);
      const ok = live.totals.created + live.totals.updated;
      if (ok > 0) {
        toast.success(
          `Synced ${ok} student${ok === 1 ? "" : "s"} to Toddle` +
            (live.totals.created > 0 ? ` (${live.totals.created} created)` : "") +
            "."
        );
      }
      if (live.totals.failed > 0) {
        toast.error(
          `${live.totals.failed} student${live.totals.failed === 1 ? "" : "s"} failed — see the list.`
        );
      }
    } catch (err) {
      console.error("[ToddleSyncAllDialog.run]", err);
      toast.error(
        err instanceof Error ? err.message : "Couldn't run the Toddle sync."
      );
    } finally {
      setRunning(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (running) return;
        setOpen(next);
        if (!next) setResult(null);
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="bg-white shrink-0"
          title={
            lastSyncedAt
              ? `Most recent Toddle sync: ${new Date(lastSyncedAt).toLocaleString(
                  "en-US",
                  { dateStyle: "medium", timeStyle: "short" }
                )}${
                  neverSyncedCount
                    ? ` · ${neverSyncedCount} shown student${
                        neverSyncedCount === 1 ? "" : "s"
                      } never synced`
                    : ""
                }`
              : "No shown enrolled student has ever been pushed to Toddle"
          }
        >
          <RefreshCw className="size-3.5 mr-1.5" aria-hidden="true" />
          Sync All to Toddle
          {lastSyncedAt ? (
            <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">
              · {formatNoteTimestamp(lastSyncedAt)}
            </span>
          ) : null}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-4xl max-h-[88vh] flex flex-col gap-0 overflow-hidden">
        <DialogHeader>
          <DialogTitle>Sync All to Toddle</DialogTitle>
          <DialogDescription>
            Runs the full Toddle sync for every enrolled student — profile
            fields, school email, enrollment date, home address, photo,
            family members with their contact info, and crew class
            placement. Existing Toddle students are matched and updated,
            never duplicated, so this is safe to re-run.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto overscroll-contain py-4 pr-1 space-y-4">
          {running ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Syncing every enrolled student — this can take a couple of
              minutes…
            </div>
          ) : result ? (
            <>
              {/* Every outcome gets a chip, including the zeroes: "0
                  new profiles" and "0 failed" are answers, and hiding
                  them makes a clean run look like a partial report. */}
              <div className="flex flex-wrap gap-1.5">
                <TotalChip
                  className="bg-blue-50 text-blue-700 border-blue-200"
                  label={`${result.totals.created} · New in Toddle`}
                />
                <TotalChip
                  className="bg-emerald-50 text-emerald-700 border-emerald-200"
                  label={`${result.totals.updated} · Changed`}
                />
                <TotalChip
                  className="bg-muted text-muted-foreground border-border"
                  label={`${result.totals.unchanged} · Already current`}
                />
                <TotalChip
                  className={cn(
                    result.totals.failed > 0
                      ? "bg-red-50 text-red-700 border-red-200"
                      : "bg-muted text-muted-foreground border-border"
                  )}
                  label={`${result.totals.failed} · Not synced`}
                />
              </div>

              {/* Students Toddle neither matched nor accepted, pulled
                  out of the table so they can't be missed in a
                  75-row scroll. Each carries the reason Toddle gave. */}
              {result.totals.failed > 0 ? (
                <div className="rounded-md border border-red-200 bg-red-50/60 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-red-700">
                    Not added or found in Toddle
                  </p>
                  <ul className="mt-2 space-y-1.5">
                    {result.rows
                      .filter((r) => r.action === "failed")
                      .map((r) => (
                        <li key={r.student_id} className="text-sm">
                          <span className="font-medium">{r.student_name}</span>
                          <span className="text-red-700">
                            {" — "}
                            {r.error ?? "Sync failed."}
                          </span>
                        </li>
                      ))}
                  </ul>
                </div>
              ) : null}

              {/* Loose matches: the Toddle record didn't carry our
                  sourceId, so it was identified by name alone. Worth
                  eyeballing once — a wrong match writes one student's
                  details onto another's profile. */}
              {result.rows.some((r) => r.matched_by === "name") ? (
                <div className="rounded-md border border-amber-200 bg-amber-50/60 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-amber-700">
                    Matched by name only
                  </p>
                  <p className="mt-1 text-xs text-amber-800">
                    These Toddle records weren&rsquo;t carrying our student
                    ID, so they were matched on name. The sync stamps the
                    ID as it goes, so this should be a one-time notice per
                    student.
                  </p>
                  <p className="mt-1.5 text-sm">
                    {result.rows
                      .filter((r) => r.matched_by === "name")
                      .map((r) => r.student_name)
                      .join(", ")}
                  </p>
                </div>
              ) : null}
              <div className="rounded-md border overflow-hidden">
                <table className="w-full table-fixed text-sm">
                  <colgroup>
                    <col className="w-[26%]" />
                    <col className="w-[14%]" />
                    <col className="w-[12%]" />
                    <col className="w-[14%]" />
                    <col className="w-[34%]" />
                  </colgroup>
                  <thead>
                    <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                      <th className="px-3 py-2 font-medium">Student</th>
                      <th className="px-3 py-2 font-medium">Result</th>
                      <th className="px-3 py-2 font-medium">Photo</th>
                      <th className="px-3 py-2 font-medium">Family</th>
                      <th className="px-3 py-2 font-medium">
                        What changed / notes
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {result.rows.map((row) => (
                      <ResultRow key={row.student_id} row={row} />
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Every enrolled student will be pushed to Toddle. Students
              missing pieces (no grade for a first-time create, no photo,
              parent without an email) are reported per row — one
              student&rsquo;s problem never stops the rest.
            </p>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-t pt-4">
          <p className="text-xs text-muted-foreground">
            {result
              ? `Done — ${result.totals.created + result.totals.updated} of ${
                  result.rows.length
                } student${result.rows.length === 1 ? "" : "s"} moved; each student's Toddle link is saved on their record.`
              : ""}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setOpen(false);
                setResult(null);
              }}
              disabled={running}
            >
              {result ? "Close" : "Cancel"}
            </Button>
            {!result ? (
              <Button onClick={() => void run()} disabled={running}>
                {running ? (
                  <Loader2
                    className="size-3.5 mr-1.5 animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <RefreshCw className="size-3.5 mr-1.5" aria-hidden="true" />
                )}
                Sync all students
              </Button>
            ) : null}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TotalChip({ className, label }: { className: string; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
        className
      )}
    >
      {label}
    </span>
  );
}

function ResultRow({ row }: { row: BulkToddleSyncRow }) {
  const resultMeta =
    row.action === "failed"
      ? {
          label: "Not synced",
          className: "bg-red-50 text-red-700 border-red-200",
        }
      : row.action === "created"
        ? {
            label: "Created",
            className: "bg-blue-50 text-blue-700 border-blue-200",
          }
        : row.action === "unchanged"
          ? {
              label: "No change",
              className: "bg-muted text-muted-foreground border-border",
            }
          : {
              label: "Changed",
              className: "bg-emerald-50 text-emerald-700 border-emerald-200",
            };
  const family =
    row.family_synced + row.family_failed === 0
      ? "—"
      : row.family_failed > 0
        ? `${row.family_synced} ok · ${row.family_failed} failed`
        : `${row.family_synced} synced`;
  // What actually moved, most specific first: the failure reason, the
  // named field changes, then the crew placement. A "Changed" row with
  // no field list means the prior record couldn't be read to compare,
  // which is a different thing from nothing having changed.
  const changed =
    row.changed_fields.length > 0
      ? formatToddleFieldList(row.changed_fields)
      : "";
  const notes =
    row.error ?? [changed, row.crew].filter(Boolean).join(" · ");
  return (
    <tr className="align-top">
      <td
        className="px-3 py-2 font-medium overflow-hidden text-ellipsis whitespace-nowrap"
        title={row.student_name}
      >
        {row.student_name}
      </td>
      <td className="px-3 py-2 whitespace-nowrap">
        <span
          className={cn(
            "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
            resultMeta.className
          )}
        >
          {resultMeta.label}
        </span>
      </td>
      <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
        {row.photo === "synced" ? "Pushed" : row.photo === "failed" ? "Failed" : "—"}
      </td>
      <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
        {family}
      </td>
      <td
        className={cn(
          "px-3 py-2 overflow-hidden text-ellipsis whitespace-nowrap",
          row.error ? "text-red-700" : "text-muted-foreground"
        )}
        title={notes || undefined}
      >
        {notes || "—"}
      </td>
    </tr>
  );
}

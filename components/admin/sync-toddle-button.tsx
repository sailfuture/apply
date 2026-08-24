"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { formatNoteTimestamp } from "@/lib/format-note-time";
import { formatToddleFieldList } from "@/lib/toddle-fields";
import type { ToddleReadiness } from "@/lib/toddle-readiness";
import type { ToddleSyncPreview } from "@/lib/toddle-sync";

/**
 * Admin "Sync to Toddle" — POSTs to
 * `/api/admin/students/[id]/toddle-sync`, which updates the student's
 * existing Toddle record or creates one when none matches. Rendered on
 * the enrolled student detail page's action row and the enrolled
 * roster's quick-detail sheet.
 *
 * A confirm dialog fronts the action because it writes to an external
 * system (creating a Toddle account is visible to teachers the moment
 * it lands). `gradeLevel` is the packet's placement grade — required
 * by Toddle only when the sync has to create; the server explains via
 * the error toast when it's missing.
 *
 * `lastSyncedAt` (unix-ms, stamped on the student row by every
 * successful sync) renders under the button as "Last synced …" — the
 * only place that state was ever visible was Toddle itself, so a
 * student who silently stopped syncing looked identical to one pushed
 * this morning. Optional: callers without the field just get the
 * button, and the line updates optimistically after a sync here rather
 * than waiting for the parent's refetch.
 */
export function SyncToddleButton({
  studentId,
  studentName,
  gradeLevel,
  lastSyncedAt,
  className,
  onSynced,
}: {
  studentId: number;
  studentName: string;
  gradeLevel?: string | null;
  /** Unix-ms of this student's last successful Toddle sync, or null /
   *  undefined when they have never been pushed. */
  lastSyncedAt?: number | null;
  className?: string;
  onSynced?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  // Local echo of the prop so the line updates the moment a sync
  // lands, without waiting for the host's SWR revalidation.
  const [syncedAt, setSyncedAt] = useState<number | null>(
    lastSyncedAt ?? null
  );
  // Field-by-field readiness, fetched when the confirm dialog opens.
  // Xano-only on the server, so it costs no Toddle quota — which lets
  // admin see WHY a student would fail before pushing, instead of
  // reading it off an error toast afterwards.
  const [readiness, setReadiness] = useState<
    (ToddleReadiness & { preview?: ToddleSyncPreview }) | null
  >(null);
  // Whether that check has landed yet. Sync stays disabled until it
  // settles, because a dialog whose whole job is "review this first"
  // shouldn't be confirmable before the thing to review has arrived —
  // the check takes a couple of seconds, and until it did, this read
  // as a bare "are you sure?" box. "error" re-enables Sync rather
  // than trapping the admin behind a panel that will never load.
  const [checkState, setCheckState] = useState<"loading" | "ready" | "error">(
    "loading"
  );

  useEffect(() => {
    if (!open || readiness) return;
    let cancelled = false;
    setCheckState("loading");
    fetch(`/api/admin/students/${studentId}/toddle-sync`)
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        setReadiness(data as ToddleReadiness);
        setCheckState("ready");
      })
      .catch((err) => {
        // Non-fatal: the dialog still syncs, it just can't show the
        // checklist.
        console.error("[SyncToddleButton] readiness check failed:", err);
        if (!cancelled) setCheckState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [open, readiness, studentId]);

  async function runSync() {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/students/${studentId}/toddle-sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gradeLevel: gradeLevel ?? "" }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error ?? `Sync failed (${res.status})`);
      }
      // Three distinct outcomes, said plainly: a new Toddle record, a
      // real change (naming what moved), or a push that found nothing
      // different. "Updated" with no field list means we couldn't read
      // the prior record to compare, not that nothing changed.
      const changed: string[] = Array.isArray(data?.changedFields)
        ? data.changedFields
        : [];
      const base =
        data?.action === "created"
          ? `${studentName} created in Toddle.`
          : data?.action === "unchanged"
            ? `${studentName}'s Toddle profile was already up to date.`
            : changed.length > 0
              ? `${studentName}'s Toddle profile updated — ${formatToddleFieldList(changed)}.`
              : `${studentName}'s Toddle profile updated.`;
      // Best-effort extras, each reported without failing the sync:
      // `photo` ("synced"/"none"/"failed"), `familyMembers` (per-
      // contact account+contact outcomes), `crew` (class membership).
      const parts: string[] = [base];
      if (data?.photo === "synced") parts.push("Photo pushed.");
      else if (data?.photo === "failed")
        parts.push("Photo upload failed — check server logs.");
      const members: Array<{
        name: string;
        account: string;
        contact: string;
      }> = Array.isArray(data?.familyMembers) ? data.familyMembers : [];
      if (members.length > 0) {
        const failed = members.filter(
          (m) => m.account === "failed" || m.contact === "failed"
        );
        const okCount = members.length - failed.length;
        if (okCount > 0)
          parts.push(
            `${okCount} family member${okCount === 1 ? "" : "s"} synced.`
          );
        if (failed.length > 0)
          parts.push(
            `${failed.map((m) => m.name).join(", ")} failed — see server logs.`
          );
      }
      if (typeof data?.crew === "string" && data.crew)
        parts.push(`Crew: ${data.crew}.`);
      toast.success(parts.join(" "));
      setSyncedAt(Date.now());
      setOpen(false);
      onSynced?.();
    } catch (err) {
      console.error("[SyncToddleButton.runSync] failed:", err);
      toast.error(
        err instanceof Error ? err.message : "Couldn't sync to Toddle."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {/* inline-flex so the stack keeps its intrinsic width and
          doesn't stretch inside the detail page's button row; callers
          that want a full-width block (the roster sheet) pass w-full. */}
      <div className={cn("inline-flex flex-col items-start gap-1", className)}>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={saving}
          onClick={() => setOpen(true)}
          className="bg-white w-full"
        >
          <RefreshCw className="size-3.5 mr-1.5" />
          Sync to Toddle
        </Button>
        {/* Sync freshness. `lastSyncedAt === undefined` means the
            caller doesn't carry the field, which is not the same as
            "never synced" — say nothing rather than claim never. */}
        {lastSyncedAt !== undefined ? (
          <span
            className="text-[11px] text-muted-foreground"
            title={
              syncedAt
                ? new Date(syncedAt).toLocaleString("en-US", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })
                : "This student has never been pushed to Toddle."
            }
          >
            {syncedAt
              ? `Last synced ${formatNoteTimestamp(syncedAt)}`
              : "Never synced"}
          </span>
        ) : null}
      </div>
      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          if (!saving) setOpen(next);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sync {studentName} to Toddle?</AlertDialogTitle>
            <AlertDialogDescription>
              This looks the student up in Toddle (by our student ID,
              falling back to name) and updates their existing profile
              — or creates a new Toddle student
              {gradeLevel?.trim()
                ? ` in the ${gradeLevel.trim()} grade year group`
                : ""}{" "}
              if none exists. Name, date of birth, gender, phone,
              school email, enrollment date, home address, and the
              student photo are pushed from the record here; the
              family&rsquo;s primary and secondary contacts are added
              as Toddle family members with their contact info, and
              the student is placed in their crew&rsquo;s Toddle
              class.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {checkState === "loading" ? (
            <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              Checking what this would change in Toddle — nothing has
              been pushed yet.
            </div>
          ) : checkState === "error" ? (
            <div className="rounded-md border px-3 py-2 text-sm text-muted-foreground">
              Couldn&rsquo;t run the pre-sync check, so what changes is
              unknown until the sync runs. You can still sync.
            </div>
          ) : null}
          {readiness?.preview ? (
            <div
              className={cn(
                "rounded-md border px-3 py-2 text-sm",
                readiness.preview.status === "conflict"
                  ? "border-red-200 bg-red-50 text-red-700"
                  : readiness.preview.status === "current"
                    ? "bg-muted/40 text-muted-foreground"
                    : "bg-emerald-50 text-emerald-800 border-emerald-200"
              )}
            >
              {readiness.preview.status === "create" ? (
                <>This will create a new Toddle profile for them.</>
              ) : readiness.preview.status === "change" ? (
                <>
                  This will change{" "}
                  <span className="font-medium">
                    {formatToddleFieldList(readiness.preview.changedFields)}
                  </span>{" "}
                  on their Toddle profile.
                </>
              ) : readiness.preview.status === "current" ? (
                <>Their Toddle profile already matches — nothing will change.</>
              ) : readiness.preview.status === "conflict" ? (
                <>{readiness.preview.note}</>
              ) : (
                <>
                  Couldn&rsquo;t reach Toddle to compare, so what changes
                  is unknown until the sync runs.
                </>
              )}
            </div>
          ) : null}
          {readiness ? (
            <div className="max-h-64 overflow-y-auto rounded-md border">
              {!readiness.ready ? (
                <p className="border-b bg-red-50 px-3 py-2 text-sm text-red-700">
                  This student can&rsquo;t sync yet — fix the blocking
                  fields below first.
                </p>
              ) : null}
              <ul className="divide-y">
                {readiness.fields.map((field) => (
                  <li
                    key={field.key}
                    className="flex items-baseline gap-2 px-3 py-1.5 text-sm"
                  >
                    <span
                      className={cn(
                        "shrink-0 text-xs font-medium tabular-nums",
                        field.status === "ok"
                          ? "text-emerald-600"
                          : field.severity === "blocking"
                            ? "text-red-600"
                            : "text-muted-foreground"
                      )}
                      aria-hidden="true"
                    >
                      {field.status === "ok"
                        ? "OK"
                        : field.severity === "blocking"
                          ? "REQ"
                          : "—"}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          "font-medium",
                          field.status !== "ok" &&
                            field.severity === "blocking" &&
                            "text-red-700"
                        )}
                      >
                        {field.label}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {field.detail}
                        {field.status !== "ok" ? ` · ${field.fixedOn}` : ""}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={saving || checkState === "loading"}
              title={
                checkState === "loading"
                  ? "Still checking what this sync would change."
                  : undefined
              }
              onClick={(e) => {
                e.preventDefault();
                void runSync();
              }}
            >
              {saving ? (
                <Loader2 className="size-3.5 mr-1.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5 mr-1.5" />
              )}
              Sync
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

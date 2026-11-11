"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Check, Eye, Loader2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Input } from "@/components/ui/input";
import { adminFetcher } from "@/lib/admin-fetcher";
import { cn } from "@/lib/utils";
import type {
  VolunteerRecapListResponse,
  VolunteerRecapPreviewResponse,
  VolunteerRecapSendResponse,
} from "@/app/api/admin/volunteer-hours/recap/route";

function formatHours(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2).replace(/\.?0+$/, "");
}

const families = (n: number) => `${n} famil${n === 1 ? "y" : "ies"}`;

/**
 * Email the volunteer-hours recap: each family's completed and
 * remaining hours, the events they were credited for, and what's
 * coming up. Two modes off one dialog:
 *
 *   - no `familyId` → every enrolled family, pre-selected; audit the
 *     list, preview any family's email, then send. Families emailed
 *     in the last day are skipped server-side, so a retry is safe.
 *   - `familyId`    → just that family (the button on a family's
 *     sheet). Always sends, so it doubles as "resend".
 */
export function VolunteerRecapDialog({
  yearId,
  familyId,
  onDone,
}: {
  yearId: number;
  /** Set = single-family mode. */
  familyId?: number;
  onDone: () => void;
}) {
  const single = typeof familyId === "number";
  const { data, error, isLoading } = useSWR<VolunteerRecapListResponse>(
    `/api/admin/volunteer-hours/recap?yearId=${yearId}`,
    adminFetcher,
    { revalidateOnFocus: false }
  );
  const rows = useMemo(() => {
    const all = data?.families ?? [];
    return single
      ? all.filter((f) => f.familyIds.includes(familyId as number))
      : all;
  }, [data, single, familyId]);
  const sendableIds = useMemo(
    () => new Set(rows.filter((f) => f.emails.length > 0).map((f) => f.id)),
    [rows]
  );

  // null = "everyone with an email" until the list is hand-edited.
  const [picked, setPicked] = useState<Set<number> | null>(null);
  const selected = picked ?? sendableIds;
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? rows.filter(
          (f) =>
            f.name.toLowerCase().includes(q) ||
            f.students.toLowerCase().includes(q)
        )
      : rows;
  }, [rows, query]);

  function toggle(id: number) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  }

  // Which family's email the preview shows: the one picked with the
  // eye button, else the first on the list.
  const [previewPick, setPreviewPick] = useState<number | null>(null);
  const previewId = previewPick ?? rows[0]?.id ?? null;
  const previewFamily = rows.find((f) => f.id === previewId) ?? null;
  const {
    data: preview,
    error: previewError,
    isLoading: previewLoading,
  } = useSWR<VolunteerRecapPreviewResponse>(
    previewFamily
      ? `/api/admin/volunteer-hours/recap?yearId=${yearId}&familyId=${previewFamily.id}`
      : null,
    adminFetcher,
    { revalidateOnFocus: false, keepPreviousData: true }
  );

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const canSend = selected.size > 0;

  async function send() {
    if (!canSend || sending) return;
    setSending(true);
    try {
      const res = await fetch("/api/admin/volunteer-hours/recap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          yearId,
          familyIds: [...selected],
          resend: single,
        }),
      });
      const result = (await res.json().catch(() => null)) as
        | (VolunteerRecapSendResponse & { error?: string })
        | null;
      if (!res.ok || !result) {
        throw new Error(result?.error ?? `Send failed (${res.status})`);
      }
      const notes = [
        result.alreadySent
          ? `${result.alreadySent} already emailed today`
          : "",
        result.noEmail ? `${result.noEmail} with no email on file` : "",
        result.failed ? `${result.failed} failed` : "",
      ].filter(Boolean);
      const summary = `Recap emailed to ${families(result.sent)}${
        notes.length ? ` (${notes.join(", ")})` : ""
      }.`;
      if (result.failed > 0) {
        toast.error(summary, {
          description: `Failed: ${result.failedFamilies.join(", ")}. Send again to retry just these.`,
          duration: 15000,
        });
      } else {
        toast.success(summary);
      }
      onDone();
    } catch (err) {
      console.error("Failed to send volunteer recap:", err);
      toast.error(
        err instanceof Error ? err.message : "Couldn't send the recap."
      );
      setConfirmOpen(false);
    } finally {
      setSending(false);
    }
  }

  const onlyFamily = single ? (rows[0] ?? null) : null;

  return (
    <>
      <Dialog open onOpenChange={(o) => !sending && !o && onDone()}>
        <DialogContent className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
          <DialogHeader className="border-b px-5 py-4 pr-12">
            <DialogTitle>
              {single
                ? `Email hours recap${onlyFamily ? ` · ${onlyFamily.name}` : ""}`
                : "Email volunteer hours recap"}
            </DialogTitle>
            <DialogDescription>
              {single
                ? "Emails this family their completed and remaining hours, the events they were credited for, and upcoming opportunities."
                : "Emails each selected family their own completed and remaining hours, the events they were credited for, and upcoming opportunities. One email per household: family records that share a parent email are combined."}
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 py-4">
            {error ? (
              <p className="text-sm text-red-600">
                Couldn&rsquo;t load the recap:{" "}
                {error instanceof Error ? error.message : "unknown error"}
              </p>
            ) : isLoading && !data ? (
              <div className="flex justify-center py-10">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : rows.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">
                {single
                  ? "This family isn't enrolled for this school year, so there is no recap to send."
                  : "No enrolled families for this school year."}
              </p>
            ) : (
              <>
                {single ? (
                  <p className="text-sm">
                    <span className="text-muted-foreground">To: </span>
                    {onlyFamily && onlyFamily.emails.length > 0
                      ? onlyFamily.emails.join(", ")
                      : "No parent email on file"}
                  </p>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Recipients ({selected.size} of {rows.length})
                      </h3>
                      <div className="flex items-center gap-3 text-xs">
                        <button
                          type="button"
                          className="font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                          onClick={() => setPicked(new Set(sendableIds))}
                        >
                          Select all
                        </button>
                        {selected.size > 0 ? (
                          <button
                            type="button"
                            className="font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                            onClick={() => setPicked(new Set())}
                          >
                            Clear
                          </button>
                        ) : null}
                      </div>
                    </div>
                    <Input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search family or student…"
                      type="search"
                      autoComplete="off"
                    />
                    {shown.length === 0 ? (
                      <p className="py-2 text-sm text-muted-foreground">
                        No matching families.
                      </p>
                    ) : (
                      <ul className="max-h-48 space-y-0.5 overflow-y-auto overscroll-contain rounded-md border p-1">
                        {shown.map((f) => {
                          const on = selected.has(f.id);
                          const sendable = f.emails.length > 0;
                          return (
                            <li
                              key={f.id}
                              className={cn(
                                "flex items-center gap-1 rounded",
                                previewId === f.id && "ring-1 ring-border"
                              )}
                            >
                              <button
                                type="button"
                                disabled={!sendable}
                                onClick={() => toggle(f.id)}
                                aria-pressed={on}
                                className={cn(
                                  "flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors",
                                  !sendable
                                    ? "cursor-not-allowed opacity-50"
                                    : on
                                      ? "bg-muted"
                                      : "hover:bg-muted/50"
                                )}
                              >
                                <span
                                  className={cn(
                                    "flex size-4 shrink-0 items-center justify-center rounded border",
                                    on
                                      ? "border-foreground bg-foreground text-background"
                                      : "border-border bg-white"
                                  )}
                                >
                                  {on ? <Check className="size-3" /> : null}
                                </span>
                                <span className="min-w-0 flex-1 truncate">
                                  {f.name}
                                  {f.students ? (
                                    <span className="text-xs text-muted-foreground">
                                      {" "}
                                      · {f.students}
                                    </span>
                                  ) : null}
                                </span>
                                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                                  {sendable
                                    ? `${formatHours(f.completed)} hrs`
                                    : "No email"}
                                </span>
                              </button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="size-7 shrink-0 p-0"
                                onClick={() => setPreviewPick(f.id)}
                                aria-label={`Preview ${f.name}'s email`}
                                title="Preview this family's email"
                              >
                                <Eye className="size-3.5" />
                              </Button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                )}

                <div className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Preview{previewFamily && !single ? ` · ${previewFamily.name}` : ""}
                  </h3>
                  {previewError ? (
                    <p className="text-sm text-red-600">
                      Couldn&rsquo;t load the preview.
                    </p>
                  ) : !preview ? (
                    <div className="flex h-80 items-center justify-center rounded-md border">
                      <Loader2 className="size-4 animate-spin text-muted-foreground" />
                    </div>
                  ) : (
                    <div
                      className={cn(
                        "overflow-hidden rounded-md border transition-opacity",
                        previewLoading && "opacity-50"
                      )}
                    >
                      <p className="truncate border-b bg-muted/30 px-3 py-1.5 text-xs">
                        <span className="text-muted-foreground">Subject: </span>
                        {preview.subject}
                      </p>
                      <iframe
                        title="Recap email preview"
                        sandbox=""
                        srcDoc={preview.html}
                        className="h-80 w-full bg-white"
                      />
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          <DialogFooter className="border-t px-5 py-3">
            <Button
              variant="outline"
              size="sm"
              className="bg-white"
              disabled={sending}
              onClick={() => onDone()}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={sending || !canSend}
              onClick={() => setConfirmOpen(true)}
            >
              <Mail className="size-3.5 mr-1.5" />
              {single
                ? "Send recap"
                : `Send to ${families(selected.size)}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(o) => !sending && setConfirmOpen(o)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Email the recap to{" "}
              {single && onlyFamily
                ? onlyFamily.name
                : families(selected.size)}
              ?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {single
                ? "Goes to every parent email on the family now. Emails can't be unsent."
                : "Each family gets their own hours, sent to every parent email on file. Families already emailed today are skipped. Emails can't be unsent."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sending}>Go back</AlertDialogCancel>
            <AlertDialogAction
              disabled={sending}
              onClick={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              {sending ? (
                <>
                  <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                  Sending
                </>
              ) : (
                "Send"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

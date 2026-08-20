"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Check, Loader2, Send } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { adminFetcher } from "@/lib/admin-fetcher";
import { cn } from "@/lib/utils";
import type {
  GroupAudienceResponse,
  GroupContact,
} from "@/app/api/admin/messages/group/audience/route";

/**
 * Quick group text to a FIXED set of families — the "message this bus
 * stop" / "message all riders" affordance (also reusable anywhere a
 * page already knows exactly who it wants to text). A lean cousin of
 * the event-reminder dialog: the audience arrives as family ids, the
 * group-audience directory supplies names + sendability (opt-outs and
 * missing numbers can't be selected; the send route re-checks
 * server-side), and the send goes through the group blast route so
 * it's personalized, idempotent per dialog session, and lands on each
 * family's thread.
 *
 * Callers key this component per context (e.g. by stop name) so a
 * fresh open starts with fresh selection + draft.
 */
export function QuickTextDialog({
  yearId,
  title,
  description,
  families,
  onClose,
}: {
  yearId: number;
  title: string;
  description: string;
  /** The fixed audience — id plus the caller's display name, used as
   *  the fallback when the messaging directory doesn't know the
   *  family (e.g. a mid-application bus elector who hasn't
   *  submitted yet). */
  families: Array<{ id: number; name: string }>;
  onClose: () => void;
}) {
  const { data, isLoading } = useSWR<GroupAudienceResponse>(
    yearId ? `/api/admin/messages/group/audience?yearId=${yearId}` : null,
    adminFetcher
  );
  // The caller's families, hydrated from the directory. A family the
  // directory doesn't list (no submitted application for the year)
  // still renders — with its real name from the caller and an honest
  // "Not in audience" badge, NOT "No number": their phone may be
  // perfectly valid, the messaging audience just doesn't include
  // them yet.
  const rows = useMemo(() => {
    const byId = new Map<number, GroupContact>();
    for (const c of data?.contacts ?? []) {
      if (c.type === "family") byId.set(c.id, c);
    }
    return families.map((f) => {
      const c = byId.get(f.id);
      return {
        id: f.id,
        name: c?.name ?? f.name ?? `Family #${f.id}`,
        personName: c?.personName ?? "",
        phone: c?.phone ?? "",
        sendable: c?.sendable === true,
        optedOut: c?.optedOut === true,
        inAudience: Boolean(c),
      };
    });
  }, [data, families]);
  const defaultSelected = useMemo(
    () => new Set(rows.filter((r) => r.sendable).map((r) => r.id)),
    [rows]
  );
  // null = "everything sendable" until the admin touches the list.
  const [picked, setPicked] = useState<Set<number> | null>(null);
  const selected = picked ?? defaultSelected;

  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  // One blast id per dialog mount — retries resume instead of
  // double-texting (the group route's idempotency key).
  const [blastId] = useState(() =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `quick-${String(Math.random()).slice(2, 12)}`
  );

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? rows.filter(
          (r) =>
            r.name.toLowerCase().includes(q) ||
            r.personName.toLowerCase().includes(q)
        )
      : rows;
  }, [rows, query]);

  function toggle(id: number) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  }

  const text = message.trim();
  const segments = text.length === 0 ? 0 : Math.ceil(text.length / 160);
  const canSend = selected.size > 0 && text.length > 0;

  async function send() {
    if (!canSend || sending) return;
    setSending(true);
    try {
      const res = await fetch("/api/admin/messages/group", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          yearId,
          contacts: [...selected].map((id) => ({ type: "family", id })),
          body: text,
          blastId,
        }),
      });
      const result = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(result?.error ?? `Send failed (${res.status})`);
      }
      const sent = Number(result?.sent) || 0;
      const failed = Number(result?.failed) || 0;
      if (failed > 0) {
        // KEEP the dialog open on a partial failure: the blastId
        // lives for this mount, and the group route's resume check
        // skips already-texted families under the SAME blast id — so
        // pressing Send again here retries only the failures.
        // Closing would mint a fresh id on reopen and double-text
        // every success.
        toast.warning(
          `Sent to ${sent} famil${sent === 1 ? "y" : "ies"} — ${failed} failed. Press Send again to retry just the failures.`
        );
        setConfirmOpen(false);
      } else {
        toast.success(
          `Text sent to ${sent} famil${sent === 1 ? "y" : "ies"}.`
        );
        onClose();
      }
    } catch (err) {
      console.error("Quick text failed:", err);
      toast.error(
        err instanceof Error ? err.message : "Couldn't send the text."
      );
      setConfirmOpen(false);
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <Dialog open onOpenChange={(o) => !sending && !o && onClose()}>
        <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
          <DialogHeader className="border-b px-5 py-4 pr-12">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 py-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Message</Label>
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={4}
                placeholder="Type the text every selected family will receive…"
              />
              <p className="text-[11px] text-muted-foreground">
                {"{{first_name}}"} becomes each parent&rsquo;s first name
                · {text.length} chars
                {segments > 0
                  ? ` · ${segments} segment${segments === 1 ? "" : "s"}`
                  : ""}
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Recipients ({selected.size} of {rows.length})
                </h3>
                <div className="flex items-center gap-3 text-xs">
                  <button
                    type="button"
                    className="font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                    onClick={() => setPicked(new Set(defaultSelected))}
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
              {rows.length > 8 ? (
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search families…"
                  type="search"
                  autoComplete="off"
                />
              ) : null}
              {isLoading && !data ? (
                <div className="flex justify-center py-6">
                  <Loader2 className="size-4 animate-spin text-muted-foreground" />
                </div>
              ) : shown.length === 0 ? (
                <p className="py-2 text-sm text-muted-foreground">
                  {query ? "No matching families." : "No families to text."}
                </p>
              ) : (
                <ul className="max-h-56 space-y-0.5 overflow-y-auto overscroll-contain rounded-md border p-1">
                  {shown.map((r) => {
                    const on = selected.has(r.id);
                    return (
                      <li key={r.id}>
                        <button
                          type="button"
                          disabled={!r.sendable}
                          onClick={() => toggle(r.id)}
                          aria-pressed={on}
                          className={cn(
                            "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors",
                            !r.sendable
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
                            {r.name}
                            {r.personName ? (
                              <span className="text-xs text-muted-foreground">
                                {" "}
                                · {r.personName}
                              </span>
                            ) : null}
                          </span>
                          {!r.sendable ? (
                            <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                              {r.optedOut
                                ? "Opted out"
                                : !r.inAudience
                                  ? "Not in audience"
                                  : "No number"}
                            </span>
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          <DialogFooter className="border-t px-5 py-3">
            <Button
              variant="outline"
              size="sm"
              className="bg-white"
              disabled={sending}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!canSend || sending}
              onClick={() => setConfirmOpen(true)}
            >
              <Send className="size-3.5 mr-1.5" aria-hidden="true" />
              {selected.size > 0 ? `Send to ${selected.size}` : "Send"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* A group text can't be unsent — restate who + how many before
          anything fires. */}
      <AlertDialog
        open={confirmOpen}
        onOpenChange={(o) => !sending && setConfirmOpen(o)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Send this text to {selected.size}{" "}
              {selected.size === 1 ? "family" : "families"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {title}. This can&rsquo;t be unsent.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sending}>
              Keep editing
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={sending || !canSend}
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
                `Send to ${selected.size}`
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

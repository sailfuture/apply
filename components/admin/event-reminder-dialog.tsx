"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Bell, Check, Loader2 } from "lucide-react";
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
import type { GroupContact } from "@/app/api/admin/messages/group/audience/route";
import type { XanoSchoolCalendarEvent } from "@/lib/xano";

/** A calendar event plus its day's date — what the reminder needs. */
export type ReminderEvent = XanoSchoolCalendarEvent & { date: string };

function fmtDate(iso: string): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtTimeMs(ms: number | null | undefined): string {
  if (!ms || !Number.isFinite(ms)) return "";
  return new Date(ms).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatHours(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2).replace(/\.?0+$/, "");
}

/** Generic reminder template — editable before sending, personalized
 *  per recipient by the group route ({{first_name}}). The volunteer
 *  sentence only appears for volunteer-flagged events with a nonzero
 *  hour credit. */
function defaultReminder(ev: ReminderEvent): string {
  const when = `${fmtDate(ev.date)}${
    ev.start_time ? ` at ${fmtTimeMs(ev.start_time)}` : ""
  }`;
  const where = ev.location ? ` at ${ev.location}` : "";
  const vol =
    ev.parent_volunteer_hours && ev.volunteer_hour_total
      ? ` Attending counts toward your volunteer hours (${formatHours(ev.volunteer_hour_total)} hrs).`
      : "";
  return `Hi {{first_name}} — reminder from SailFuture Academy: ${ev.title} is ${when}${where}.${vol}`;
}

/**
 * Text an event reminder to enrolled families. The recipient list
 * comes from the group-messaging audience (same reachability +
 * opt-out data as the composer), pre-selected to every textable
 * enrolled family — audit the list and deselect before sending. The
 * send goes through the group blast route, so it's personalized,
 * idempotent per dialog session, and lands on each family's thread.
 * Shared by the Volunteer Hours page and the calendar surfaces.
 */
export function EventReminderDialog({
  yearId,
  event,
  onDone,
}: {
  yearId: number;
  event: ReminderEvent;
  onDone: () => void;
}) {
  const { data, isLoading } = useSWR<{ contacts: GroupContact[] }>(
    yearId ? `/api/admin/messages/group/audience?yearId=${yearId}` : null,
    adminFetcher
  );
  const enrolled = useMemo(
    () =>
      (data?.contacts ?? []).filter(
        (c) => c.type === "family" && c.stage === "enrolled"
      ),
    [data]
  );
  const defaultSelected = useMemo(
    () => new Set(enrolled.filter((c) => c.sendable).map((c) => c.id)),
    [enrolled]
  );
  // null = "everything sendable" until the admin touches the list —
  // avoids a state write when the audience finishes loading.
  const [picked, setPicked] = useState<Set<number> | null>(null);
  const selected = picked ?? defaultSelected;

  const [message, setMessage] = useState(() => defaultReminder(event));
  const [query, setQuery] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  // One blast id per dialog open — retries resume instead of
  // double-texting (the group route's idempotency key).
  const [blastId] = useState(() =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `reminder-${event.id}-${String(Math.random()).slice(2, 10)}`
  );

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? enrolled.filter((c) => c.name.toLowerCase().includes(q))
      : enrolled;
  }, [enrolled, query]);

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
      toast.success(
        `Reminder sent to ${sent} famil${sent === 1 ? "y" : "ies"}${failed ? ` (${failed} failed)` : ""}.`
      );
      onDone();
    } catch (err) {
      console.error("Failed to send reminder:", err);
      toast.error(
        err instanceof Error ? err.message : "Couldn't send the reminder."
      );
      setConfirmOpen(false);
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <Dialog open onOpenChange={(o) => !sending && !o && onDone()}>
        <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
          <DialogHeader className="border-b px-5 py-4 pr-12">
            <DialogTitle>Remind families · {event.title}</DialogTitle>
            <DialogDescription>
              Texts every selected enrolled family. Edit the message,
              audit the list, and deselect anyone who shouldn&rsquo;t get
              it.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Message</Label>
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={4}
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
                  Recipients ({selected.size} of {enrolled.length})
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
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search families…"
              />
              {isLoading && !data ? (
                <div className="flex justify-center py-6">
                  <Loader2 className="size-4 animate-spin text-muted-foreground" />
                </div>
              ) : shown.length === 0 ? (
                <p className="py-2 text-sm text-muted-foreground">
                  {query
                    ? "No matching families."
                    : "No enrolled families to text."}
                </p>
              ) : (
                <ul className="max-h-56 space-y-0.5 overflow-y-auto rounded-md border p-1">
                  {shown.map((c) => {
                    const on = selected.has(c.id);
                    return (
                      <li key={c.key}>
                        <button
                          type="button"
                          disabled={!c.sendable}
                          onClick={() => toggle(c.id)}
                          aria-pressed={on}
                          className={cn(
                            "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors",
                            !c.sendable
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
                            {c.name}
                            {c.students ? (
                              <span className="text-xs text-muted-foreground">
                                {" "}
                                · {c.students}
                              </span>
                            ) : null}
                          </span>
                          {!c.sendable ? (
                            <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                              {c.optedOut ? "Opted out" : "No number"}
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
              onClick={() => onDone()}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={sending || !canSend}
              onClick={() => setConfirmOpen(true)}
            >
              <Bell className="size-3.5 mr-1.5" />
              Send reminder
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Send confirm */}
      <AlertDialog
        open={confirmOpen}
        onOpenChange={(o) => !sending && setConfirmOpen(o)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Text {selected.size} famil
              {selected.size === 1 ? "y" : "ies"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Sends the reminder about &ldquo;{event.title}&rdquo; as a
              group text. Messages can&rsquo;t be unsent.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sending}>
              Go back
            </AlertDialogCancel>
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

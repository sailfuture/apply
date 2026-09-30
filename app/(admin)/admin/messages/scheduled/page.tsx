"use client";

import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Clock, Loader2, Send, X } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { adminFetcher } from "@/lib/admin-fetcher";
import { formatNoteTimestamp } from "@/lib/format-note-time";
import { cn } from "@/lib/utils";
import {
  sendAtLabel,
  sendAtMs,
  toLocalInput,
} from "@/components/admin/send-later-field";
import type { XanoScheduledSend } from "@/lib/xano";
import type { ScheduledSendsResponse } from "@/app/api/admin/messages/scheduled/route";

const KEY = "/api/admin/messages/scheduled";

const STATUS_LABEL: Record<string, string> = {
  scheduled: "Scheduled",
  sending: "Sending now",
  sent: "Sent",
  canceled: "Canceled",
  failed: "Failed",
};

const STATUS_CLASS: Record<string, string> = {
  scheduled: "text-blue-700",
  sending: "text-blue-700",
  sent: "text-emerald-700",
  canceled: "text-muted-foreground",
  failed: "text-destructive",
};

function isPending(s: XanoScheduledSend): boolean {
  return s.status === "scheduled" || s.status === "sending";
}

/**
 * Parents → Scheduled texts: every text staff set to go out later,
 * from the group composer or an event's reminder. Pending ones can be
 * edited, sent now, or canceled until the moment they go out.
 */
export default function ScheduledTextsPage() {
  const { data, error, isLoading, mutate } = useSWR<ScheduledSendsResponse>(
    KEY,
    adminFetcher,
    { refreshInterval: 60_000 }
  );
  const [openId, setOpenId] = useState<number | null>(null);
  const sends = data?.sends ?? [];
  const pending = sends
    .filter(isPending)
    .sort((a, b) => a.send_at - b.send_at);
  const past = sends.filter((s) => !isPending(s));
  const open = openId !== null ? (sends.find((s) => s.id === openId) ?? null) : null;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Scheduled texts</h1>
        <p className="text-sm text-muted-foreground">
          Texts set to go out later from a group message or an event
          reminder. A pending text can be changed, sent now, or canceled
          until it goes out; a check runs every five minutes.
        </p>
      </div>

      {error ? (
        <p className="text-sm text-destructive">
          Couldn&rsquo;t load scheduled texts: {error.message}
        </p>
      ) : isLoading || !data ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading…
        </div>
      ) : (
        <>
          <SendsTable
            title="Pending"
            description="Soonest first. Click a row to change it."
            rows={pending}
            empty="Nothing is scheduled. Tick “Send later” in a group message or an event reminder to add one."
            onOpen={setOpenId}
          />
          <SendsTable
            title="Sent and canceled"
            description="The last 30 days."
            rows={past}
            empty="Nothing in the last 30 days."
            onOpen={setOpenId}
          />
        </>
      )}

      <ScheduledSendSheet
        send={open}
        onClose={() => setOpenId(null)}
        onChanged={() => mutate()}
      />
    </div>
  );
}

function SendsTable({
  title,
  description,
  rows,
  empty,
  onOpen,
}: {
  title: string;
  description: string;
  rows: XanoScheduledSend[];
  empty: string;
  onOpen: (id: number) => void;
}) {
  return (
    <Card className="bg-white gap-0 overflow-hidden py-0">
      <CardHeader className="border-b py-4">
        <CardTitle className="text-base">
          {title}{" "}
          <span className="font-normal text-muted-foreground tabular-nums">
            {rows.length}
          </span>
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <p className="px-6 py-4 text-sm text-muted-foreground">{empty}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Recipients</TableHead>
                <TableHead>Message</TableHead>
                <TableHead>Scheduled by</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((s) => (
                <TableRow
                  key={s.id}
                  className="cursor-pointer"
                  onClick={() => onOpen(s.id)}
                >
                  <TableCell className="whitespace-nowrap">
                    {sendAtLabel(s.send_at)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">
                    {s.recipients_count || s.contacts?.length || 0}
                  </TableCell>
                  <TableCell className="max-w-md truncate" title={s.body}>
                    {s.body}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {s.created_by_name || s.created_by_email}
                  </TableCell>
                  <TableCell className={cn("whitespace-nowrap", STATUS_CLASS[s.status])}>
                    {STATUS_LABEL[s.status] ?? s.status}
                    {s.status === "sent" && s.sent_count
                      ? ` · ${s.sent_count} sent${s.failed_count ? `, ${s.failed_count} failed` : ""}`
                      : ""}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function ScheduledSendSheet({
  send,
  onClose,
  onChanged,
}: {
  send: XanoScheduledSend | null;
  onClose: () => void;
  onChanged: () => Promise<unknown>;
}) {
  // Draft state is keyed by the open row so a different row starts
  // fresh (the sanctioned adjust-state-on-prop-change pattern).
  const [draftFor, setDraftFor] = useState<number | null>(null);
  const [body, setBody] = useState("");
  const [sendAt, setSendAt] = useState("");
  const [contacts, setContacts] = useState<XanoScheduledSend["contacts"]>([]);
  const [busy, setBusy] = useState<null | "save" | "send" | "cancel">(null);
  const [confirm, setConfirm] = useState<null | "send" | "cancel">(null);
  if (send && draftFor !== send.id) {
    setDraftFor(send.id);
    setBody(send.body);
    setSendAt(toLocalInput(send.send_at));
    setContacts(Array.isArray(send.contacts) ? send.contacts : []);
  }

  const editable = send?.status === "scheduled";
  const sendAtInstant = sendAtMs(sendAt);
  const dirty =
    !!send &&
    (body.trim() !== send.body ||
      (sendAtInstant !== null && sendAtInstant !== send.send_at) ||
      contacts.length !== (send.contacts?.length ?? 0));
  const segments = body.trim().length === 0 ? 0 : Math.ceil(body.trim().length / 160);

  async function patch(payload: Record<string, unknown>, which: "save" | "send" | "cancel") {
    if (!send) return;
    setBusy(which);
    try {
      const res = await fetch(`${KEY}/${send.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) throw new Error(d?.error ?? `Request failed (${res.status})`);
      // Spinner holds until the refreshed list has rendered.
      await onChanged();
      if (which === "save") toast.success("Saved.");
      else if (which === "cancel") {
        toast.success("Canceled — nothing will be sent.");
        onClose();
      } else {
        const outcome = String(d?.outcome ?? "");
        if (outcome === "sent") {
          toast.success(`Sent to ${d?.sent_count ?? 0} ${Number(d?.sent_count) === 1 ? "contact" : "contacts"}.`);
        } else {
          toast.error(d?.error || "It couldn't be sent — see the row for details.");
        }
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setBusy(null);
      setConfirm(null);
    }
  }

  return (
    <>
      <Sheet open={send !== null} onOpenChange={(o) => !o && busy === null && onClose()}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
          {send ? (
            <>
              <SheetHeader className="border-b px-6 py-4">
                <SheetTitle>{send.label || "Scheduled text"}</SheetTitle>
                <SheetDescription>
                  {STATUS_LABEL[send.status] ?? send.status} · scheduled by{" "}
                  {send.created_by_name || send.created_by_email}{" "}
                  {formatNoteTimestamp(send.created_at)}
                </SheetDescription>
              </SheetHeader>

              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
                <div className="space-y-1.5">
                  <Label htmlFor="sched-when">Goes out</Label>
                  {editable ? (
                    <Input
                      id="sched-when"
                      type="datetime-local"
                      value={sendAt}
                      onChange={(e) => setSendAt(e.target.value)}
                      disabled={busy !== null}
                      className="w-auto bg-white"
                    />
                  ) : (
                    <p className="text-sm">{sendAtLabel(send.send_at)}</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="sched-body">Message</Label>
                  {editable ? (
                    <>
                      <Textarea
                        id="sched-body"
                        value={body}
                        rows={5}
                        onChange={(e) => setBody(e.target.value)}
                        disabled={busy !== null}
                        className="bg-white"
                      />
                      <p className="text-right text-[11px] tabular-nums text-muted-foreground">
                        {body.trim().length} chars{segments ? ` · ${segments} seg` : ""}
                      </p>
                    </>
                  ) : (
                    <p className="whitespace-pre-wrap rounded-md border bg-muted/30 px-3 py-2 text-sm">
                      {send.body}
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label>
                    Recipients{" "}
                    <span className="font-normal text-muted-foreground tabular-nums">
                      {contacts.length}
                    </span>
                  </Label>
                  <ul className="divide-y rounded-md border bg-white text-sm">
                    {contacts.map((c) => (
                      <li
                        key={`${c.type}-${c.id}`}
                        className="flex items-center justify-between gap-2 px-3 py-1.5"
                      >
                        <span className="truncate">{c.name || `${c.type} #${c.id}`}</span>
                        {editable ? (
                          <button
                            type="button"
                            className="text-muted-foreground hover:text-destructive disabled:opacity-50"
                            title="Remove from this text"
                            disabled={busy !== null || contacts.length <= 1}
                            onClick={() =>
                              setContacts((prev) =>
                                prev.filter((p) => !(p.type === c.type && p.id === c.id))
                              )
                            }
                          >
                            <X className="size-3.5" />
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                  {editable ? (
                    <p className="text-xs text-muted-foreground">
                      To add people, cancel this text and schedule a new one from the composer.
                    </p>
                  ) : null}
                </div>

                {!editable ? (
                  <div className="space-y-1 text-sm">
                    {send.status === "sent" || send.status === "failed" ? (
                      <p>
                        {send.sent_count} sent
                        {send.failed_count ? `, ${send.failed_count} failed` : ""}
                        {send.skipped_count ? `, ${send.skipped_count} skipped (no number or opted out)` : ""}
                        {send.sent_at ? ` · ${formatNoteTimestamp(send.sent_at)}` : ""}
                      </p>
                    ) : null}
                    {send.status === "canceled" ? (
                      <p className="text-muted-foreground">
                        Canceled by {send.canceled_by}
                        {send.canceled_at ? ` ${formatNoteTimestamp(send.canceled_at)}` : ""}.
                      </p>
                    ) : null}
                    {send.error ? <p className="text-destructive">{send.error}</p> : null}
                  </div>
                ) : send.error ? (
                  <p className="text-sm text-amber-700">
                    Last attempt: {send.error} It will be tried again.
                  </p>
                ) : null}
              </div>

              {editable ? (
                <SheetFooter className="flex-row flex-wrap justify-between gap-2 border-t px-6 py-4">
                  <Button
                    variant="outline"
                    className="bg-white text-destructive hover:text-destructive"
                    disabled={busy !== null}
                    onClick={() => setConfirm("cancel")}
                  >
                    {busy === "cancel" ? <Loader2 className="size-3.5 animate-spin" /> : <X className="size-3.5" />}
                    Cancel text
                  </Button>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      className="bg-white"
                      disabled={busy !== null}
                      onClick={() => setConfirm("send")}
                    >
                      {busy === "send" ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                      Send now
                    </Button>
                    <Button
                      disabled={busy !== null || !dirty || body.trim() === "" || sendAtInstant === null}
                      onClick={() =>
                        void patch(
                          {
                            body: body.trim(),
                            sendAt: sendAtInstant ? new Date(sendAtInstant).toISOString() : undefined,
                            contacts,
                          },
                          "save"
                        )
                      }
                    >
                      {busy === "save" ? <Loader2 className="size-3.5 animate-spin" /> : <Clock className="size-3.5" />}
                      Save changes
                    </Button>
                  </div>
                </SheetFooter>
              ) : null}
            </>
          ) : null}
        </SheetContent>
      </Sheet>

      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && busy === null && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === "cancel"
                ? "Cancel this scheduled text?"
                : `Send it now to ${contacts.length} ${contacts.length === 1 ? "contact" : "contacts"}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "cancel"
                ? "Nothing will be sent. This can't be undone, but you can schedule a new text from the composer."
                : "It goes out right away, as last saved here. Texts can't be unsent."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy !== null}>Go back</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy !== null}
              onClick={(e) => {
                e.preventDefault();
                void patch({ action: confirm === "cancel" ? "cancel" : "send_now" }, confirm === "cancel" ? "cancel" : "send");
              }}
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : confirm === "cancel" ? "Cancel text" : "Send now"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

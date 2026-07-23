"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import {
  Activity,
  Ban,
  CircleCheck,
  Loader2,
  MessageSquareText,
  NotebookPen,
  Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import {
  Message,
  MessageContent,
  MessageFooter,
  MessageHeader,
} from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { adminFetcher } from "@/lib/admin-fetcher";
import { cn } from "@/lib/utils";
import {
  messagesFetcher,
  messagesKey,
  type MessagesResponse,
} from "@/components/admin/family-message-thread";
import type {
  ActivityEvent,
  ActivityResponse,
} from "@/app/api/admin/activity/route";
import type { EmailPreviewResponse } from "@/app/api/admin/email-preview/route";

/**
 * Unified account activity sheet — ONE chronological stream per
 * (family, year) merging admin notes / logged calls, real SMS
 * threads, automated Resend emails, and system milestones derived
 * from the audit stamps the app already writes (submissions,
 * verifies, SUFS pipeline, invoices, crew changes…). Backed by
 * `/api/admin/activity`; no dedicated event table. Deliberately no
 * filter pills — everything reads top-to-bottom as one timeline.
 *
 * Rendered with the same messenger primitives as the SMS inbox:
 * notes, texts, and emails are chat bubbles; system events are
 * compact timeline markers between them. Email bubbles carry a
 * "View full email" affordance that pulls the exact sent HTML back
 * from Resend (via `/api/admin/email-preview`) into a dialog.
 *
 * The composer logs a note (or a call / email / in-person
 * conversation via the category select) through the existing
 * `/api/admin/notes` endpoint, tagged with this sheet's
 * `noteSection` + optional student so scoped surfaces (e.g. the SUFS
 * page) can keep filtering their own comms elsewhere.
 *
 * Two usage modes:
 *   - uncontrolled: renders its own trigger button (inline or
 *     floating variants, mirroring FamilyMessagesSheet)
 *   - controlled: pass `open`/`onOpenChange` and render no trigger —
 *     used by table surfaces that share ONE sheet across many rows.
 *
 * Data loads lazily (SWR key is null until the sheet opens), so
 * mounting many triggers costs nothing.
 */

/**
 * Composer modes — trimmed to just the two that matter (user request):
 * "Note" logs through the notes API, "Text" SENDS a real SMS through
 * the same endpoint the Messages sheet uses. Older notes saved under
 * the retired call/email/in-person buckets still render in the stream
 * — only the composer choices narrowed.
 */
const COMPOSE_CATEGORIES = [
  { key: "other", label: "Note" },
  { key: "text", label: "Text (SMS)" },
] as const;

interface Props {
  familyId: number;
  yearId: number;
  /** Controlled mode — supply both to own open state and skip the
   *  built-in trigger. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Uncontrolled trigger style. */
  variant?: "inline" | "floating";
  triggerLabel?: string;
  /** `section` tag written on notes composed here (e.g. "sufs") —
   *  lets scoped note surfaces keep filtering by section. */
  noteSection?: string;
  /** Student the composed note is about (SUFS rows pass this). */
  noteStudentId?: number | null;
  /** Extra header context, e.g. the student's name on a per-row
   *  sheet. */
  contextLabel?: string;
  disabled?: boolean;
}

export function ActivityLogSheet({
  familyId,
  yearId,
  open: openProp,
  onOpenChange,
  variant = "inline",
  triggerLabel,
  noteSection,
  noteStudentId,
  contextLabel,
  disabled,
}: Props) {
  const [openState, setOpenState] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : openState;
  const setOpen = (v: boolean) => {
    if (!controlled) setOpenState(v);
    onOpenChange?.(v);
  };

  // Lazy: no fetch until the sheet is opened; poll while open so
  // inbound texts and other admins' actions drift in.
  const key =
    open && familyId && yearId
      ? `/api/admin/activity?familyId=${familyId}&yearId=${yearId}`
      : null;
  const { data, isLoading, mutate } = useSWR<ActivityResponse>(
    key,
    adminFetcher,
    { refreshInterval: 30_000 }
  );

  // Recipient state for the Text compose mode — same endpoint (and
  // same SWR cache entry) the Messages sheet uses, so opt-out and
  // phone-number state can't disagree between the two surfaces.
  // Fetched lazily with the sheet.
  const { data: msgData, mutate: mutateMessages } = useSWR<MessagesResponse>(
    open && familyId ? messagesKey(familyId) : null,
    messagesFetcher
  );
  const recipient = msgData?.recipient ?? null;
  const recipientLoaded = msgData !== undefined;

  // Email whose full sent content is being previewed (Resend id +
  // the subject for the dialog title while it loads).
  const [previewEmail, setPreviewEmail] = useState<{
    resendId: string;
    subject: string;
  } | null>(null);

  const [body, setBody] = useState("");
  const [category, setCategory] =
    useState<(typeof COMPOSE_CATEGORIES)[number]["key"]>("other");
  const [saving, setSaving] = useState(false);

  const textMode = category === "text";
  const canText = Boolean(recipient?.e164) && !recipient?.optedOut;
  const segments = body.length === 0 ? 0 : Math.ceil(body.length / 160);
  const composerBlocked = textMode && (!recipientLoaded || !canText);

  async function submit() {
    const text = body.trim();
    if (!text || saving) return;
    if (textMode && !canText) return;
    setSaving(true);
    try {
      if (textMode) {
        // Real SMS — same endpoint as the Messages sheet, carrying
        // this sheet's student/year context on the message row.
        const res = await fetch("/api/admin/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contactType: "family",
            contactId: familyId,
            body: text,
            studentId: noteStudentId ?? null,
            yearId,
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => null);
          throw new Error(err?.error ?? `Send failed (${res.status})`);
        }
        setBody("");
        // Refresh both caches: the stream (shows the outbound text)
        // and the shared messages cache (Messages sheet badge/thread).
        await Promise.all([mutate(), mutateMessages()]);
        toast.success("Text sent.");
      } else {
        const res = await fetch("/api/admin/notes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            registration_families_id: familyId,
            registration_school_years_id: yearId,
            registration_students_id: noteStudentId ?? null,
            body: text,
            category,
            section: noteSection ?? null,
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => null);
          throw new Error(err?.error ?? `Save failed (${res.status})`);
        }
        setBody("");
        await mutate();
        toast.success(
          category === "other" ? "Note added." : "Logged to the timeline."
        );
      }
    } catch (err) {
      console.error("Failed to submit from activity composer:", err);
      toast.error(
        err instanceof Error
          ? err.message
          : textMode
            ? "Couldn't send text."
            : "Couldn't save note."
      );
    } finally {
      setSaving(false);
    }
  }

  // Long threads paginate from the bottom: only the newest PAGE_SIZE
  // events render (the scroller starts at the end anyway); "Show
  // older" at the top of the stream expands the window. All events
  // are already fetched — this is purely a render window, so paging
  // is instant.
  const PAGE_SIZE = 50;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const allEvents = useMemo(() => data?.events ?? [], [data]);
  const hiddenCount = Math.max(0, allEvents.length - visibleCount);
  const items = useMemo(
    () => buildItems(allEvents.slice(-visibleCount)),
    [allEvents, visibleCount]
  );

  return (
    <>
      {controlled ? null : variant === "floating" ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={disabled}
          className="fixed bottom-6 right-6 z-40 inline-flex items-center gap-2 rounded-full border bg-foreground px-4 py-2.5 text-sm font-medium text-background shadow-lg transition-colors hover:bg-foreground/90 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="Open activity log"
        >
          <Activity className="size-4" />
          {triggerLabel ?? "Activity"}
        </button>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="bg-white"
          disabled={disabled}
          onClick={() => setOpen(true)}
        >
          <Activity className="size-3.5 mr-1.5" />
          {triggerLabel ?? "Activity"}
        </Button>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-0 p-0 sm:max-w-xl"
        >
          <SheetHeader className="border-b px-4 py-3">
            <SheetTitle className="flex items-center gap-2 text-base">
              <Activity className="size-4" />
              Activity
              {data?.familyName ? (
                <span className="font-normal text-muted-foreground">
                  · {data.familyName}
                </span>
              ) : null}
            </SheetTitle>
            <SheetDescription className="text-xs">
              {contextLabel
                ? `${contextLabel} — notes, texts, emails, and account milestones in one stream.`
                : "Notes, texts, emails, and account milestones in one stream."}
            </SheetDescription>
          </SheetHeader>

          <div className="min-h-0 flex-1">
            {isLoading && !data ? (
              <div className="flex h-full items-center justify-center">
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              </div>
            ) : items.length === 0 ? (
              <div className="flex h-full items-center justify-center px-8 text-center">
                <p className="text-sm text-muted-foreground">
                  Nothing here yet. Notes you add below and account
                  milestones will build the timeline.
                </p>
              </div>
            ) : (
              <MessageScrollerProvider autoScroll defaultScrollPosition="end">
                <MessageScroller>
                  <MessageScrollerViewport>
                    <MessageScrollerContent className="px-4 py-4">
                      {hiddenCount > 0 ? (
                        <div className="flex justify-center pb-2">
                          <button
                            type="button"
                            onClick={() =>
                              setVisibleCount((n) => n + PAGE_SIZE)
                            }
                            className="rounded-full border bg-white px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                          >
                            Show older ({hiddenCount})
                          </button>
                        </div>
                      ) : null}
                      {items.map((item) =>
                        item.type === "separator" ? (
                          <MessageScrollerItem
                            key={item.id}
                            messageId={item.id}
                          >
                            <Marker variant="separator">
                              <MarkerContent>{item.label}</MarkerContent>
                            </Marker>
                          </MessageScrollerItem>
                        ) : item.event.kind === "system" ? (
                          <MessageScrollerItem
                            key={item.id}
                            messageId={item.id}
                          >
                            <SystemRow event={item.event} />
                          </MessageScrollerItem>
                        ) : (
                          <MessageScrollerItem
                            key={item.id}
                            messageId={item.id}
                            scrollAnchor={item.event.kind === "note"}
                          >
                            <BubbleRow
                              event={item.event}
                              onPreviewEmail={(resendId, subject) =>
                                setPreviewEmail({ resendId, subject })
                              }
                            />
                          </MessageScrollerItem>
                        )
                      )}
                    </MessageScrollerContent>
                  </MessageScrollerViewport>
                  <MessageScrollerButton />
                </MessageScroller>
              </MessageScrollerProvider>
            )}
          </div>

          {/* Composer — notes/calls/emails log to the timeline via
              the notes API; Text (SMS) mode sends a REAL text through
              the same endpoint as the Messages sheet, then the
              outbound message appears in the stream like any other. */}
          <div className="space-y-2 border-t bg-muted/20 px-4 py-3">
            <div className="flex items-center gap-2">
              {/* Segmented Note | Text toggle — with only two modes a
                  dropdown was two clicks for a binary choice. */}
              <div className="inline-flex rounded-md border bg-white p-0.5">
                {COMPOSE_CATEGORIES.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    aria-pressed={category === c.key}
                    onClick={() => setCategory(c.key)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors",
                      category === c.key
                        ? "bg-foreground text-background"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {c.key === "text" ? (
                      <MessageSquareText className="size-3" />
                    ) : (
                      <NotebookPen className="size-3" />
                    )}
                    {c.key === "text" ? "Text" : "Note"}
                  </button>
                ))}
              </div>
              {contextLabel ? (
                <span className="truncate text-[11px] text-muted-foreground">
                  About {contextLabel}
                </span>
              ) : null}
            </div>
            {textMode && recipientLoaded && recipient?.optedOut ? (
              <Marker className="text-amber-600">
                <MarkerIcon>
                  <Ban />
                </MarkerIcon>
                <MarkerContent>
                  This contact opted out of text messages. You can&rsquo;t
                  text them until they opt back in.
                </MarkerContent>
              </Marker>
            ) : textMode && recipientLoaded && !recipient?.e164 ? (
              <Marker className="text-muted-foreground">
                <MarkerContent>
                  No valid mobile number on file for this family.
                </MarkerContent>
              </Marker>
            ) : null}
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  (e.shiftKey || e.metaKey || e.ctrlKey)
                ) {
                  e.preventDefault();
                  void submit();
                }
              }}
              rows={2}
              disabled={composerBlocked || saving}
              placeholder={
                textMode
                  ? recipientLoaded
                    ? canText
                      ? `Text ${recipient?.name || "this family"}…`
                      : "Texting unavailable"
                    : "Checking number on file…"
                  : "Add a note to the timeline…"
              }
            />
            <div className="space-y-1.5">
              {textMode && segments > 0 ? (
                <p className="text-[11px] text-muted-foreground tabular-nums">
                  {body.length} chars · {segments} segment
                  {segments === 1 ? "" : "s"}
                </p>
              ) : null}
              <Button
                size="sm"
                className="w-full"
                onClick={() => void submit()}
                disabled={saving || !body.trim() || composerBlocked}
              >
                {saving ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin mr-1.5" />
                    {textMode ? "Sending" : "Saving"}
                  </>
                ) : (
                  <>
                    <Send className="size-3.5 mr-1.5" />
                    {textMode ? "Send Text" : "Add Note"}
                  </>
                )}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <EmailPreviewDialog
        preview={previewEmail}
        onClose={() => setPreviewEmail(null)}
      />
    </>
  );
}

/* ── Email preview ────────────────────────────────────────────────── */

/**
 * Full-content view of a sent email, fetched from Resend by message
 * id (our audit table only stores the subject). Rendered inside a
 * sandboxed iframe via `srcDoc` — no scripts, no outside navigation —
 * so template HTML displays exactly as the family received it
 * without executing anything.
 */
function EmailPreviewDialog({
  preview,
  onClose,
}: {
  preview: { resendId: string; subject: string } | null;
  onClose: () => void;
}) {
  const { data, error, isLoading } = useSWR<EmailPreviewResponse>(
    preview ? `/api/admin/email-preview?id=${preview.resendId}` : null,
    adminFetcher
  );

  return (
    <Dialog open={preview !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-base">
            {data?.subject || preview?.subject || "Email"}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {data
              ? `From ${data.from} · To ${data.to}${
                  data.cc ? ` · Cc ${data.cc}` : ""
                }`
              : "Retrieving the sent email from Resend…"}
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="flex h-[50vh] items-center justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : error || !data ? (
          <div className="flex h-[30vh] items-center justify-center px-8 text-center">
            <p className="text-sm text-muted-foreground">
              {error instanceof Error
                ? error.message
                : "Couldn't retrieve this email from Resend."}
            </p>
          </div>
        ) : data.html ? (
          <iframe
            title="Sent email preview"
            srcDoc={data.html}
            sandbox=""
            className="h-[60vh] w-full rounded-md border bg-white"
          />
        ) : (
          <pre className="h-[60vh] w-full overflow-auto rounded-md border bg-muted/20 p-4 text-sm whitespace-pre-wrap">
            {data.text || "This email has no stored content."}
          </pre>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ── Stream rendering ─────────────────────────────────────────────── */

/** System milestone — positive outcomes (accepted / confirmed /
 *  enrolled) render as a larger green bubble so they pop in the
 *  stream; everything else keeps the compact muted marker. */
function SystemRow({ event }: { event: ActivityEvent }) {
  const milestone = /accepted|confirmed|enrolled|invoice paid|payment/i.test(
    event.title
  );
  if (milestone) {
    return (
      <div className="flex justify-center py-1">
        <div className="inline-flex max-w-full items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          <CircleCheck className="size-4 shrink-0 text-emerald-600" />
          <span className="min-w-0 truncate">
            <span className="font-semibold">{event.title}</span>
            {event.studentName ? <> — {event.studentName}</> : null}
            {event.author ? <> · {event.author}</> : null}
            <span className="tabular-nums"> · {shortWhen(event.ts)}</span>
          </span>
        </div>
      </div>
    );
  }
  return (
    <Marker className="text-muted-foreground">
      <MarkerIcon>
        <CircleCheck />
      </MarkerIcon>
      <MarkerContent>
        <span className="font-medium text-foreground/80">{event.title}</span>
        {event.studentName ? <> — {event.studentName}</> : null}
        {event.body ? <> · {event.body}</> : null}
        {event.author ? <> · {event.author}</> : null}
        <span className="tabular-nums"> · {shortWhen(event.ts)}</span>
      </MarkerContent>
    </Marker>
  );
}

/** Note, text, or automated email — a chat bubble. Admin-authored
 *  content (notes, outbound texts, our emails) aligns right; inbound
 *  texts align left. Emails render the SUBJECT as the bubble body,
 *  with a "View full email" affordance that opens the Resend-backed
 *  preview dialog. */
function BubbleRow({
  event,
  onPreviewEmail,
}: {
  event: ActivityEvent;
  onPreviewEmail: (resendId: string, subject: string) => void;
}) {
  const isNote = event.kind === "note";
  const isEmail = event.kind === "email";
  const failed =
    event.status === "failed" || event.status === "undelivered";
  const inbound = event.kind === "sms" && event.direction === "inbound";
  const align = inbound ? "start" : "end";
  const variant = failed
    ? "destructive"
    : isNote || isEmail
      ? "tinted"
      : inbound
        ? "secondary"
        : "default";
  return (
    <Message align={align}>
      <MessageContent>
        <MessageHeader>
          {event.author || "Admin"}
          {isNote && event.title !== "Note" ? (
            <span className="text-muted-foreground"> · {event.title}</span>
          ) : null}
          {event.kind === "sms" ? (
            <span className="text-muted-foreground">
              {" "}
              · {event.isGroup ? "Group text" : "Text"}
            </span>
          ) : null}
          {isEmail ? (
            <span className="text-muted-foreground"> · Email</span>
          ) : null}
          {event.studentName ? (
            <span className="text-muted-foreground">
              {" "}
              · {event.studentName}
            </span>
          ) : null}
        </MessageHeader>
        <Bubble variant={variant}>
          <BubbleContent className="whitespace-pre-wrap">
            {event.body}
          </BubbleContent>
        </Bubble>
        <MessageFooter title={new Date(event.ts).toLocaleString()}>
          {isEmail && failed ? (
            <span className="text-destructive">Failed&nbsp;·&nbsp;</span>
          ) : null}
          {timeLabel(event.ts)}
          {/* First-open stamp from Resend's open tracking. Pixel-based
              — "Viewed" means probably viewed; absence means unknown,
              not unread. */}
          {isEmail && event.openedAt ? (
            <span
              className="text-emerald-600"
              title={`First opened ${new Date(event.openedAt).toLocaleString()}`}
            >
              &nbsp;·&nbsp;Viewed {shortWhen(event.openedAt)}
            </span>
          ) : null}
          {isEmail && event.resendId ? (
            <>
              &nbsp;·&nbsp;
              <button
                type="button"
                className="underline underline-offset-2 hover:text-foreground"
                onClick={() =>
                  onPreviewEmail(event.resendId as string, event.body)
                }
              >
                View full email
              </button>
            </>
          ) : null}
        </MessageFooter>
      </MessageContent>
    </Message>
  );
}

type StreamItem =
  | { type: "separator"; id: string; label: string }
  | { type: "event"; id: string; event: ActivityEvent };

/** Flatten ascending events into render items with day separators —
 *  same pattern as the SMS thread. */
function buildItems(events: ActivityEvent[]): StreamItem[] {
  const out: StreamItem[] = [];
  let lastDay = "";
  for (const e of events) {
    const d = new Date(e.ts);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (key !== lastDay) {
      out.push({ type: "separator", id: `sep-${key}`, label: dayLabel(e.ts) });
      lastDay = key;
    }
    out.push({ type: "event", id: e.id, event: e });
  }
  return out;
}

function dayLabel(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const startOf = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(now) - startOf(d)) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return d.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: d.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

function timeLabel(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Compact date+time for marker rows ("Jul 21, 2:14 PM"). */
function shortWhen(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  return `${d.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: d.getFullYear() === now.getFullYear() ? undefined : "numeric",
  })}, ${timeLabel(ts)}`;
}

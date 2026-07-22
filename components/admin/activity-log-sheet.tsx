"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import {
  Activity,
  CircleCheck,
  Loader2,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import type {
  ActivityEvent,
  ActivityResponse,
} from "@/app/api/admin/activity/route";

/**
 * Unified account activity sheet — one chronological stream per
 * (family, year) merging admin notes / logged calls, real SMS
 * threads, and system milestones derived from the audit stamps the
 * app already writes (submissions, verifies, SUFS pipeline, invoices,
 * crew changes…). Backed by `/api/admin/activity`; no dedicated event
 * table.
 *
 * Rendered with the same messenger primitives as the SMS inbox:
 * notes and texts are chat bubbles, system events are compact
 * timeline markers between them.
 *
 * Filter pills narrow the stream (All / App & Reg / SUFS /
 * Enrollment / Texts / Notes) — the full stream is always loaded, so
 * admin can widen the view from any surface. The composer logs a
 * note (or a call / email / in-person conversation via the category
 * select) through the existing `/api/admin/notes` endpoint, tagged
 * with this sheet's `noteSection` + optional student so scoped
 * surfaces (e.g. the SUFS page) can filter their own comms later.
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

type FilterKey =
  | "all"
  | "appreg"
  | "sufs"
  | "enrollment"
  | "sms"
  | "email"
  | "note";

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: "all", label: "All" },
  { key: "appreg", label: "App & Reg" },
  { key: "sufs", label: "SUFS" },
  { key: "enrollment", label: "Enrollment" },
  { key: "sms", label: "Texts" },
  { key: "email", label: "Emails" },
  { key: "note", label: "Notes" },
];

function matchesFilter(e: ActivityEvent, f: FilterKey): boolean {
  switch (f) {
    case "all":
      return true;
    case "appreg":
      return e.scope === "application" || e.scope === "registration";
    case "sufs":
      return e.scope === "sufs";
    case "enrollment":
      return e.scope === "enrollment";
    case "sms":
      return e.kind === "sms";
    case "email":
      return e.kind === "email";
    case "note":
      return e.kind === "note";
  }
}

/** Composer category → the notes API's `category` bucket. */
const COMPOSE_CATEGORIES = [
  { key: "other", label: "Note" },
  { key: "phone", label: "Call" },
  { key: "email", label: "Email" },
  { key: "in-person", label: "In person" },
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
  /** Pill preselected when the sheet opens. */
  defaultFilter?: FilterKey;
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
  defaultFilter = "all",
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

  const [filter, setFilter] = useState<FilterKey>(defaultFilter);

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

  const filtered = useMemo(
    () => (data?.events ?? []).filter((e) => matchesFilter(e, filter)),
    [data, filter]
  );

  const [body, setBody] = useState("");
  const [category, setCategory] =
    useState<(typeof COMPOSE_CATEGORIES)[number]["key"]>("other");
  const [saving, setSaving] = useState(false);

  async function logNote() {
    const text = body.trim();
    if (!text || saving) return;
    setSaving(true);
    try {
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
    } catch (err) {
      console.error("Failed to log activity note:", err);
      toast.error(err instanceof Error ? err.message : "Couldn't save note.");
    } finally {
      setSaving(false);
    }
  }

  const items = useMemo(() => buildItems(filtered), [filtered]);

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
                ? `${contextLabel} — notes, texts, and account milestones in one stream.`
                : "Notes, texts, and account milestones in one stream."}
            </SheetDescription>
            {/* Filter pills */}
            <div className="flex flex-wrap gap-1.5 pt-1">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setFilter(f.key)}
                  className={cn(
                    "rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                    filter === f.key
                      ? "border-foreground bg-foreground text-background"
                      : "bg-white text-muted-foreground hover:text-foreground"
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </SheetHeader>

          <div className="min-h-0 flex-1">
            {isLoading && !data ? (
              <div className="flex h-full items-center justify-center">
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              </div>
            ) : items.length === 0 ? (
              <div className="flex h-full items-center justify-center px-8 text-center">
                <p className="text-sm text-muted-foreground">
                  Nothing here yet
                  {filter !== "all" ? " for this filter" : ""}. Notes you
                  add below and account milestones will build the
                  timeline.
                </p>
              </div>
            ) : (
              <MessageScrollerProvider autoScroll defaultScrollPosition="end">
                <MessageScroller>
                  <MessageScrollerViewport>
                    <MessageScrollerContent className="px-4 py-4">
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
                            <BubbleRow event={item.event} />
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

          {/* Composer — logs notes/calls/emails onto the timeline via
              the existing notes API. Texting stays in the Messages
              sheet (it needs recipient/opt-out state); texts still
              show here read-only. */}
          <div className="space-y-2 border-t bg-muted/20 px-4 py-3">
            <div className="flex items-center gap-2">
              <NotebookPen className="size-3.5 text-muted-foreground" />
              <Select
                value={category}
                onValueChange={(v) =>
                  setCategory(v as (typeof COMPOSE_CATEGORIES)[number]["key"])
                }
              >
                <SelectTrigger className="h-7 w-[130px] bg-white text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COMPOSE_CATEGORIES.map((c) => (
                    <SelectItem key={c.key} value={c.key}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {contextLabel ? (
                <span className="truncate text-[11px] text-muted-foreground">
                  About {contextLabel}
                </span>
              ) : null}
            </div>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  (e.shiftKey || e.metaKey || e.ctrlKey)
                ) {
                  e.preventDefault();
                  void logNote();
                }
              }}
              rows={2}
              placeholder={
                category === "phone"
                  ? "Log the call — who you spoke to, what was said…"
                  : "Add a note to the timeline…"
              }
            />
            <div className="flex items-center justify-end">
              <Button
                size="sm"
                onClick={() => void logNote()}
                disabled={saving || !body.trim()}
              >
                {saving ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin mr-1.5" />
                    Saving
                  </>
                ) : (
                  <>
                    <Send className="size-3.5 mr-1.5" />
                    Log
                  </>
                )}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

/* ── Stream rendering ─────────────────────────────────────────────── */

/** System milestone — a compact centered marker between the bubbles. */
function SystemRow({ event }: { event: ActivityEvent }) {
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
 *  texts align left. Emails render the SUBJECT as the bubble body
 *  (the audit row doesn't store the full html). */
function BubbleRow({ event }: { event: ActivityEvent }) {
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
            <span className="text-muted-foreground"> · Text</span>
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

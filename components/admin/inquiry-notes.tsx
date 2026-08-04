"use client";

import { useState, type ReactNode } from "react";
import useSWR, { useSWRConfig } from "swr";
import { toast } from "sonner";
import { Loader2, MessageSquareText, NotebookPen } from "lucide-react";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Marker, MarkerContent } from "@/components/ui/marker";
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
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
// Category selector is now selectable pills, not a dropdown — see
// `CATEGORY_OPTIONS.short` below. The shadcn `Select` import is no
// longer needed here.
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
import { formatUSPhone } from "@/lib/phone";
import {
  contactMessagesKey,
  messagesFetcher,
  type MessagesResponse,
} from "@/components/admin/family-message-thread";
import type {
  LeadNoteSource,
  XanoAdminNote,
  XanoSmsMessage,
} from "@/lib/xano";

const fetcher = async (url: string): Promise<XanoAdminNote[]> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load notes (${res.status})`);
  return res.json();
};

/** Which recruitment lead a notes timeline belongs to. All four
 *  sources share `registration_admin_notes`, keyed by their own FK. */
export interface LeadNoteScope {
  source: LeadNoteSource;
  id: number;
}

/** One SWR key per lead — the timeline and any standalone composer
 *  subscribe to the same entry, so a post from either refreshes both. */
export function leadNotesKey(scope: LeadNoteScope): string {
  return `/api/admin/notes?leadSource=${scope.source}&leadId=${scope.id}`;
}

/**
 * DISPLAY labels for note categories — the timeline still renders
 * legacy phone/email/in-person notes with their original labels, so
 * this list stays complete even though the composer below only offers
 * two choices now.
 */
const CATEGORY_OPTIONS: { value: string; label: string; short: string }[] = [
  { value: "phone", label: "Phone call", short: "Call" },
  { value: "email", label: "Email", short: "Email" },
  { value: "in-person", label: "In-person", short: "Visit" },
  { value: "sms", label: "Text message", short: "SMS" },
  { value: "other", label: "Note", short: "Note" },
];

/** Composer choices — trimmed to the two that matter (user request):
 *  "Note" logs to the comms timeline ("other" category), "SMS" sends
 *  a REAL text through the messaging pipeline. */
const COMPOSE_CATEGORIES = [
  { value: "other", label: "Note" },
  { value: "sms", label: "SMS" },
] as const;

/**
 * Composer submit shared by both variants. The SMS category is not a
 * note — it sends a real text through the messaging pipeline
 * (`POST /api/admin/messages` resolves the lead's phone, honors
 * opt-outs, and logs the thread in the Messages inbox). Every other
 * category writes a comms-log note. Throws with a human-readable
 * message on failure so callers can toast it verbatim.
 */
async function postLeadEntry(
  scope: LeadNoteScope,
  category: string,
  text: string
): Promise<{ warning?: string }> {
  const isSms = category === "sms";
  const res = await fetch(
    isSms ? "/api/admin/messages" : "/api/admin/notes",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        isSms
          ? { contactType: scope.source, contactId: scope.id, body: text }
          : {
              leadSource: scope.source,
              leadId: scope.id,
              body: text,
              category,
              is_pinned: false,
            }
      ),
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(
      err?.error ?? `${isSms ? "Send" : "Save"} failed (${res.status})`
    );
  }
  // A 201 can still carry a warning (e.g. "sent but logging failed") —
  // pass it up so the composer can toast it instead of a plain success.
  const data = await res.json().catch(() => null);
  return { warning: typeof data?.warning === "string" ? data.warning : undefined };
}

/**
 * Segmented Note | SMS toggle used by both composer variants — same
 * 50/50 control the activity sheet's composer uses, so the two
 * surfaces read identically. Behaves like a `radiogroup`.
 */
function CategoryPills({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <div
      className="grid w-full grid-cols-2 rounded-md border bg-white p-0.5"
      role="radiogroup"
      aria-label="Composer mode"
    >
      {COMPOSE_CATEGORIES.map((c) => {
        const selected = value === c.value;
        return (
          <button
            key={c.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(c.value)}
            className={cn(
              "inline-flex items-center justify-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors",
              selected
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {c.value === "sms" ? (
              <MessageSquareText className="size-3" />
            ) : (
              <NotebookPen className="size-3" />
            )}
            {c.label}
          </button>
        );
      })}
    </div>
  );
}

interface Props {
  /** Inquiry-scoped shorthand — equivalent to
   *  `scope={{ source: "inquiry", id }}`. */
  inquiryId?: number;
  /** Any recruitment lead (inquiry / camp / visit / TASCO). Takes
   *  precedence over `inquiryId`. */
  scope?: LeadNoteScope;
  /** Optional callback fired after a successful note add — the parent
   *  Sheet uses this to revalidate the lead list so `last_reach_out`
   *  (bumped server-side on POST) reflects in the table immediately. */
  onNoteAdded?: () => void;
  /**
   * Layout selector.
   *
   *   - `"panel"` — list + composer rendered together in a single
   *     flow. Useful for surfaces that don't have a fixed-bottom
   *     region of their own.
   *   - `"timeline"` — list only, no composer. Pair with a
   *     `<InquiryNoteComposer>` rendered separately (e.g. pinned to
   *     the bottom of a Sheet) so the composer is always reachable
   *     while the timeline scrolls.
   */
  variant?: "panel" | "timeline";
}

/**
 * Lead-scoped notes log — inquiries, summer camp, liability-waiver
 * visits, and TASCO all use this. Backed by the same
 * `registration_admin_notes` Xano table the family-side comms log
 * uses; rows are distinguished by which foreign key is set (one per
 * lead source, vs `registration_families_id`) so no two timelines
 * bleed into each other.
 *
 * Pinned notes float to the top, then chronological newest first —
 * same ordering the family notes drawer uses, so admins see the same
 * timeline shape on every surface.
 *
 * Rendering shape is controlled by `variant`:
 *   - `panel` packs the list + composer into one block (used by
 *     surfaces that scroll the whole thing together)
 *   - `timeline` renders just the list and exposes the composer as a
 *     standalone export (`<InquiryNoteComposer>`) so callers can pin
 *     it to a fixed bottom region of their own layout.
 */
export function InquiryNotes({
  inquiryId,
  scope,
  onNoteAdded,
  variant = "panel",
}: Props) {
  const leadScope: LeadNoteScope = scope ?? {
    source: "inquiry",
    id: inquiryId ?? 0,
  };
  const swrKey = leadNotesKey(leadScope);
  const { data, isLoading, mutate } = useSWR<XanoAdminNote[]>(swrKey, fetcher, {
    revalidateOnFocus: false,
  });
  // The lead's real SMS thread, merged into the timeline below so the
  // comms log shows texts (sent AND received) inline with call/email
  // notes. Same SWR key as the Messages inbox thread — a send from
  // either surface refreshes both.
  const smsKey = contactMessagesKey(leadScope.source, leadScope.id);
  const { data: smsData, mutate: mutateSms } = useSWR<MessagesResponse>(
    smsKey,
    messagesFetcher,
    { revalidateOnFocus: false }
  );
  const smsMessages = smsData?.messages ?? [];

  const notes = data ?? [];
  const pinned = notes.filter((n) => n.is_pinned);
  // Chronological chat stream (oldest → newest, same shape as the
  // activity sheet): un-pinned notes + every text on this lead's
  // thread, interleaved by timestamp under day separators.
  const stream: TimelineEntry[] = [
    ...notes
      .filter((n) => !n.is_pinned)
      .map((note) => ({ kind: "note" as const, note })),
    ...smsMessages.map((msg) => ({ kind: "sms" as const, msg })),
  ].sort((a, b) => entryTs(a) - entryTs(b));

  const [body, setBody] = useState("");
  const [category, setCategory] = useState("other");
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);

  async function submitNote() {
    if (!body.trim() || saving) return;
    const isSms = category === "sms";
    setSaving(true);
    try {
      const { warning } = await postLeadEntry(leadScope, category, body.trim());
      setBody("");
      await (isSms ? mutateSms() : mutate());
      onNoteAdded?.();
      if (warning) toast.warning(warning);
      else toast.success(isSms ? "Text sent." : "Note added.");
    } catch (err) {
      console.error(isSms ? "Failed to send text:" : "Failed to add note:", err);
      toast.error(
        err instanceof Error
          ? err.message
          : isSms
            ? "Failed to send text."
            : "Failed to add note."
      );
    } finally {
      setSaving(false);
    }
  }

  async function togglePin(note: XanoAdminNote) {
    await mutate(
      (curr) =>
        (curr ?? []).map((n) =>
          n.id === note.id ? { ...n, is_pinned: !n.is_pinned } : n
        ),
      { revalidate: false }
    );
    try {
      const res = await fetch(`/api/admin/notes/${note.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_pinned: !note.is_pinned }),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      await mutate();
    } catch (err) {
      console.error("Failed to toggle pin:", err);
      toast.error("Couldn't update pin.");
      await mutate();
    }
  }

  async function confirmDelete() {
    if (pendingDelete === null) return;
    const id = pendingDelete;
    setPendingDelete(null);
    try {
      const res = await fetch(`/api/admin/notes/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`Delete failed (${res.status})`);
      await mutate();
      toast.success("Note removed.");
    } catch (err) {
      console.error("Failed to delete note:", err);
      toast.error("Couldn't delete note.");
    }
  }

  // Render rows: pinned cluster first, then the day-separated chat
  // stream — notes are right-aligned admin bubbles, texts render like
  // the SMS inbox (outbound right, inbound left). Shared by both
  // variants: the sheet timeline wraps each row in a
  // MessageScrollerItem; the panel renders them directly.
  const rows: Array<{ id: string; anchor?: boolean; node: ReactNode }> = [];
  if (pinned.length > 0) {
    rows.push({
      id: "pinned-sep",
      node: (
        <Marker variant="separator">
          <MarkerContent>Pinned</MarkerContent>
        </Marker>
      ),
    });
    for (const n of pinned) {
      rows.push({
        id: `pin-${n.id}`,
        node: (
          <NoteBubble
            note={n}
            onTogglePin={togglePin}
            onDelete={(id) => setPendingDelete(id)}
            onEdited={() => mutate()}
          />
        ),
      });
    }
  }
  let lastDay = "";
  for (const e of stream) {
    const ts = entryTs(e);
    const d = new Date(ts);
    const dayKey = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (dayKey !== lastDay) {
      rows.push({
        id: `sep-${dayKey}`,
        node: (
          <Marker variant="separator">
            <MarkerContent>{dayLabel(ts)}</MarkerContent>
          </Marker>
        ),
      });
      lastDay = dayKey;
    }
    if (e.kind === "note") {
      rows.push({
        id: `note-${e.note.id}`,
        anchor: true,
        node: (
          <NoteBubble
            note={e.note}
            onTogglePin={togglePin}
            onDelete={(id) => setPendingDelete(id)}
            onEdited={() => mutate()}
          />
        ),
      });
    } else {
      rows.push({
        id: `sms-${e.msg.id}`,
        anchor: e.msg.direction === "outbound",
        node: <SmsBubble msg={e.msg} />,
      });
    }
  }

  const composer = (
    // Layout (top → bottom): category pills, textarea, full-width
    // Add note button. Pills sit above the textarea so admin picks
    // the channel before they start writing — matches the natural
    // flow ("I just had a call → write what we discussed").
    <div className="rounded-md border bg-muted/20 p-3 space-y-2">
      <CategoryPills value={category} onChange={setCategory} />
      <Textarea
        placeholder={
          category === "sms"
            ? "Write the text message — it will be sent to this lead's phone and logged in Messages."
            : "Phone call summary, follow-up needed, parent context — write what the next admin should know."
        }
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
      />
      <Button
        size="sm"
        onClick={submitNote}
        disabled={saving || !body.trim()}
        className="w-full"
      >
        {saving ? (
          <>
            <Loader2 className="size-3.5 animate-spin mr-1.5" />
            {category === "sms" ? "Sending" : "Saving"}
          </>
        ) : category === "sms" ? (
          "Send text"
        ) : (
          "Add note"
        )}
      </Button>
    </div>
  );

  const deleteDialog = (
    <AlertDialog
      open={pendingDelete !== null}
      onOpenChange={(o) => {
        if (!o) setPendingDelete(null);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this note?</AlertDialogTitle>
          <AlertDialogDescription>
            The note will be removed from this lead&rsquo;s record. This
            can&rsquo;t be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-red-600 text-white hover:bg-red-700"
            onClick={(e) => {
              e.preventDefault();
              void confirmDelete();
            }}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  if (variant === "timeline") {
    // Chat stream filling the host's height-constrained region —
    // MessageScroller pins to the newest message like the SMS inbox
    // and activity sheets. Caller renders a sibling
    // `<InquiryNoteComposer>` (typically docked to the Sheet bottom).
    // The delete dialog ships with the timeline.
    return (
      <>
        {isLoading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex h-full items-center justify-center px-8 text-center">
            <p className="text-sm text-muted-foreground">
              No communications logged yet. The first note here is
              yours.
            </p>
          </div>
        ) : (
          <MessageScrollerProvider autoScroll defaultScrollPosition="end">
            <MessageScroller>
              <MessageScrollerViewport>
                <MessageScrollerContent className="px-4 py-4">
                  {rows.map((r) => (
                    <MessageScrollerItem
                      key={r.id}
                      messageId={r.id}
                      scrollAnchor={r.anchor}
                    >
                      {r.node}
                    </MessageScrollerItem>
                  ))}
                </MessageScrollerContent>
              </MessageScrollerViewport>
              <MessageScrollerButton />
            </MessageScroller>
          </MessageScrollerProvider>
        )}
        {deleteDialog}
      </>
    );
  }

  return (
    <div className="space-y-3">
      <div className="max-h-[40vh] space-y-3 overflow-y-auto overscroll-contain pr-1">
        {isLoading ? (
          <p className="text-xs text-muted-foreground">Loading notes…</p>
        ) : rows.length === 0 ? (
          <p className="text-xs italic text-muted-foreground">
            No communications logged yet. The first note here is yours.
          </p>
        ) : (
          rows.map((r) => <div key={r.id}>{r.node}</div>)
        )}
      </div>
      {composer}
      {deleteDialog}
    </div>
  );
}

/**
 * Standalone composer + category selector. Pair with
 * `<InquiryNotes variant="timeline">` when the host layout wants to
 * pin the composer to a fixed-bottom region (Sheet footer, etc.).
 *
 * Holds its own internal SWR mutation via the same key the timeline
 * subscribes to, so submitting from this composer auto-refreshes the
 * timeline that's mounted elsewhere on the page.
 */
export function InquiryNoteComposer({
  inquiryId,
  scope,
  onNoteAdded,
}: {
  inquiryId?: number;
  scope?: LeadNoteScope;
  onNoteAdded?: () => void;
}) {
  const leadScope: LeadNoteScope = scope ?? {
    source: "inquiry",
    id: inquiryId ?? 0,
  };
  const swrKey = leadNotesKey(leadScope);
  const { mutate } = useSWR<XanoAdminNote[]>(swrKey, fetcher, {
    revalidateOnFocus: false,
  });
  // Global mutate so an SMS send refreshes the timeline's message
  // subscription (mounted in a sibling <InquiryNotes>) by key.
  const { mutate: globalMutate } = useSWRConfig();

  const [body, setBody] = useState("");
  const [category, setCategory] = useState("other");
  const [saving, setSaving] = useState(false);

  async function submitNote() {
    if (!body.trim() || saving) return;
    const isSms = category === "sms";
    setSaving(true);
    try {
      const { warning } = await postLeadEntry(leadScope, category, body.trim());
      setBody("");
      await (isSms
        ? globalMutate(contactMessagesKey(leadScope.source, leadScope.id))
        : mutate());
      onNoteAdded?.();
      if (warning) toast.warning(warning);
      else toast.success(isSms ? "Text sent." : "Note added.");
    } catch (err) {
      console.error(isSms ? "Failed to send text:" : "Failed to add note:", err);
      toast.error(
        err instanceof Error
          ? err.message
          : isSms
            ? "Failed to send text."
            : "Failed to add note."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    // Same composer layout as the panel variant — pills, textarea,
    // full-width add button. Layout-wise the only difference is the
    // surrounding wrapper (caller-controlled padding for the
    // standalone composer; padded card for the panel composer).
    <div className="space-y-2">
      <CategoryPills value={category} onChange={setCategory} />
      <Textarea
        placeholder={
          category === "sms"
            ? "Write the text message — it will be sent to this lead's phone and logged in Messages."
            : "Phone call summary, follow-up needed, parent context — write what the next admin should know."
        }
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
      />
      <Button
        size="sm"
        onClick={submitNote}
        disabled={saving || !body.trim()}
        className="w-full"
      >
        {saving ? (
          <>
            <Loader2 className="size-3.5 animate-spin mr-1.5" />
            {category === "sms" ? "Sending" : "Saving"}
          </>
        ) : category === "sms" ? (
          "Send text"
        ) : (
          "Add note"
        )}
      </Button>
    </div>
  );
}

/**
 * Admin note as a right-aligned chat bubble (tinted, matching the
 * activity stream's notes). Pin / Edit / Delete are subtle footer
 * links; Edit swaps the bubble for an in-place textarea.
 */
function NoteBubble({
  note,
  onTogglePin,
  onDelete,
  onEdited,
}: {
  note: XanoAdminNote;
  onTogglePin: (n: XanoAdminNote) => void;
  onDelete: (id: number) => void;
  onEdited: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.body);
  const [saving, setSaving] = useState(false);

  async function saveEdit() {
    if (saving) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/notes/${note.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: draft }),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      setEditing(false);
      onEdited();
      toast.success("Note updated.");
    } catch (err) {
      console.error("Failed to save note:", err);
      toast.error("Couldn't save note.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Message
      align="end"
      className="animate-in fade-in-0 slide-in-from-bottom-1 duration-200"
    >
      <MessageContent>
        <MessageHeader>
          {note.author_name || "Admin"}
          {note.category ? (
            <span className="text-muted-foreground">
              {" "}
              · {formatCategory(note.category)}
            </span>
          ) : null}
          {note.is_pinned ? (
            <span className="text-muted-foreground"> · Pinned</span>
          ) : null}
        </MessageHeader>
        {editing ? (
          <div className="w-full space-y-2">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
            />
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setEditing(false);
                  setDraft(note.body);
                }}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={saving}
                onClick={() => void saveEdit()}
              >
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <Bubble variant="tinted">
              <BubbleContent className="whitespace-pre-wrap">
                {note.body}
              </BubbleContent>
            </Bubble>
            <MessageFooter
              title={new Date(note.created_at).toLocaleString()}
            >
              {timeLabel(note.created_at)}
              {note.last_edited ? <span>&nbsp;·&nbsp;Edited</span> : null}
              &nbsp;·&nbsp;
              <button
                type="button"
                className="underline underline-offset-2 hover:text-foreground"
                onClick={() => onTogglePin(note)}
              >
                {note.is_pinned ? "Unpin" : "Pin"}
              </button>
              &nbsp;·&nbsp;
              <button
                type="button"
                className="underline underline-offset-2 hover:text-foreground"
                onClick={() => setEditing(true)}
              >
                Edit
              </button>
              &nbsp;·&nbsp;
              <button
                type="button"
                className="underline underline-offset-2 hover:text-destructive"
                onClick={() => onDelete(note.id)}
              >
                Delete
              </button>
            </MessageFooter>
          </>
        )}
      </MessageContent>
    </Message>
  );
}

function formatCategory(c: string): string {
  const found = CATEGORY_OPTIONS.find((o) => o.value === c);
  return found?.label ?? c;
}

/** One entry in the merged comms timeline — an admin note or a real
 *  text from the lead's SMS thread. */
type TimelineEntry =
  | { kind: "note"; note: XanoAdminNote }
  | { kind: "sms"; msg: XanoSmsMessage };

function entryTs(e: TimelineEntry): number {
  return e.kind === "note" ? e.note.created_at : e.msg.created_at;
}

/** Compact delivery-state vocabulary for timeline SMS rows — mirrors
 *  the labels the Messages inbox thread uses. */
const SMS_STATUS_LABEL: Record<string, string> = {
  queued: "Queued",
  sent: "Sent",
  delivered: "Delivered",
  undelivered: "Undelivered",
  failed: "Failed",
};

/**
 * Real SMS as a chat bubble — outbound aligns right (red when the
 * carrier bounced it), inbound replies align left. Read-only: the
 * message log records what was actually sent/received. Header carries
 * the from-number (our Twilio number outbound, the parent's inbound).
 */
function SmsBubble({ msg }: { msg: XanoSmsMessage }) {
  const outbound = msg.direction === "outbound";
  const failed = msg.status === "failed" || msg.status === "undelivered";
  const fromLabel = formatUSPhone(msg.from_number) || msg.from_number;
  return (
    <Message align={outbound ? "end" : "start"}>
      <MessageContent>
        <MessageHeader>
          {/* One line, always: the label never wraps, and the from
              value truncates (it's usually a phone, but legacy rows
              can carry a long Twilio Messaging Service SID). */}
          <span className="shrink-0 whitespace-nowrap">Text message</span>
          {fromLabel ? (
            <span
              className="min-w-0 truncate whitespace-nowrap text-muted-foreground"
              title={fromLabel}
            >
              &nbsp;· from{" "}
              <span className="tabular-nums">{fromLabel}</span>
            </span>
          ) : null}
        </MessageHeader>
        <Bubble
          variant={
            outbound ? (failed ? "destructive" : "default") : "secondary"
          }
        >
          <BubbleContent className="whitespace-pre-wrap">
            {msg.body}
          </BubbleContent>
        </Bubble>
        <MessageFooter title={new Date(msg.created_at).toLocaleString()}>
          {outbound ? (
            <span className={cn(failed && "text-destructive")}>
              {SMS_STATUS_LABEL[msg.status] ?? msg.status}
            </span>
          ) : (
            <span>Received</span>
          )}
          <span>&nbsp;·&nbsp;{timeLabel(msg.created_at)}</span>
        </MessageFooter>
      </MessageContent>
    </Message>
  );
}

/** Day separator label — "Today" / "Yesterday" / "Jul 21". Same
 *  vocabulary as the SMS thread and activity stream. */
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

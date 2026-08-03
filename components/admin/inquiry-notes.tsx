"use client";

import { useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { toast } from "sonner";
import {
  Pin,
  PinOff,
  Pencil,
  Trash2,
  Loader2,
  MessageSquareText,
} from "lucide-react";
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
import { formatNoteTimestamp } from "@/lib/format-note-time";
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
 * Note categories. `short` is the abbreviated label for the
 * selectable-pill picker in the composer (rendered as a horizontal
 * row, so we want concise text); `label` is the long form rendered
 * inside the timeline metadata strip ("Phone call · 2:14pm").
 */
const CATEGORY_OPTIONS: { value: string; label: string; short: string }[] = [
  { value: "phone", label: "Phone call", short: "Call" },
  { value: "email", label: "Email", short: "Email" },
  { value: "in-person", label: "In-person", short: "Visit" },
  { value: "sms", label: "Text message", short: "SMS" },
  { value: "other", label: "Other", short: "Other" },
];

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
 * Renders the category-pill row used by both composer variants
 * (panel and standalone). Behaves like a `radiogroup` — exactly
 * one selection at a time, click to switch.
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
      className="flex flex-wrap gap-1.5"
      role="radiogroup"
      aria-label="Note category"
    >
      {CATEGORY_OPTIONS.map((c) => {
        const selected = value === c.value;
        return (
          <button
            key={c.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(c.value)}
            title={c.label}
            className={cn(
              "rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
              selected
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-white text-muted-foreground hover:border-foreground/40 hover:text-foreground"
            )}
          >
            {c.short}
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
  // Chronological stream (newest first): un-pinned notes + every text
  // on this lead's thread, interleaved by timestamp.
  const rest: TimelineEntry[] = [
    ...notes
      .filter((n) => !n.is_pinned)
      .map((note) => ({ kind: "note" as const, note })),
    ...smsMessages.map((msg) => ({ kind: "sms" as const, msg })),
  ].sort((a, b) => entryTs(b) - entryTs(a));

  const [body, setBody] = useState("");
  const [category, setCategory] = useState("phone");
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

  // Shared timeline body — same JSX for both layout variants. Wrapped
  // in different containers below depending on variant.
  const timeline = (
    <>
      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading notes…</p>
      ) : notes.length === 0 && smsMessages.length === 0 ? (
        <p className="text-xs italic text-muted-foreground">
          No communications logged yet. The first note here is yours.
        </p>
      ) : (
        <>
          {pinned.length > 0 ? (
            <div className="space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Pinned
              </p>
              {pinned.map((n) => (
                <NoteRow
                  key={n.id}
                  note={n}
                  onTogglePin={togglePin}
                  onDelete={(id) => setPendingDelete(id)}
                  onEdited={() => mutate()}
                />
              ))}
            </div>
          ) : null}

          {rest.length > 0 ? (
            <div className="space-y-2">
              {pinned.length > 0 ? (
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Recent
                </p>
              ) : null}
              {rest.map((entry) =>
                entry.kind === "note" ? (
                  <NoteRow
                    key={`note-${entry.note.id}`}
                    note={entry.note}
                    onTogglePin={togglePin}
                    onDelete={(id) => setPendingDelete(id)}
                    onEdited={() => mutate()}
                  />
                ) : (
                  <SmsRow key={`sms-${entry.msg.id}`} msg={entry.msg} />
                )
              )}
            </div>
          ) : null}
        </>
      )}
    </>
  );

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
    // List-only — caller is expected to render a sibling
    // `<InquiryNoteComposer>` somewhere (typically docked to the
    // bottom of a Sheet). We still need the delete dialog to live
    // somewhere in the React tree, so it ships with the timeline.
    return (
      <>
        <div className="space-y-2">{timeline}</div>
        {deleteDialog}
      </>
    );
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2 max-h-[40vh] overflow-y-auto overscroll-contain pr-1">
        {timeline}
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
  const [category, setCategory] = useState("phone");
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

function NoteRow({
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
    <div
      className={cn(
        "rounded-md border p-3 bg-white",
        note.is_pinned && "border-amber-200 bg-amber-50/40"
      )}
    >
      {/* Top: author (left) + actions (right). Metadata strip
          (category · timestamp · edited) lives at the bottom of
          the card so the body stays the focal point — same shape
          as `family-notes-sheet`'s NoteRow. */}
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-foreground min-w-0 truncate">
          {note.author_name}
        </p>
        <div className="flex items-center gap-0.5 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => onTogglePin(note)}
            title={note.is_pinned ? "Unpin" : "Pin to top"}
          >
            {note.is_pinned ? (
              <PinOff className="size-3.5" />
            ) : (
              <Pin className="size-3.5" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => setEditing((e) => !e)}
            title="Edit"
          >
            <Pencil className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-red-600"
            onClick={() => onDelete(note.id)}
            title="Delete"
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>
      {editing ? (
        <div className="mt-2 space-y-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
          />
          <div className="flex items-center gap-2 justify-end">
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
            <Button size="sm" disabled={saving} onClick={saveEdit}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      ) : (
        <p className="mt-1.5 text-sm whitespace-pre-wrap">{note.body}</p>
      )}
      {/* Footer metadata — category · day · time · Edited. Tiny so
          it sits as a chronology stamp at the bottom-edge of the
          card without competing with the body. Title-cased rather
          than all-caps tracking-wider — same shape as the
          family-side note row. Hidden during edit mode (Save/Cancel
          takes the visual slot). */}
      {!editing ? (
        <p className="mt-2 text-[11px] text-muted-foreground/80">
          {note.category ? (
            <span>{formatCategory(note.category)}</span>
          ) : null}
          {note.category ? <span> · </span> : null}
          <span>{formatNoteTimestamp(note.created_at)}</span>
          {note.last_edited ? <span> · Edited</span> : null}
        </p>
      ) : null}
    </div>
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
 * Read-only SMS card in the comms timeline. Distinct from a note row —
 * icon + direction header, no pin/edit/delete (the message log is a
 * record of what was actually sent/received, not editable prose).
 */
function SmsRow({ msg }: { msg: XanoSmsMessage }) {
  const outbound = msg.direction === "outbound";
  const failed = msg.status === "failed" || msg.status === "undelivered";
  return (
    <div className="rounded-md border border-sky-100 bg-sky-50/40 p-3">
      <p className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-foreground">
        <MessageSquareText className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">
          {outbound
            ? msg.author_name || "SailFuture"
            : "Reply from parent"}
        </span>
      </p>
      <p className="mt-1.5 whitespace-pre-wrap text-sm">{msg.body}</p>
      <p className="mt-2 text-[11px] text-muted-foreground/80">
        <span>Text message</span>
        {outbound ? (
          <span className={cn(failed && "text-red-600")}>
            {" · "}
            {SMS_STATUS_LABEL[msg.status] ?? msg.status}
          </span>
        ) : null}
        <span> · {formatNoteTimestamp(msg.created_at)}</span>
      </p>
    </div>
  );
}

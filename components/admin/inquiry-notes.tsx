"use client";

import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Pin, PinOff, Pencil, Trash2, Loader2 } from "lucide-react";
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
import type { XanoAdminNote } from "@/lib/xano";

const fetcher = async (url: string): Promise<XanoAdminNote[]> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load notes (${res.status})`);
  return res.json();
};

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
  inquiryId: number;
  /** Optional callback fired after a successful note add — the parent
   *  Sheet uses this to revalidate the inquiry list so `last_reach_out`
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
 * Inquiry-scoped notes log. Backed by the same `registration_admin_notes`
 * Xano table the family-side comms log uses; rows are distinguished by
 * which foreign key is set (`registration_inquiry_id` vs
 * `registration_families_id`) so the two timelines never bleed.
 *
 * Pinned notes float to the top, then chronological newest first —
 * same ordering the family notes drawer uses, so admins see the same
 * timeline shape on both surfaces.
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
  onNoteAdded,
  variant = "panel",
}: Props) {
  const swrKey = `/api/admin/notes?inquiryId=${inquiryId}`;
  const { data, isLoading, mutate } = useSWR<XanoAdminNote[]>(swrKey, fetcher, {
    revalidateOnFocus: false,
  });

  const notes = data ?? [];
  const pinned = notes.filter((n) => n.is_pinned);
  const rest = notes
    .filter((n) => !n.is_pinned)
    .slice()
    .sort((a, b) => b.created_at - a.created_at);

  const [body, setBody] = useState("");
  const [category, setCategory] = useState("phone");
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);

  async function submitNote() {
    if (!body.trim() || saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          registration_inquiry_id: inquiryId,
          body: body.trim(),
          category,
          is_pinned: false,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? `Save failed (${res.status})`);
      }
      setBody("");
      await mutate();
      onNoteAdded?.();
      toast.success("Note added.");
    } catch (err) {
      console.error("Failed to add note:", err);
      toast.error(err instanceof Error ? err.message : "Failed to add note.");
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
      ) : notes.length === 0 ? (
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
              {rest.map((n) => (
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
        placeholder="Phone call summary, follow-up needed, parent context — write what the next admin should know."
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
            Saving
          </>
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
            The note will be removed from the inquiry record. This
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
  onNoteAdded,
}: {
  inquiryId: number;
  onNoteAdded?: () => void;
}) {
  const swrKey = `/api/admin/notes?inquiryId=${inquiryId}`;
  const { mutate } = useSWR<XanoAdminNote[]>(swrKey, fetcher, {
    revalidateOnFocus: false,
  });

  const [body, setBody] = useState("");
  const [category, setCategory] = useState("phone");
  const [saving, setSaving] = useState(false);

  async function submitNote() {
    if (!body.trim() || saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          registration_inquiry_id: inquiryId,
          body: body.trim(),
          category,
          is_pinned: false,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? `Save failed (${res.status})`);
      }
      setBody("");
      await mutate();
      onNoteAdded?.();
      toast.success("Note added.");
    } catch (err) {
      console.error("Failed to add note:", err);
      toast.error(err instanceof Error ? err.message : "Failed to add note.");
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
        placeholder="Phone call summary, follow-up needed, parent context — write what the next admin should know."
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
            Saving
          </>
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

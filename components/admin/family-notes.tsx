"use client";

import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Pin, PinOff, Pencil, Trash2, Loader2 } from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import type { XanoAdminNote } from "@/lib/xano";

const fetcher = async (url: string): Promise<XanoAdminNote[]> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load notes (${res.status})`);
  return res.json();
};

const CATEGORY_OPTIONS: { value: string; label: string }[] = [
  { value: "phone", label: "Phone call" },
  { value: "email", label: "Email" },
  { value: "in-person", label: "In-person" },
  { value: "sms", label: "Text message" },
  { value: "other", label: "Other" },
];

interface Props {
  familyId: number;
  /** When set, the composer pre-fills the student FK so the note is tied
   *  to one student in addition to the family. Useful when the note is
   *  written from a per-student admin page. */
  defaultStudentId?: number | null;
  /** Optional year FK — same idea, scopes the note to a year. */
  defaultYearId?: number | null;
}

/**
 * Comms log pane for a family. Shows pinned notes first, then chronological.
 * Inline composer at the top. Edit/delete inline; both routes are gated
 * server-side by the admin auth check.
 */
export function FamilyNotes({ familyId, defaultStudentId, defaultYearId }: Props) {
  const swrKey = `/api/admin/notes?familyId=${familyId}`;
  const { data, isLoading, mutate } = useSWR<XanoAdminNote[]>(swrKey, fetcher, {
    revalidateOnFocus: false,
  });

  const notes = data ?? [];
  const pinned = notes.filter((n) => n.is_pinned);
  const rest = notes.filter((n) => !n.is_pinned);

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
          registration_families_id: familyId,
          registration_students_id: defaultStudentId ?? null,
          registration_school_years_id: defaultYearId ?? null,
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
      toast.success("Note added.");
    } catch (err) {
      console.error("Failed to add note:", err);
      toast.error(err instanceof Error ? err.message : "Failed to add note.");
    } finally {
      setSaving(false);
    }
  }

  async function togglePin(note: XanoAdminNote) {
    // Optimistic: flip immediately so the note jumps to/from the pinned
    // section without waiting on the round-trip.
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
      await mutate(); // revert
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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Notes &amp; Communication Log</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Composer */}
        <div className="space-y-2">
          <Textarea
            placeholder="Phone call summary, follow-up needed, parent context — write what the next admin should know."
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
          />
          <div className="flex items-center gap-2">
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="w-40 bg-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORY_OPTIONS.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              onClick={submitNote}
              disabled={saving || !body.trim()}
              className="ml-auto"
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
        </div>

        {isLoading ? (
          <p className="text-xs text-muted-foreground">Loading notes…</p>
        ) : notes.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No notes yet. The first note here is yours.
          </p>
        ) : (
          <div className="space-y-3">
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
          </div>
        )}
      </CardContent>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this note?</AlertDialogTitle>
            <AlertDialogDescription>
              The note will be removed from the family record. This can&rsquo;t
              be undone.
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
    </Card>
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
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{note.author_name}</span>
          {note.category ? <span> · {formatCategory(note.category)}</span> : null}
          <span> · {new Date(note.created_at).toLocaleString()}</span>
          {note.last_edited ? <span> · edited</span> : null}
        </div>
        <div className="flex items-center gap-1 shrink-0">
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
    </div>
  );
}

function formatCategory(c: string): string {
  const found = CATEGORY_OPTIONS.find((o) => o.value === c);
  return found?.label ?? c;
}

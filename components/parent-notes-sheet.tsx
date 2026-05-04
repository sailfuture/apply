"use client";

import { useState } from "react";
import useSWR from "swr";
import { MessageSquare } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatNoteTimestamp } from "@/lib/format-note-time";
import { cn } from "@/lib/utils";
import type { XanoAdminNote } from "@/lib/xano";

const fetcher = async (url: string): Promise<XanoAdminNote[]> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load notes (${res.status})`);
  return res.json();
};

const CATEGORY_LABEL: Record<string, string> = {
  phone: "Phone call",
  email: "Email",
  "in-person": "In-person",
  sms: "Text message",
  other: "Other",
};

interface Props {
  /**
   * Visual treatment.
   *
   *  - `"row"` — renders as a row inside the application side-nav's
   *    Support section (matches the Email / Call / Help Center
   *    rows above it). The default.
   *  - `"card"` — standalone bordered card; useful for surfaces
   *    that don't have a side-nav slot (overview headers, etc.).
   */
  variant?: "row" | "card";
}

/**
 * Read-only parent-facing notes drawer. Trigger only renders when
 * admin has shared at least one note with the parent
 * (`is_shared_with_parent === true`). The sheet shows a simple
 * timeline — no edit / delete / pin affordances since this is a
 * one-way channel from admin → parent.
 *
 * Notes flow through the same `registration_admin_notes` Xano table
 * the admin comms log writes to; admin checks the eye icon on a
 * note to share it, and it appears here on the parent's next
 * fetch. SWR auto-revalidates on focus so re-opening a parent tab
 * picks up newly-shared notes without a manual refresh.
 */
export function ParentNotesSheet({ variant = "row" }: Props) {
  const [open, setOpen] = useState(false);
  const { data } = useSWR<XanoAdminNote[]>("/api/parent/notes", fetcher, {
    revalidateOnFocus: true,
  });

  const notes = data ?? [];

  // Only mount the trigger when there's at least one shared note —
  // otherwise the affordance is just clutter. Initial undefined
  // (loading) also short-circuits so the UI doesn't briefly flash a
  // visible button before the fetch settles.
  if (notes.length === 0) return null;

  return (
    <>
      {variant === "row" ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex w-full items-center justify-between gap-2.5 rounded-lg px-2 py-2 text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
        >
          <span className="inline-flex items-center gap-2.5 min-w-0">
            {/* Colored indicator dot signals "you have something
                from admissions" without needing to read the count.
                Emerald to match the rest of the green "shared with
                you" tones on the parent app. */}
            <span className="relative inline-flex shrink-0">
              <MessageSquare className="size-4" />
              <span className="absolute -top-1 -right-1 size-2 rounded-full bg-emerald-500 ring-2 ring-background" />
            </span>
            <span className="truncate">Notes</span>
          </span>
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium tabular-nums shrink-0">
            {notes.length}
          </span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-2 rounded-md border border-border bg-white px-3 py-1.5 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted"
        >
          <span className="relative inline-flex">
            <MessageSquare className="size-4" />
            <span className="absolute -top-1 -right-1 size-2 rounded-full bg-emerald-500 ring-2 ring-background" />
          </span>
          Notes
          <span className="ml-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums">
            {notes.length}
          </span>
        </button>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-md flex flex-col p-0 gap-0"
        >
          <SheetHeader className="border-b px-6 py-4">
            <SheetTitle>Notes</SheetTitle>
            <SheetDescription>
              Updates and reminders from the SailFuture Academy
              admissions team. Each note tells you which part of your
              application it&rsquo;s about.
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            <GroupedNotes notes={notes} />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

/**
 * Bucket the parent-visible notes into Communication (no section)
 * and Application Edits (with section, sub-grouped per surface)
 * so the parent can tell which part of the application each note
 * is about. Mirrors the admin-side family-wide drawer's grouping
 * so the structure feels consistent across both views.
 */
function GroupedNotes({ notes }: { notes: XanoAdminNote[] }) {
  const communication = notes.filter((n) => !n.section);
  const sectioned = new Map<string, XanoAdminNote[]>();
  for (const n of notes) {
    if (!n.section) continue;
    const arr = sectioned.get(n.section) ?? [];
    arr.push(n);
    sectioned.set(n.section, arr);
  }

  return (
    <>
      {communication.length > 0 ? (
        <section className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-1">
            Communication
          </p>
          {communication.map((n) => (
            <ParentNoteRow key={n.id} note={n} />
          ))}
        </section>
      ) : null}

      {sectioned.size > 0 ? (
        <section className="space-y-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-1">
            Application updates
          </p>
          {Array.from(sectioned.entries()).map(([sectionKey, sectionNotes]) => (
            <div key={sectionKey} className="space-y-2">
              <p className="text-[11px] font-medium text-muted-foreground/80 px-1">
                {parentSectionDisplayName(sectionKey)}
              </p>
              {sectionNotes.map((n) => (
                <ParentNoteRow key={n.id} note={n} />
              ))}
            </div>
          ))}
        </section>
      ) : null}
    </>
  );
}

/**
 * Parent-facing labels for the section keys admin uses internally.
 * Friendlier wording than the admin variant — the parent doesn't
 * need to know about "Initial Testing" as a phrase, "Testing"
 * reads cleaner on this side.
 */
function parentSectionDisplayName(section: string): string {
  switch (section) {
    case "section-family":
      return "Parents / Guardians";
    case "section-students":
      return "Student details";
    case "section-financial-aid":
      return "Financial aid";
    case "section-testing":
      return "Testing";
    default: {
      const colon = section.indexOf(":");
      if (colon > 0) {
        const prefix = section.slice(0, colon).replace(/_/g, " ");
        return `${prefix.charAt(0).toUpperCase()}${prefix.slice(1)}`;
      }
      return section;
    }
  }
}

function ParentNoteRow({ note }: { note: XanoAdminNote }) {
  const category = note.category
    ? CATEGORY_LABEL[note.category] ?? note.category
    : null;
  return (
    <div className={cn("rounded-md border p-3 bg-white space-y-1.5")}>
      <p className="text-sm font-medium text-foreground">
        {note.author_name || "Admissions"}
      </p>
      <p className="text-sm whitespace-pre-wrap">{note.body}</p>
      <p className="text-[11px] text-muted-foreground/80">
        {category ? <span>{category} · </span> : null}
        <span>{formatNoteTimestamp(note.created_at)}</span>
        {note.last_edited ? <span> · Edited</span> : null}
      </p>
    </div>
  );
}

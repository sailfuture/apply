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
  MessageSquare,
  Eye,
  EyeOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
// Category selector is now selectable pills, not a dropdown — see
// `CATEGORY_OPTIONS.short` below. The shadcn `Select` import is no
// longer needed by the composer; left removed to keep the bundle tidy.
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

interface Props {
  familyId: number;
  defaultStudentId?: number | null;
  defaultYearId?: number | null;
  /**
   * Trigger style.
   *
   *   - `"floating"` — fixed bottom-right pill, the original chat-widget
   *     placement. Used on surfaces that don't have a header to dock
   *     onto.
   *   - `"inline"` — renders as a header-inline outline `<Button>` so
   *     the trigger sits beside other page-action buttons (Approve,
   *     Return Application, etc.). White background, neutral text.
   *
   * Defaults to `"inline"` because the family detail page — the only
   * caller today — wants the header docked variant.
   */
  variant?: "floating" | "inline";
  /**
   * Optional section key. When set, the drawer scopes its timeline
   * to notes whose `section` column matches this string, and any
   * note added through this drawer is written with the same key.
   * Use it to wire a per-surface notes drawer (e.g. one
   * contributing member's review thread) on top of the same
   * underlying `registration_admin_notes` table — the unified comms
   * log doesn't fragment, but each surface gets a focused view.
   */
  section?: string;
  /**
   * Optional title override. Defaults to "Notes & Communication
   * Log" — pass a more specific label when the drawer is scoped to
   * a section ("Notes for Larry Thompson", etc.).
   */
  title?: string;
  /**
   * Trigger button label override. Defaults to "Notes". Section-
   * scoped drawers usually want a shorter inline label like just
   * the icon or "Add note".
   */
  triggerLabel?: string;
  /**
   * Lifecycle phase scope. When set, the drawer pre-filters its
   * timeline to a single phase via a server-side query and stamps
   * the corresponding phase FK on every note it composes — so notes
   * written from that surface stay tied to the surface that wrote
   * them.
   *
   *   - `"registration"` — uses the
   *     `registration_admin_notes_by_registration` Xano query
   *     (filters to notes with this family/year's
   *     `registration_student_registration_progress_id`); writes
   *     stamp the same FK so the round-trip closes
   *   - `"application"` — inverse of registration: strips out any
   *     note that's tagged for the registration phase. Used on the
   *     apply-flow family detail page so registration comms don't
   *     leak into the application timeline. Writes don't stamp a
   *     phase FK (apply-phase notes are identified by NOT having
   *     the registration FK).
   *   - `undefined` (default) — drawer reads ALL family notes and
   *     applies the client-side phase pill filter; writes don't
   *     stamp a phase FK
   *
   * Re-enrollment notes write the same `application` FK as new-applicant
   * notes (the unified apply pipeline doesn't distinguish), so they
   * fall out of this filter naturally — `phase=application` catches
   * both.
   *
   * Requires `defaultYearId` to be set when phase=registration —
   * the server endpoint takes both family and year as inputs.
   * `phase=application` doesn't strictly require yearId but it's
   * passed along when present for consistency.
   */
  phase?: "registration" | "application";
  /**
   * When true, the trigger button is disabled — the drawer can't
   * be opened. Used by `SectionShell` on the family detail pages
   * to lock down the Notes affordance once a section has been
   * verified by admin: a verified section is the "settled" state,
   * so we don't want stray notes (or accidental clicks on the
   * trigger) muddying the audit trail. Admin can still unverify
   * the section to re-enable the trigger.
   */
  disabled?: boolean;
}

/**
 * Sheet variant of `FamilyNotes` — pinned trigger button at the
 * bottom-right of the viewport opens a right-side drawer with the
 * comms log inside. Layout is intentionally inverted vs. the Card
 * version: the composer lives at the bottom of the sheet (so it's
 * always reachable while scrolling through history), and the notes
 * list scrolls between the header and the composer.
 *
 * Pinned notes float to the top of the list, then chronological
 * (most recent first). Edit/delete inline with the same affordances
 * the Card version uses.
 */
export function FamilyNotesSheet({
  familyId,
  defaultStudentId,
  defaultYearId,
  variant = "inline",
  section,
  title,
  triggerLabel,
  phase,
  disabled,
}: Props) {
  const [open, setOpen] = useState(false);
  // SWR key carries phase but NOT section — section filtering is
  // applied client-side below so every section-scoped drawer on the
  // page shares one underlying fetch (one family detail page can
  // mount 5+ section drawers, and they all needed the same
  // family-year payload). Two phase modes hit different server-side
  // filters:
  //   - registration → the dedicated
  //     `registration_admin_notes_by_registration` query (only
  //     notes with the registration progress FK set)
  //   - application → the standard family GET, server-side filtered
  //     to drop notes WITH the registration FK set (so apply
  //     drawers don't show registration comms)
  // Phase-scoped cache keys stay distinct so flipping between an
  // apply-flow detail page and a registration detail page doesn't
  // serve the wrong cache.
  const phaseQuery =
    phase === "registration" && defaultYearId
      ? `&phase=registration&yearId=${defaultYearId}`
      : phase === "application"
        ? `&phase=application${defaultYearId ? `&yearId=${defaultYearId}` : ""}`
        : "";
  const swrKey = `/api/admin/notes?familyId=${familyId}${phaseQuery}`;
  const { data, isLoading, mutate } = useSWR<XanoAdminNote[]>(swrKey, fetcher, {
    revalidateOnFocus: false,
  });
  // SWR caches by URL, so the family-wide drawer
  // (`/api/admin/notes?familyId=X`) and each section-scoped drawer
  // (`...&section=foo`) live in separate cache slots. Mutating one
  // doesn't refresh the other — without this matcher, a note added
  // inside a per-section drawer wouldn't appear in the family-wide
  // timeline (and vice versa) until the page reloads. Use the
  // global mutate to invalidate every notes cache for this family
  // whenever ANY note write happens.
  const { mutate: globalMutate } = useSWRConfig();
  const familyKeyPrefix = `/api/admin/notes?familyId=${familyId}`;
  const revalidateAll = () =>
    globalMutate(
      (key) => typeof key === "string" && key.startsWith(familyKeyPrefix)
    );

  // Section scoping moved client-side so every section-scoped drawer
  // on the page shares the same underlying SWR fetch. The shared
  // payload already arrives filtered by phase server-side; here we
  // narrow to the section the drawer instance was mounted with.
  const allNotes = section
    ? (data ?? []).filter((n) => n.section === section)
    : (data ?? []);
  // Phase filter state lives up here (rather than next to the
  // composer-related state below) because the filter feeds the
  // `notes` derivation that drives every downstream group + the
  // empty-state branches.
  const [phaseFilter, setPhaseFilter] = useState<NotePhase | "all">("all");
  // Filtered notes for this drawer. Section-scoped drawers and
  // phase-scoped drawers (`phase="registration"`, etc.) ignore the
  // client-side phase pills — the whole list is already pre-filtered
  // (section above, phase server-side), so adding another axis
  // would just hide notes without giving admin a way back.
  const notes =
    section || phase || phaseFilter === "all"
      ? allNotes
      : allNotes.filter((n) => derivePhase(n) === phaseFilter);
  const pinned = notes.filter((n) => n.is_pinned);
  // Sort the unpinned list most-recent first so a fresh note lands
  // at the top of the scroll region the moment it saves.
  const rest = notes
    .filter((n) => !n.is_pinned)
    .slice()
    .sort((a, b) => b.created_at - a.created_at);

  // For the family-wide drawer (no `section` prop), split unpinned
  // notes into two top-level groups:
  //   - Communication: notes with no section (general comms log)
  //   - Application Edits: notes attached to a specific application
  //     surface (Parents, Students, Financial Aid, Testing, or a
  //     contributing-member thread). Sub-grouped by the section
  //     name so admin sees a per-surface mini-timeline.
  // Section-scoped drawers skip the grouping (the whole list is one
  // section already).
  const grouped = !section;
  const restCommunication = grouped
    ? rest.filter((n) => !n.section)
    : [];
  const restApplicationEditsBySection = (() => {
    if (!grouped) return new Map<string, XanoAdminNote[]>();
    const map = new Map<string, XanoAdminNote[]>();
    for (const n of rest) {
      if (!n.section) continue;
      const arr = map.get(n.section) ?? [];
      arr.push(n);
      map.set(n.section, arr);
    }
    return map;
  })();

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
          // Pass the phase tag so the server stamps the matching FK
          // (`registration_student_registration_progress_id` for
          // registration, etc.) — keeps round-trip cache reads
          // pointed at the same scoped query that fetched this list.
          phase: phase ?? null,
          body: body.trim(),
          category,
          is_pinned: false,
          // Section-scoped drawer: write the same key so the note
          // surfaces in this drawer's filtered view next time it
          // loads. Falls through to null on the unscoped family
          // drawer.
          section: section ?? null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? `Save failed (${res.status})`);
      }
      setBody("");
      await revalidateAll();
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
      await revalidateAll();
    } catch (err) {
      console.error("Failed to toggle pin:", err);
      toast.error("Couldn't update pin.");
      await revalidateAll();
    }
  }

  /**
   * Flip a note's `is_shared_with_parent` flag. Optimistic mutate so
   * the eye icon's filled/outline state reflects the new value
   * immediately; reverts on failure by re-fetching.
   */
  async function toggleShared(note: XanoAdminNote) {
    const next = !note.is_shared_with_parent;
    await mutate(
      (curr) =>
        (curr ?? []).map((n) =>
          n.id === note.id ? { ...n, is_shared_with_parent: next } : n
        ),
      { revalidate: false }
    );
    try {
      const res = await fetch(`/api/admin/notes/${note.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_shared_with_parent: next }),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      await revalidateAll();
      toast.success(next ? "Shared with parent." : "Hidden from parent.");
    } catch (err) {
      console.error("Failed to toggle parent visibility:", err);
      toast.error("Couldn't update visibility.");
      await revalidateAll();
    }
  }

  async function confirmDelete() {
    if (pendingDelete === null) return;
    const id = pendingDelete;
    setPendingDelete(null);
    try {
      const res = await fetch(`/api/admin/notes/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`Delete failed (${res.status})`);
      await revalidateAll();
      toast.success("Note removed.");
    } catch (err) {
      console.error("Failed to delete note:", err);
      toast.error("Couldn't delete note.");
    }
  }

  // Trigger badge always shows the unfiltered count — the filter is a
  // viewport, not a delete. Admin should see "12 notes exist" even
  // while looking at "Apply" alone.
  const totalNotes = allNotes.length;

  return (
    <>
      {/* Trigger — two presentations from a single component.
          Floating mirrors a chat widget; inline matches the
          page-header action buttons (Approve / Return Application)
          so it docks alongside them. The counter pill on both
          variants shows total notes at a glance so admin knows
          there's history without opening the sheet. */}
      {variant === "floating" ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={disabled}
          className="fixed bottom-6 right-6 z-40 inline-flex items-center gap-2 rounded-full border bg-foreground px-4 py-2.5 text-sm font-medium text-background shadow-lg transition-colors hover:bg-foreground/90 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-foreground"
          aria-label="Open notes & communication log"
        >
          <MessageSquare className="size-4" />
          {triggerLabel ?? "Notes"}
          {totalNotes > 0 ? (
            <span className="ml-1 rounded-full bg-background/20 px-1.5 py-0.5 text-[10px] tabular-nums">
              {totalNotes}
            </span>
          ) : null}
        </button>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setOpen(true)}
          disabled={disabled}
          className="bg-white"
          aria-label="Open notes & communication log"
        >
          <MessageSquare className="size-4 mr-1.5" />
          {triggerLabel ?? "Notes"}
          {totalNotes > 0 ? (
            <span className="ml-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
              {totalNotes}
            </span>
          ) : null}
        </Button>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-md flex flex-col p-0 gap-0"
        >
          <SheetHeader className="border-b px-6 py-4">
            <SheetTitle>{title ?? "Notes & Communication Log"}</SheetTitle>
          </SheetHeader>

          {/* Phase filter — only on the family-wide drawer. Lets
              admin narrow the timeline to a specific lifecycle phase
              (apply / registration) or the general comms log without
              leaving the sheet. Pills mirror the composer's
              category-pill treatment so the two filter rows feel
              of-a-piece. Re-enrollment notes roll into the Apply pill
              now that the apply flow is unified across both. */}
          {!section && !phase ? (
            <div className="border-b bg-muted/10 px-4 py-2.5">
              <div
                className="flex flex-wrap gap-1.5"
                role="radiogroup"
                aria-label="Filter notes by phase"
              >
                {PHASE_FILTER_OPTIONS.map((p) => {
                  const selected = phaseFilter === p.value;
                  // Visible badge per phase — cheap "how many in
                  // this bucket?" cue without computing on every
                  // render path. `all` shows the unfiltered total.
                  const count =
                    p.value === "all"
                      ? allNotes.length
                      : allNotes.filter((n) => derivePhase(n) === p.value).length;
                  return (
                    <button
                      key={p.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setPhaseFilter(p.value)}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
                        selected
                          ? "border-foreground bg-foreground text-background"
                          : "border-border bg-white text-muted-foreground hover:border-foreground/40 hover:text-foreground"
                      )}
                    >
                      {p.label}
                      <span
                        className={cn(
                          "rounded-full px-1 text-[10px] tabular-nums",
                          selected
                            ? "bg-background/20"
                            : "bg-muted text-muted-foreground"
                        )}
                      >
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {/* Scrollable list — pinned first, then chronological newest
              first. Takes all available vertical space between the
              header and composer. */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
            {isLoading ? (
              <p className="text-xs text-muted-foreground px-2">
                Loading notes…
              </p>
            ) : notes.length === 0 ? (
              // Distinguish "filter excluded everything" from "no
              // notes exist at all" — the latter wants the
              // first-time prompt; the former wants a hint that the
              // filter is the reason.
              allNotes.length > 0 && phaseFilter !== "all" ? (
                <p className="text-xs text-muted-foreground px-2">
                  No notes in this phase yet. Switch to All to see
                  every note for this family.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground px-2">
                  No notes yet. The first note here is yours.
                </p>
              )
            ) : (
              <>
                {pinned.length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-2">
                      Pinned
                    </p>
                    {pinned.map((n) => (
                      <NoteRow
                        key={n.id}
                        note={n}
                        onTogglePin={togglePin}
                        onToggleShared={toggleShared}
                        onDelete={(id) => setPendingDelete(id)}
                        onEdited={revalidateAll}
                      />
                    ))}
                  </div>
                ) : null}

                {grouped ? (
                  <>
                    {/* Communication — notes with no `section` set.
                        These are the general comms log entries (the
                        bottom-bar composer in the family-wide drawer
                        writes here). Always titled "Communication" —
                        matches the user's mental model that the
                        unscoped feed is "what we talked about with
                        the family." */}
                    {restCommunication.length > 0 ? (
                      <div className="space-y-2">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-2">
                          Communication
                        </p>
                        {restCommunication.map((n) => (
                          <NoteRow
                            key={n.id}
                            note={n}
                            onTogglePin={togglePin}
                            onToggleShared={toggleShared}
                            onDelete={(id) => setPendingDelete(id)}
                            onEdited={revalidateAll}
                          />
                        ))}
                      </div>
                    ) : null}

                    {/* Application Edits — sectioned notes. Single
                        umbrella header, per-section sub-headers
                        underneath. Sub-headers use the friendly
                        display name derived from the section key
                        (e.g. `section-financial-aid` →
                        "Financial Aid"). */}
                    {restApplicationEditsBySection.size > 0 ? (
                      <div className="space-y-3">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-2">
                          Application Edits
                        </p>
                        {Array.from(
                          restApplicationEditsBySection.entries()
                        ).map(([sectionKey, sectionNotes]) => (
                          <div key={sectionKey} className="space-y-2">
                            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/80 px-2">
                              {sectionDisplayName(sectionKey)}
                            </p>
                            {sectionNotes.map((n) => (
                              <NoteRow
                                key={n.id}
                                note={n}
                                onTogglePin={togglePin}
                                onToggleShared={toggleShared}
                                onDelete={(id) => setPendingDelete(id)}
                                onEdited={revalidateAll}
                              />
                            ))}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </>
                ) : rest.length > 0 ? (
                  // Section-scoped drawer — flat list, since the whole
                  // timeline is already one section.
                  <div className="space-y-2">
                    {pinned.length > 0 ? (
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-2">
                        Recent
                      </p>
                    ) : null}
                    {rest.map((n) => (
                      <NoteRow
                        key={n.id}
                        note={n}
                        onTogglePin={togglePin}
                        onToggleShared={toggleShared}
                        onDelete={(id) => setPendingDelete(id)}
                        onEdited={revalidateAll}
                      />
                    ))}
                  </div>
                ) : null}
              </>
            )}
          </div>

          {/* Composer — pinned at the bottom of the sheet so adding a
              note doesn't require scrolling all the way back up.
              Layout (top → bottom): category pills, textarea,
              full-width Add note button. Pills sit above the
              textarea so admin picks the channel before they start
              writing, which matches the natural mental flow ("I
              just had a call → write what we discussed"). */}
          <div className="border-t bg-muted/20 px-4 py-4 space-y-2">
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Note category">
              {CATEGORY_OPTIONS.map((c) => {
                const selected = category === c.value;
                return (
                  <button
                    key={c.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setCategory(c.value)}
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
        </SheetContent>
      </Sheet>

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
              The note will be removed from the family record. This
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
    </>
  );
}

function NoteRow({
  note,
  onTogglePin,
  onToggleShared,
  onDelete,
  onEdited,
}: {
  note: XanoAdminNote;
  onTogglePin: (n: XanoAdminNote) => void;
  onToggleShared: (n: XanoAdminNote) => void;
  onDelete: (id: number) => void;
  onEdited: () => void;
}) {
  const shared = note.is_shared_with_parent === true;
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
        note.is_pinned && "border-amber-200 bg-amber-50/40",
        shared && !note.is_pinned && "border-emerald-200 bg-emerald-50/30"
      )}
    >
      {/* Top: author name (left) + action buttons (right). The
          metadata strip (category · day · time · edited) moved to
          a small footer at the bottom of the card so the body has
          more room and the chronology hangs at the corner where
          admin's eye lands last.

          Author font size is `text-sm` to match the action-button
          icons (`size-3.5` ≈ 14px) — keeps the top row visually
          balanced rather than the prior 12px text shrinking next to
          14px icons. */}
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-foreground min-w-0 truncate">
          {note.author_name}
          {shared ? (
            <span className="ml-1.5 inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800 align-middle">
              <Eye className="size-2.5" />
              Shared with parent
            </span>
          ) : null}
        </p>
        <div className="flex items-center gap-0.5 shrink-0">
          {/* Parent visibility toggle — eye icon when shared,
              eye-off when internal-only. Click flips
              `is_shared_with_parent` via an optimistic mutate so
              the row re-skins immediately. Green tone (rather than
              the prior sky-blue) aligns with the rest of the
              page's "approved / shared" tones. */}
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "size-7",
              shared && "text-emerald-700 hover:text-emerald-800"
            )}
            onClick={() => onToggleShared(note)}
            title={
              shared
                ? "Hide this note from the parent"
                : "Share this note with the parent"
            }
          >
            {shared ? (
              <Eye className="size-3.5" />
            ) : (
              <EyeOff className="size-3.5" />
            )}
          </Button>
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
      {/* Footer: category · timestamp · edited. Tiny so it's
          glance-able without crowding the body. Title-cased
          (rather than the prior all-caps tracking-wider treatment)
          so it reads as a chronology stamp rather than a section
          heading. Hidden during edit mode (the Save/Cancel row
          claims the visual slot). */}
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

/**
 * Lifecycle phases a note can belong to. Distinct from the
 * `category` field (call / email / sms) — phase is *which stage of
 * the family's journey* the note is logging against, derived from
 * the FK columns Xano writes when admin records a note from a
 * specific surface:
 *
 *   - `apply`        → `registration_family_application_progress_id`
 *                     (covers both new applicants and re-enrollers
 *                      since the apply flow is unified — the progress
 *                      row's `type` field distinguishes them at write
 *                      time but they share this FK)
 *   - `registration` → `registration_student_registration_progress_id`
 *   - `comms`        → none of the above (general communication log
 *                      or legacy notes that pre-date the FK columns)
 *
 * Note: the deprecated `reapply_family_progress_id` column on Xano
 * still exists for backwards compat with legacy rows. We surface
 * those legacy notes under the Apply pill (since re-enrollers are
 * apply-flow now) rather than gating a separate Reapply pill that
 * would only ever show stale data.
 *
 * The filter pills above the timeline let admin narrow the view to
 * one phase without leaving the drawer.
 */
type NotePhase = "comms" | "apply" | "registration";

const PHASE_FILTER_OPTIONS: {
  value: NotePhase | "all";
  label: string;
}[] = [
  { value: "all", label: "All" },
  { value: "comms", label: "Communication" },
  { value: "apply", label: "Apply" },
  { value: "registration", label: "Registration" },
];

/**
 * Map a note to its lifecycle phase. Checks the progress-row foreign
 * keys in priority order; falls through to `comms` for notes that
 * aren't tied to any phase row (general comms log) or for legacy
 * notes that pre-date these columns. The legacy
 * `reapply_family_progress_id` column rolls into `apply` here — the
 * unified flow doesn't surface a separate Reapply pill anymore, and
 * historical reapply notes belong on the same timeline as the
 * applications they relate to.
 */
function derivePhase(note: XanoAdminNote): NotePhase {
  if (
    note.registration_family_application_progress_id != null &&
    note.registration_family_application_progress_id !== 0
  ) {
    return "apply";
  }
  if (
    note.reapply_family_progress_id != null &&
    note.reapply_family_progress_id !== 0
  ) {
    return "apply";
  }
  if (
    note.registration_student_registration_progress_id != null &&
    note.registration_student_registration_progress_id !== 0
  ) {
    return "registration";
  }
  return "comms";
}

/**
 * Translate a `section` key into a human label for the
 * Application-Edits sub-headers. Known section IDs match the
 * scroll-anchor IDs the family detail page uses; everything else
 * falls through (e.g. `contributing_member:42` becomes
 * "Contributing member · 42"). Keep this in sync with the
 * `notes.section` strings the SectionShell call sites pass.
 */
function sectionDisplayName(section: string): string {
  switch (section) {
    case "section-family":
      return "Parents / Guardians";
    case "section-students":
      return "Students";
    case "section-financial-aid":
      return "Financial Aid Application";
    case "section-testing":
      return "Initial Testing";
    default:
      // Conventional `prefix:id` formats render as "Prefix · id" so
      // contributing-member threads (`contributing_member:42`) and
      // any future scoped surfaces stay readable in the grouped view
      // without needing a switch case here.
      const colon = section.indexOf(":");
      if (colon > 0) {
        const prefix = section.slice(0, colon).replace(/_/g, " ");
        const rest = section.slice(colon + 1);
        return `${prefix.charAt(0).toUpperCase()}${prefix.slice(1)} · ${rest}`;
      }
      return section;
  }
}

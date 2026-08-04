"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { formatUSPhone } from "@/lib/phone";
import { formatNoteTimestamp } from "@/lib/format-note-time";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  InquiryNoteComposer,
  InquiryNotes,
  type LeadNoteScope,
} from "@/components/admin/inquiry-notes";
import { StarRating } from "@/components/admin/star-rating";
import { cn } from "@/lib/utils";

/**
 * Shared lead triage controls — the three things admin does to every
 * recruitment lead regardless of where it came from: rate it 1–5 on
 * likelihood of conversion, mark it followed up, and log what was
 * said. All four sources (inquiry / summer camp / liability-waiver
 * visit / TASCO) write through `/api/admin/leads` and
 * `/api/admin/notes`, so the per-source pages and All Leads can't
 * drift on behavior.
 *
 * `onChanged` fires after a successful rating / follow-up write and
 * after a note is added (the note POST stamps `last_reach_out`
 * server-side), so the host list can revalidate.
 */
export function LeadTriageControls({
  scope,
  rating,
  isFollowedUp,
  lastReachOut,
  onChanged,
  className,
}: {
  scope: LeadNoteScope;
  rating: number;
  isFollowedUp: boolean;
  /** Server-stamped timestamp of the most recent note; null when the
   *  lead has never been contacted. */
  lastReachOut?: number | null;
  onChanged?: () => void;
  className?: string;
}) {
  const [savingRating, setSavingRating] = useState(false);
  const [savingFollowUp, setSavingFollowUp] = useState(false);
  // Optimistic mirrors — the control flips the instant it's clicked
  // instead of waiting for the PATCH + host revalidation round-trip.
  // The prop catches up after `onChanged()` refreshes the host list;
  // the render-phase resets below clear the mirror when it does (the
  // sanctioned adjust-state-on-prop-change pattern — effects are the
  // wrong tool and the lint bans setState in them). A failed save
  // clears the mirror immediately, visibly reverting the control.
  const [optimisticRating, setOptimisticRating] = useState<number | null>(
    null
  );
  const [optimisticFollowUp, setOptimisticFollowUp] = useState<
    boolean | null
  >(null);
  const [prevRating, setPrevRating] = useState(rating);
  const [prevFollowedUp, setPrevFollowedUp] = useState(isFollowedUp);
  if (rating !== prevRating) {
    setPrevRating(rating);
    setOptimisticRating(null);
  }
  if (isFollowedUp !== prevFollowedUp) {
    setPrevFollowedUp(isFollowedUp);
    setOptimisticFollowUp(null);
  }
  const shownRating = optimisticRating ?? rating;
  const shownFollowedUp = optimisticFollowUp ?? isFollowedUp;

  async function patchLead(
    patch: { interest_level?: number; isFollowedUp?: boolean },
    label: string
  ) {
    const res = await fetch("/api/admin/leads", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: scope.source, id: scope.id, ...patch }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      throw new Error(err?.error ?? `${label} failed (${res.status})`);
    }
  }

  async function setRating(v: number) {
    setOptimisticRating(v);
    setSavingRating(true);
    try {
      await patchLead({ interest_level: v }, "Rating save");
      onChanged?.();
    } catch (err) {
      console.error("Failed to save lead rating:", err);
      toast.error(
        err instanceof Error ? err.message : "Couldn't save the rating."
      );
      setOptimisticRating(null);
    } finally {
      setSavingRating(false);
    }
  }

  async function toggleFollowUp() {
    const next = !shownFollowedUp;
    setOptimisticFollowUp(next);
    setSavingFollowUp(true);
    try {
      await patchLead({ isFollowedUp: next }, "Follow-up save");
      onChanged?.();
    } catch (err) {
      console.error("Failed to save follow-up flag:", err);
      toast.error(
        err instanceof Error ? err.message : "Couldn't update follow-up."
      );
      setOptimisticFollowUp(null);
    } finally {
      setSavingFollowUp(false);
    }
  }

  return (
    <div className={cn("space-y-3", className)}>
      {/* Conversion rating — full-width row of its own. */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Likelihood of conversion
        </p>
        <div className="mt-1 flex items-center gap-2">
          <StarRating
            value={shownRating}
            disabled={savingRating}
            onChange={(v) => void setRating(v)}
          />
          <span className="text-xs text-muted-foreground tabular-nums">
            {shownRating ? `${shownRating}/5` : "Not rated"}
          </span>
          {savingRating ? (
            <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
          ) : null}
        </div>
      </div>
      {/* Follow-up — checkbox under the rating (was a header button). */}
      <label className="flex w-fit cursor-pointer items-center gap-2 text-sm">
        <Checkbox
          checked={shownFollowedUp}
          disabled={savingFollowUp}
          aria-label="Followed up"
          onCheckedChange={() => void toggleFollowUp()}
        />
        <span className="font-medium">Followed up</span>
        {savingFollowUp ? (
          <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
        ) : null}
      </label>
      <p
        className="text-xs text-muted-foreground"
        title={
          lastReachOut
            ? new Date(lastReachOut).toLocaleString()
            : undefined
        }
      >
        {lastReachOut
          ? `Last contacted ${formatNoteTimestamp(lastReachOut)}`
          : "No contact logged yet."}
      </p>
    </div>
  );
}

/** The contact facts the triage sheet can edit. Source-agnostic —
 *  `/api/admin/leads` maps each onto the lead table's own columns. */
export interface LeadEditableDetails {
  student_name: string;
  /** null = the source has no parent-name column (TASCO); the input
   *  is hidden rather than offering an edit that can't save. */
  parent_name: string | null;
  phone: string;
  email: string;
  grade: string;
  school: string;
  /** Messaging/marketing consent. Read-only until Edit is clicked —
   *  and never editable when the source has no consent column
   *  (camp: sign-up is the implied consent). */
  opt_in: boolean;
  opt_in_editable: boolean;
}

/**
 * Inline editor for a lead's contact facts — read-mode grid with an
 * Edit toggle, PATCHing only the changed fields. Blank values can't
 * be saved (Xano skips empty inputs); the server says so in a warning
 * toast rather than pretending the clear landed.
 */
function LeadDetailsEditor({
  scope,
  details,
  onChanged,
}: {
  scope: LeadNoteScope;
  details: LeadEditableDetails;
  onChanged?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState({
    student_name: "",
    parent_name: "",
    phone: "",
    email: "",
    grade: "",
    school: "",
  });
  const [draftOptIn, setDraftOptIn] = useState(false);

  function enterEdit() {
    setDraft({
      student_name: details.student_name,
      parent_name: details.parent_name ?? "",
      phone: formatUSPhone(details.phone) || details.phone,
      email: details.email,
      grade: details.grade,
      school: details.school,
    });
    setDraftOptIn(details.opt_in);
    setEditing(true);
  }

  async function save() {
    // Diff-only patch against the row snapshot — untouched fields
    // never hit the API, so a stale value elsewhere can't clobber.
    const patch: Record<string, string | boolean> = {};
    if (draft.student_name.trim() !== details.student_name) {
      patch.student_name = draft.student_name;
    }
    if (
      details.parent_name !== null &&
      draft.parent_name.trim() !== details.parent_name
    ) {
      patch.parent_name = draft.parent_name;
    }
    const draftDigits = draft.phone.replace(/\D/g, "");
    if (draftDigits !== details.phone.replace(/\D/g, "")) {
      patch.phone = draft.phone;
    }
    if (draft.email.trim() !== details.email) patch.email = draft.email;
    if (draft.grade.trim() !== details.grade) patch.grade = draft.grade;
    if (draft.school.trim() !== details.school) patch.school = draft.school;
    if (details.opt_in_editable && draftOptIn !== details.opt_in) {
      patch.opt_in = draftOptIn;
    }
    if (Object.keys(patch).length === 0) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/leads", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: scope.source,
          id: scope.id,
          ...patch,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? `Save failed (${res.status})`);
      }
      const data = await res.json().catch(() => null);
      if (data?.warning) toast.warning(data.warning);
      else toast.success("Lead details saved.");
      setEditing(false);
      onChanged?.();
    } catch (err) {
      console.error("[LeadDetailsEditor.save]", err);
      toast.error(err instanceof Error ? err.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  const fields: Array<{
    key: keyof typeof draft;
    label: string;
    readValue: string;
    hidden?: boolean;
  }> = [
    { key: "student_name", label: "Student", readValue: details.student_name },
    {
      key: "parent_name",
      label: "Parent",
      readValue: details.parent_name ?? "",
      hidden: details.parent_name === null,
    },
    {
      key: "phone",
      label: "Phone",
      readValue: formatUSPhone(details.phone) || details.phone,
    },
    { key: "email", label: "Email", readValue: details.email },
    { key: "grade", label: "Grade", readValue: details.grade },
    { key: "school", label: "School", readValue: details.school },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Lead details
        </p>
        {editing ? (
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 bg-white"
              disabled={saving}
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-7"
              disabled={saving}
              onClick={() => void save()}
            >
              {saving ? (
                <Loader2 className="size-3.5 mr-1.5 animate-spin" />
              ) : null}
              Save
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 bg-white"
            onClick={enterEdit}
          >
            <Pencil className="size-3 mr-1.5" />
            Edit
          </Button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
        {fields
          .filter((f) => !f.hidden)
          .map((f) =>
            editing ? (
              <div key={f.key}>
                <p className="mb-1 text-[11px] text-muted-foreground">
                  {f.label}
                </p>
                <Input
                  value={draft[f.key]}
                  disabled={saving}
                  className="h-8 border-input bg-white text-sm"
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, [f.key]: e.target.value }))
                  }
                />
              </div>
            ) : (
              <div key={f.key} className="min-w-0">
                <p className="text-[11px] text-muted-foreground">{f.label}</p>
                <p
                  className="truncate text-sm text-foreground"
                  title={f.readValue || undefined}
                >
                  {f.readValue || "—"}
                </p>
              </div>
            )
          )}
        {/* Opt-in — read-only checkbox until Edit is clicked. Camp
            leads stay locked even then (no consent column; sign-up is
            the implied consent). */}
        <div>
          <p className="mb-1 text-[11px] text-muted-foreground">Opt-in</p>
          <label
            className={cn(
              "flex w-fit items-center gap-2 text-sm",
              editing && details.opt_in_editable
                ? "cursor-pointer"
                : "cursor-default"
            )}
            title={
              !details.opt_in_editable
                ? "Implied consent from camp sign-up"
                : editing
                  ? undefined
                  : "Click Edit to change"
            }
          >
            <Checkbox
              checked={editing ? draftOptIn : details.opt_in}
              disabled={!editing || !details.opt_in_editable || saving}
              aria-label="Messaging opt-in"
              className={cn(
                !editing && "disabled:opacity-100 disabled:cursor-default"
              )}
              onCheckedChange={(v) => setDraftOptIn(v === true)}
            />
            <span
              className={cn(
                (editing ? draftOptIn : details.opt_in)
                  ? "text-foreground"
                  : "text-muted-foreground"
              )}
            >
              {(editing ? draftOptIn : details.opt_in)
                ? "Opted in"
                : "Opted out"}
            </span>
          </label>
        </div>
      </div>
    </div>
  );
}

/**
 * Full triage sheet — the triage controls above a lead's comms log,
 * with the note composer docked to the bottom so it stays reachable
 * while the timeline scrolls. Used as-is by the pages that have no
 * detail sheet of their own (TASCO, All Leads); pages with an existing
 * detail sheet (Summer Camp, Liability Waiver Visits) embed
 * `LeadTriageControls` + `<InquiryNotes scope=… />` directly instead.
 */
export function LeadTriageSheet({
  open,
  onOpenChange,
  scope,
  title,
  subtitle,
  rating,
  isFollowedUp,
  lastReachOut,
  details,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: LeadNoteScope;
  title: string;
  subtitle?: string;
  rating: number;
  isFollowedUp: boolean;
  lastReachOut?: number | null;
  /** When provided, the sheet renders an editable Lead details block
   *  between the triage controls and the comms log. */
  details?: LeadEditableDetails;
  onChanged?: () => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-lg"
      >
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle className="text-base">{title}</SheetTitle>
          {subtitle ? (
            <SheetDescription className="text-xs">
              {subtitle}
            </SheetDescription>
          ) : null}
        </SheetHeader>

        <div className="border-b px-4 py-4">
          <LeadTriageControls
            scope={scope}
            rating={rating}
            isFollowedUp={isFollowedUp}
            lastReachOut={lastReachOut}
            onChanged={onChanged}
          />
        </div>

        {details ? (
          <div className="border-b bg-muted/10 px-4 py-4">
            {/* Keyed by lead so switching rows resets any in-progress
                edit instead of carrying a stale draft across leads. */}
            <LeadDetailsEditor
              key={`${scope.source}-${scope.id}`}
              scope={scope}
              details={details}
              onChanged={onChanged}
            />
          </div>
        ) : null}

        {/* Timeline — a chat stream pinned to the newest message
            (MessageScroller inside InquiryNotes); composer stays
            docked below it. */}
        <div className="flex min-h-0 flex-1 flex-col">
          <p className="shrink-0 border-b px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Communication log
          </p>
          <div className="min-h-0 flex-1">
            <InquiryNotes scope={scope} variant="timeline" />
          </div>
        </div>
        <div className="border-t bg-muted/20 px-4 py-3">
          <InquiryNoteComposer scope={scope} onNoteAdded={onChanged} />
        </div>
      </SheetContent>
    </Sheet>
  );
}

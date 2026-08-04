"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Check, Copy, Loader2, Mail, Pencil, Phone } from "lucide-react";
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
import { LeadTourSection } from "@/components/admin/tour-section";
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
 * Full-width phone/email row: the value on its own line (wrapping
 * rather than truncating, so a long address stays readable), with a
 * one-tap action (call / compose) and a copy button.
 */
function ContactRow({
  label,
  value,
  copyValue,
  href,
  actionLabel,
  actionIcon,
}: {
  label: string;
  value: string;
  /** Raw value for the clipboard — the phone copies as digits, not
   *  the prettified display form. */
  copyValue: string;
  href: string | null;
  actionLabel: string;
  actionIcon: React.ReactNode;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(copyValue);
      setCopied(true);
      // Revert the tick after a beat — a persistent check would read
      // as state rather than as confirmation.
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error("[ContactRow.copy]", err);
      toast.error("Couldn't copy — your browser blocked clipboard access.");
    }
  }

  return (
    <div className="min-w-0">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      {value ? (
        <div className="flex items-start justify-between gap-2">
          <a
            href={href ?? undefined}
            className="min-w-0 flex-1 break-all text-sm text-foreground hover:underline"
            title={`${actionLabel} ${value}`}
          >
            {value}
          </a>
          <span className="flex shrink-0 items-center gap-0.5">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => void copy()}
              title={copied ? "Copied" : `Copy ${label.toLowerCase()}`}
              aria-label={`Copy ${label.toLowerCase()}`}
            >
              {copied ? (
                <Check className="size-3.5 text-green-600" />
              ) : (
                <Copy className="size-3.5" />
              )}
            </Button>
            {href ? (
              <Button
                asChild
                variant="ghost"
                size="icon"
                className="size-7"
                title={`${actionLabel} ${value}`}
              >
                <a href={href} aria-label={actionLabel}>
                  {actionIcon}
                </a>
              </Button>
            ) : null}
          </span>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">—</p>
      )}
    </div>
  );
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

  // Optimistic snapshot shown between clicking Save and the host's
  // refetch landing. Cleared in the render phase below once the
  // incoming `details` change — the sanctioned adjust-state-on-prop-
  // change pattern (an effect here would flash the stale values).
  const [optimistic, setOptimistic] = useState<LeadEditableDetails | null>(
    null
  );
  const detailsSig = JSON.stringify(details);
  const [prevSig, setPrevSig] = useState(detailsSig);
  if (detailsSig !== prevSig) {
    setPrevSig(detailsSig);
    setOptimistic(null);
  }
  // Everything below reads through this, so read mode, the edit
  // seed, and the diff base all agree on what's currently shown.
  const shown = optimistic ?? details;

  function enterEdit() {
    setDraft({
      student_name: shown.student_name,
      parent_name: shown.parent_name ?? "",
      phone: formatUSPhone(shown.phone) || shown.phone,
      email: shown.email,
      grade: shown.grade,
      school: shown.school,
    });
    setDraftOptIn(shown.opt_in);
    setEditing(true);
  }

  async function save() {
    // Diff-only patch against the row snapshot — untouched fields
    // never hit the API, so a stale value elsewhere can't clobber.
    const patch: Record<string, string | boolean> = {};
    if (draft.student_name.trim() !== shown.student_name) {
      patch.student_name = draft.student_name;
    }
    if (
      shown.parent_name !== null &&
      draft.parent_name.trim() !== shown.parent_name
    ) {
      patch.parent_name = draft.parent_name;
    }
    const draftDigits = draft.phone.replace(/\D/g, "");
    if (draftDigits !== shown.phone.replace(/\D/g, "")) {
      patch.phone = draft.phone;
    }
    if (draft.email.trim() !== shown.email) patch.email = draft.email;
    if (draft.grade.trim() !== shown.grade) patch.grade = draft.grade;
    if (draft.school.trim() !== shown.school) patch.school = draft.school;
    if (shown.opt_in_editable && draftOptIn !== shown.opt_in) {
      patch.opt_in = draftOptIn;
    }
    if (Object.keys(patch).length === 0) {
      setEditing(false);
      return;
    }

    // Show the new values immediately and close the editor. Waiting
    // for the PATCH *and* the host's full All-Leads refetch (which
    // rescans four lead tables) meant the editor closed on stale text
    // and the values visibly changed a beat later.
    //
    // The optimistic snapshot mirrors what the SERVER will actually
    // store, not the raw draft: blank values are dropped (Xano skips
    // empty inputs) and the phone is stored as bare digits — so a
    // cleared field must not appear cleared here.
    const optimisticNext: LeadEditableDetails = {
      ...shown,
      ...(typeof patch.student_name === "string" && patch.student_name.trim()
        ? { student_name: patch.student_name.trim() }
        : {}),
      ...(typeof patch.parent_name === "string" && patch.parent_name.trim()
        ? { parent_name: patch.parent_name.trim() }
        : {}),
      ...(typeof patch.phone === "string" && patch.phone.replace(/\D/g, "")
        ? { phone: patch.phone.replace(/\D/g, "") }
        : {}),
      ...(typeof patch.email === "string" && patch.email.trim()
        ? { email: patch.email.trim() }
        : {}),
      ...(typeof patch.grade === "string" && patch.grade.trim()
        ? { grade: patch.grade.trim() }
        : {}),
      ...(typeof patch.school === "string" && patch.school.trim()
        ? { school: patch.school.trim() }
        : {}),
      ...(typeof patch.opt_in === "boolean" ? { opt_in: patch.opt_in } : {}),
    };
    setOptimistic(optimisticNext);
    setEditing(false);
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
      onChanged?.();
    } catch (err) {
      console.error("[LeadDetailsEditor.save]", err);
      toast.error(err instanceof Error ? err.message : "Couldn't save.");
      // Roll the display back and reopen the editor with the draft
      // intact, so a failed save is obviously unsaved and retryable
      // rather than silently showing values that never persisted.
      setOptimistic(null);
      setEditing(true);
    } finally {
      setSaving(false);
    }
  }

  // Short facts pair up in two columns; phone and email get their own
  // full-width rows underneath. An email in a half-width cell was
  // truncating to the point of being unreadable, and both want room
  // for their call/mail/copy actions.
  const gridFields: Array<{
    key: keyof typeof draft;
    label: string;
    readValue: string;
    hidden?: boolean;
  }> = [
    { key: "student_name", label: "Student", readValue: shown.student_name },
    {
      key: "parent_name",
      label: "Parent",
      readValue: shown.parent_name ?? "",
      hidden: shown.parent_name === null,
    },
    { key: "grade", label: "Grade", readValue: shown.grade },
    { key: "school", label: "School", readValue: shown.school },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Lead details
          {/* The editor has already closed on the new values by the
              time this shows — it just marks the write in flight. */}
          {saving && !editing ? (
            <Loader2 className="size-3 animate-spin" />
          ) : null}
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
        {gridFields
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
      </div>

      {/* Phone + email get full-width rows of their own: an email in a
          half-width cell truncated past readability, and both carry
          actions (call / mail / copy). */}
      <div className="space-y-2.5">
        {editing ? (
          <>
            <div>
              <p className="mb-1 text-[11px] text-muted-foreground">Phone</p>
              <Input
                value={draft.phone}
                disabled={saving}
                className="h-8 border-input bg-white text-sm"
                onChange={(e) =>
                  setDraft((d) => ({ ...d, phone: e.target.value }))
                }
              />
            </div>
            <div>
              <p className="mb-1 text-[11px] text-muted-foreground">Email</p>
              <Input
                value={draft.email}
                disabled={saving}
                className="h-8 border-input bg-white text-sm"
                onChange={(e) =>
                  setDraft((d) => ({ ...d, email: e.target.value }))
                }
              />
            </div>
          </>
        ) : (
          <>
            <ContactRow
              label="Phone"
              value={formatUSPhone(shown.phone) || shown.phone}
              copyValue={shown.phone}
              href={shown.phone ? `tel:${shown.phone}` : null}
              actionLabel="Call"
              actionIcon={<Phone className="size-3.5" />}
            />
            <ContactRow
              label="Email"
              value={shown.email}
              copyValue={shown.email}
              href={shown.email ? `mailto:${shown.email}` : null}
              actionLabel="Email"
              actionIcon={<Mail className="size-3.5" />}
            />
          </>
        )}
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
        {/* Opt-in — read-only checkbox until Edit is clicked. Camp
            leads stay locked even then (no consent column; sign-up is
            the implied consent). */}
        <div>
          <p className="mb-1 text-[11px] text-muted-foreground">Opt-in</p>
          <label
            className={cn(
              "flex w-fit items-center gap-2 text-sm",
              editing && shown.opt_in_editable
                ? "cursor-pointer"
                : "cursor-default"
            )}
            title={
              !shown.opt_in_editable
                ? "Implied consent from camp sign-up"
                : editing
                  ? undefined
                  : "Click Edit to change"
            }
          >
            <Checkbox
              checked={editing ? draftOptIn : shown.opt_in}
              disabled={!editing || !shown.opt_in_editable || saving}
              aria-label="Messaging opt-in"
              className={cn(
                !editing && "disabled:opacity-100 disabled:cursor-default"
              )}
              onCheckedChange={(v) => setDraftOptIn(v === true)}
            />
            <span
              className={cn(
                (editing ? draftOptIn : shown.opt_in)
                  ? "text-foreground"
                  : "text-muted-foreground"
              )}
            >
              {(editing ? draftOptIn : shown.opt_in)
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

        {/* Campus tour — schedule (Google Calendar invite to the
            parent) or manage the upcoming one. Contact defaults come
            from the same editable details block below. */}
        <div className="border-b px-4 py-4">
          <LeadTourSection
            scope={scope}
            parentName={details?.parent_name ?? ""}
            parentEmail={details?.email ?? ""}
            parentPhone={details?.phone ?? ""}
            studentName={details?.student_name ?? ""}
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

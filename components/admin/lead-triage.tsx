"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Check, Loader2, Pencil, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatUSPhone } from "@/lib/phone";
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
    setSavingRating(true);
    try {
      await patchLead({ interest_level: v }, "Rating save");
      onChanged?.();
    } catch (err) {
      console.error("Failed to save lead rating:", err);
      toast.error(
        err instanceof Error ? err.message : "Couldn't save the rating."
      );
    } finally {
      setSavingRating(false);
    }
  }

  async function toggleFollowUp() {
    const next = !isFollowedUp;
    setSavingFollowUp(true);
    try {
      await patchLead({ isFollowedUp: next }, "Follow-up save");
      onChanged?.();
      toast.success(next ? "Marked followed up." : "Moved back to needs follow-up.");
    } catch (err) {
      console.error("Failed to save follow-up flag:", err);
      toast.error(
        err instanceof Error ? err.message : "Couldn't update follow-up."
      );
    } finally {
      setSavingFollowUp(false);
    }
  }

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Likelihood of conversion
          </p>
          <div className="mt-1 flex items-center gap-2">
            <StarRating
              value={rating}
              disabled={savingRating}
              onChange={(v) => void setRating(v)}
            />
            <span className="text-xs text-muted-foreground tabular-nums">
              {rating ? `${rating}/5` : "Not rated"}
            </span>
            {savingRating ? (
              <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
            ) : null}
          </div>
        </div>
        <Button
          type="button"
          variant={isFollowedUp ? "outline" : "default"}
          size="sm"
          className={cn(isFollowedUp && "bg-white")}
          disabled={savingFollowUp}
          onClick={() => void toggleFollowUp()}
        >
          {savingFollowUp ? (
            <Loader2 className="size-3.5 mr-1.5 animate-spin" />
          ) : isFollowedUp ? (
            <Undo2 className="size-3.5 mr-1.5" />
          ) : (
            <Check className="size-3.5 mr-1.5" />
          )}
          {isFollowedUp ? "Undo follow-up" : "Mark followed up"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {lastReachOut
          ? `Last contacted ${new Date(lastReachOut).toLocaleString()}`
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

  function enterEdit() {
    setDraft({
      student_name: details.student_name,
      parent_name: details.parent_name ?? "",
      phone: formatUSPhone(details.phone) || details.phone,
      email: details.email,
      grade: details.grade,
      school: details.school,
    });
    setEditing(true);
  }

  async function save() {
    // Diff-only patch against the row snapshot — untouched fields
    // never hit the API, so a stale value elsewhere can't clobber.
    const patch: Record<string, string> = {};
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

        {/* Timeline scrolls; composer stays pinned below it. */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Communication log
          </p>
          <InquiryNotes scope={scope} variant="timeline" />
        </div>
        <div className="border-t bg-muted/20 px-4 py-3">
          <InquiryNoteComposer scope={scope} onNoteAdded={onChanged} />
        </div>
      </SheetContent>
    </Sheet>
  );
}

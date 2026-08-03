"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Check, Loader2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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

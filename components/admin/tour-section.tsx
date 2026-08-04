"use client";

import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { CalendarPlus, Loader2, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  LocationInput,
  TimeSelect,
  timeInputToMs,
} from "@/components/admin/event-upsert-dialog";
import type { LeadNoteScope } from "@/components/admin/inquiry-notes";
import { adminFetcher } from "@/lib/admin-fetcher";
import {
  TOUR_DEFAULT_LOCATION,
  TOUR_STATUS_LABEL,
  leadToursKey,
  tourRsvpBadge,
  tourWhenLabel,
} from "@/lib/tours";
import type { ToursResponse } from "@/app/api/admin/tours/route";
import { cn } from "@/lib/utils";

/**
 * Campus-tour block for a lead's triage sheet: the lead's upcoming
 * tour (when · where · invite RSVP) with a cancel action, or a
 * "Schedule tour" button when there's none. Scheduling opens
 * `TourScheduleDialog`, which POSTs `/api/admin/tours` — that creates
 * the Google Calendar event, emails the parent the invite, and logs
 * the tour into this lead's comms log.
 *
 * Deeper lifecycle actions (completed / no-show / reschedule) live on
 * the Campus Visits → Tours tab; the sheet keeps the two moves that
 * happen mid-conversation with a parent.
 */

const DURATION_OPTIONS = [30, 45, 60, 90] as const;
const DEFAULT_LOCATION = TOUR_DEFAULT_LOCATION;

/** Status → badge tint, matching the app's existing badge idiom. */
export function tourStatusBadgeClass(status: string): string {
  switch (status) {
    case "scheduled":
      return "bg-sky-100 text-sky-800 hover:bg-sky-100";
    case "completed":
      return "bg-green-100 text-green-800 hover:bg-green-100";
    case "no_show":
      return "bg-amber-100 text-amber-800 hover:bg-amber-100";
    default:
      return "bg-muted text-muted-foreground hover:bg-muted";
  }
}

/**
 * Just the "Book campus tour" action for a lead sheet — no status
 * card. The tour itself surfaces in the lead's activity log (which
 * reads the tours table directly), so a second card restating it was
 * redundant; what the sheet still needs is the way to start one.
 */
export function LeadTourButton({
  scope,
  parentName,
  parentEmail,
  parentPhone,
  studentName,
  onChanged,
}: {
  scope: LeadNoteScope;
  parentName?: string;
  parentEmail?: string;
  parentPhone?: string;
  studentName?: string;
  onChanged?: () => void;
}) {
  const { data, mutate } = useSWR<ToursResponse>(
    leadToursKey(scope),
    adminFetcher,
    { revalidateOnFocus: false }
  );
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 bg-white"
        onClick={() => setOpen(true)}
      >
        <CalendarPlus className="size-3.5" />
        Book campus tour
      </Button>
      <TourScheduleDialog
        open={open}
        onOpenChange={setOpen}
        scope={scope}
        parentName={parentName ?? ""}
        parentEmail={parentEmail ?? ""}
        parentPhone={parentPhone ?? ""}
        studentName={studentName ?? ""}
        calendarConfigured={data?.calendarConfigured ?? false}
        onScheduled={() => {
          void mutate();
          onChanged?.();
        }}
      />
    </>
  );
}

export function LeadTourSection({
  scope,
  parentName,
  parentEmail,
  parentPhone,
  studentName,
  onChanged,
}: {
  scope: LeadNoteScope;
  parentName?: string;
  parentEmail?: string;
  parentPhone?: string;
  studentName?: string;
  onChanged?: () => void;
}) {
  const { data, mutate } = useSWR<ToursResponse>(
    leadToursKey(scope),
    adminFetcher,
    { revalidateOnFocus: false }
  );
  const tours = data?.tours ?? [];
  // The one tour that matters in the sheet: the next (or most recent)
  // still-scheduled one. History stays on the Tours tab.
  const active = tours.find((t) => t.status === "scheduled") ?? null;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [canceling, setCanceling] = useState(false);

  async function cancelTour() {
    if (!active || canceling) return;
    setCanceling(true);
    try {
      const res = await fetch(`/api/admin/tours/${active.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? `Cancel failed (${res.status})`);
      }
      const result = await res.json().catch(() => null);
      if (result?.warning) toast.warning(result.warning);
      else toast.success("Tour canceled — the parent was notified.");
      await mutate();
      onChanged?.();
    } catch (err) {
      console.error("[LeadTourSection.cancelTour]", err);
      toast.error(
        err instanceof Error ? err.message : "Couldn't cancel the tour."
      );
    } finally {
      setCanceling(false);
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Campus tour
      </p>
      {active ? (
        <div className="space-y-1.5 rounded-md border bg-white p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium">
              {tourWhenLabel(active.scheduled_at, active.duration_minutes)}
            </p>
            <Badge className={cn(tourStatusBadgeClass(active.status))}>
              {TOUR_STATUS_LABEL[active.status] ?? active.status}
            </Badge>
          </div>
          {active.location ? (
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <MapPin className="size-3 shrink-0" />
              {active.location}
            </p>
          ) : null}
          {active.google_event_id && active.parent_email ? (
            <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <span className="truncate">Invite: {active.parent_email}</span>
              <Badge
                className={cn(tourRsvpBadge(active.rsvp_status).className)}
              >
                {tourRsvpBadge(active.rsvp_status).label}
              </Badge>
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              No calendar invite sent.
            </p>
          )}
          <div className="flex items-center gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 bg-white"
              disabled={canceling}
              onClick={() => void cancelTour()}
            >
              {canceling ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : null}
              Cancel tour
            </Button>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 bg-white"
          onClick={() => setDialogOpen(true)}
        >
          <CalendarPlus className="size-3.5" />
          Schedule tour
        </Button>
      )}

      <TourScheduleDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        scope={scope}
        parentName={parentName ?? ""}
        parentEmail={parentEmail ?? ""}
        parentPhone={parentPhone ?? ""}
        studentName={studentName ?? ""}
        calendarConfigured={data?.calendarConfigured ?? false}
        onScheduled={() => {
          void mutate();
          onChanged?.();
        }}
      />
    </div>
  );
}

/**
 * Schedule-a-tour dialog. Date + time + duration + location + the
 * email the Google invite goes to (prefilled from the lead, editable
 * because lead emails are sometimes stale) + notes that appear in the
 * parent's invite description.
 */
export function TourScheduleDialog({
  open,
  onOpenChange,
  scope,
  parentName,
  parentEmail,
  parentPhone,
  studentName,
  calendarConfigured,
  onScheduled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: LeadNoteScope;
  parentName: string;
  parentEmail: string;
  parentPhone: string;
  studentName: string;
  calendarConfigured: boolean;
  onScheduled?: () => void;
}) {
  const [date, setDate] = useState("");
  const [time, setTime] = useState("10:00");
  const [duration, setDuration] = useState("60");
  const [location, setLocation] = useState(DEFAULT_LOCATION);
  const [email, setEmail] = useState(parentEmail);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // Reseed the email when the dialog opens for a different lead —
  // the sanctioned adjust-state-on-prop-change pattern.
  const [prevSeed, setPrevSeed] = useState(`${scope.source}-${scope.id}`);
  const seed = `${scope.source}-${scope.id}`;
  if (seed !== prevSeed) {
    setPrevSeed(seed);
    setEmail(parentEmail);
    setDate("");
    setTime("10:00");
    setDuration("60");
    setLocation(DEFAULT_LOCATION);
    setNotes("");
  }

  const scheduledAt = date ? timeInputToMs(date, time) : 0;
  const canSubmit = scheduledAt > 0 && !saving;

  async function submit() {
    if (!canSubmit) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/tours", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadSource: scope.source,
          leadId: scope.id,
          scheduled_at: scheduledAt,
          duration_minutes: Number(duration),
          location,
          notes,
          parent_name: parentName,
          parent_email: email,
          parent_phone: parentPhone,
          student_name: studentName,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? `Scheduling failed (${res.status})`);
      }
      const result = await res.json().catch(() => null);
      if (result?.warning) toast.warning(result.warning);
      else toast.success("Tour scheduled — the invite is on its way.");
      onOpenChange(false);
      setDate("");
      setNotes("");
      onScheduled?.();
    } catch (err) {
      console.error("[TourScheduleDialog.submit]", err);
      toast.error(
        err instanceof Error ? err.message : "Couldn't schedule the tour."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Schedule a campus tour</DialogTitle>
          <DialogDescription>
            {calendarConfigured
              ? "The tour goes on the school's Google Calendar and the parent gets an emailed invite."
              : "Google Calendar sync isn't configured yet — the tour will be logged here only."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="tour-date" className="text-xs">
                Date
              </Label>
              <Input
                id="tour-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="h-9 bg-white"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Start time</Label>
              <TimeSelect
                value={time}
                onChange={setTime}
                ariaLabel="Tour start time"
                // A tour always has a time — no clear button.
                clearable={false}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Duration</Label>
            <Select value={duration} onValueChange={setDuration}>
              <SelectTrigger className="h-9 w-full bg-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DURATION_OPTIONS.map((m) => (
                  <SelectItem key={m} value={String(m)}>
                    {m} minutes
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Location</Label>
            <LocationInput value={location} onChange={setLocation} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tour-email" className="text-xs">
              Parent email (invite goes here)
            </Label>
            <Input
              id="tour-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="No email on file — no invite will be sent"
              className="h-9 bg-white"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tour-notes" className="text-xs">
              Notes for the family (optional)
            </Label>
            <Textarea
              id="tour-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything specific to this family — added to the top of the invite, above the standard tour description and parking directions."
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="button" disabled={!canSubmit} onClick={() => void submit()}>
            {saving ? (
              <>
                <Loader2 className="size-3.5 animate-spin mr-1.5" />
                Scheduling
              </>
            ) : (
              "Schedule tour"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { toast } from "sonner";
import {
  CalendarPlus,
  CalendarX2,
  Check,
  ExternalLink,
  Link2,
  Link2Off,
  Loader2,
  MoreHorizontal,
  RefreshCw,
  Search,
  Trash2,
  UserX,
} from "lucide-react";
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
import { DataTable, type ColumnDef } from "@/components/admin/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  TimeSelect,
  msToTimeInput,
  timeInputToMs,
} from "@/components/admin/event-upsert-dialog";
import { tourStatusBadgeClass } from "@/components/admin/tour-section";
import { LeadTriageSheet } from "@/components/admin/lead-triage";
import { adminFetcher } from "@/lib/admin-fetcher";
import { formatUSPhone } from "@/lib/phone";
import {
  TOUR_STATUS_LABEL,
  isTourAffectedKey,
  tourRsvpBadge,
  tourWhenLabel,
} from "@/lib/tours";
import { TourScheduleDialog } from "@/components/admin/tour-section";
import {
  liveTourEventId,
  tourLeadScope,
  type LeadNoteSource,
  type XanoTour,
} from "@/lib/xano";
import type { AllLeadRow } from "@/app/api/admin/all-leads/route";
import type { ToursResponse } from "@/app/api/admin/tours/route";
import type { TourSyncResult } from "@/app/api/admin/tours/sync/route";
import { cn } from "@/lib/utils";

/** Short label per lead source — the Lead column's vocabulary. */
const LEAD_LABEL: Record<LeadNoteSource, string> = {
  inquiry: "Inquiry",
  camp: "Summer Camp",
  visit: "Waiver Visit",
  tasco: "TASCO",
};

/**
 * Scheduled tours — the operational list on Campus Visits. Upcoming
 * tours first (soonest at the top), history below, with the lifecycle
 * actions: mark completed / no-show, reschedule (Google emails the
 * parent the update), cancel (Google emails the cancellation).
 * Scheduling NEW tours happens from a lead's triage sheet, where the
 * contact context lives.
 */

// A `type` row for DataTable (needs the implicit index signature).
type TourRow = {
  id: number;
  scheduled_at: number;
  when: string;
  parent_name: string;
  parent_email: string;
  parent_phone: string;
  student_name: string;
  location: string;
  status: string;
  rsvp: string;
  hasInvite: boolean;
  duration_minutes: number;
  /** Which lead the tour is linked to; null = unlinked import. */
  lead: { source: LeadNoteSource; id: number } | null;
};

export function ToursPanel() {
  const { data, isLoading, error, mutate } = useSWR<ToursResponse>(
    "/api/admin/tours",
    adminFetcher,
    { refreshInterval: 60_000 }
  );

  const rows: TourRow[] = useMemo(() => {
    const tours = data?.tours ?? [];
    return tours.map((t: XanoTour) => ({
      id: t.id,
      scheduled_at: t.scheduled_at,
      when: tourWhenLabel(t.scheduled_at, t.duration_minutes),
      parent_name: t.parent_name,
      parent_email: t.parent_email,
      parent_phone: t.parent_phone,
      student_name: t.student_name,
      location: t.location,
      status: t.status,
      rsvp: t.rsvp_status,
      hasInvite: Boolean(liveTourEventId(t.google_event_id) && t.parent_email),
      duration_minutes: t.duration_minutes,
      lead: tourLeadScope(t),
    }));
  }, [data]);

  // Two sections split on DATE, not just status: a tour still flagged
  // "scheduled" whose slot already passed isn't upcoming — it's
  // unresolved bookkeeping and belongs with the past ones (its
  // Scheduled badge + lifecycle menu say what's left to do). Upcoming
  // sorts soonest-first; past newest-first.
  const { upcoming, past } = useMemo(() => {
    const now = Date.now();
    const isUpcoming = (r: TourRow) =>
      r.status === "scheduled" && r.scheduled_at > now;
    return {
      upcoming: rows
        .filter(isUpcoming)
        .sort((a, b) => a.scheduled_at - b.scheduled_at),
      past: rows
        .filter((r) => !isUpcoming(r))
        .sort((a, b) => b.scheduled_at - a.scheduled_at),
    };
  }, [rows]);

  const [search, setSearch] = useState("");
  const [pendingAction, setPendingAction] = useState<number | null>(null);
  const [reschedule, setReschedule] = useState<TourRow | null>(null);
  const [linking, setLinking] = useState<TourRow | null>(null);
  const [deleting, setDeleting] = useState<TourRow | null>(null);
  const [syncing, setSyncing] = useState(false);
  // Scheduling is two steps: pick who the tour is for, then the
  // date/time dialog seeded with that lead's contact details.
  const [pickingForSchedule, setPickingForSchedule] = useState(false);
  const [scheduleFor, setScheduleFor] = useState<AllLeadRow | null>(null);

  // One invalidation for every surface a tour touches — the lead's
  // activity log (which animates the new entry in), the dashboard
  // feed, the All Leads tour column, and this table.
  const { mutate: globalMutate } = useSWRConfig();
  const refreshTourSurfaces = () => {
    void globalMutate(isTourAffectedKey);
  };

  // Clicking a tour opens ITS LEAD's triage sheet — the inquiry
  // details plus the full comms/activity log — rather than a
  // tour-only view: the tour is one event in that lead's story. The
  // all-leads fetch is lazy (first row click) like the Messages page.
  // We keep the whole TOUR row (not just its lead pointer): when the
  // linked lead turns out not to exist anymore — deleted inquiry,
  // FK hand-edited to a bad id — the row is what lets us fall back
  // to the link picker so the admin can repair it on the spot.
  const [openTour, setOpenTour] = useState<TourRow | null>(null);
  const openLead = openTour?.lead ?? null;
  const { data: leadRows, mutate: mutateLeadRows } = useSWR<AllLeadRow[]>(
    openLead ? "/api/admin/all-leads" : null,
    adminFetcher,
    {
      revalidateOnFocus: false,
      onSuccess: (rows) => {
        if (!openLead) return;
        // adminFetcher resolves whatever the route returned — guard
        // the shape before .some so an error payload can't throw.
        const found =
          Array.isArray(rows) &&
          rows.some(
            (l) => l.source === openLead.source && l.id === openLead.id
          );
        if (!found) {
          const tour = openTour;
          setOpenTour(null);
          toast.warning(
            "This tour's linked lead no longer exists — pick the lead it belongs to."
          );
          if (tour) setLinking(tour);
        }
      },
    }
  );
  const leadRow =
    openLead && Array.isArray(leadRows)
      ? (leadRows.find(
          (l) => l.source === openLead.source && l.id === openLead.id
        ) ?? null)
      : null;

  /** Pull website bookings (the sailfutureacademy.org/tour Google
   *  appointment schedule) into the app. Auto-runs quietly on mount;
   *  the manual button reports what it found. */
  async function runSync(manual: boolean) {
    setSyncing(true);
    try {
      // Manual = "get me everything", so it sweeps back to the start
      // of 2026; the quiet on-mount sync keeps the cheap 30-day
      // window.
      const res = await fetch("/api/admin/tours/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(manual ? { deep: true } : {}),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? `Sync failed (${res.status})`);
      }
      const result: TourSyncResult = await res.json();
      const changed =
        result.imported + result.rsvpUpdated + result.canceled > 0;
      if (changed) refreshTourSurfaces();
      if (manual) {
        if (!result.configured) {
          toast.warning(
            "Google Calendar sync isn't configured — nothing to pull."
          );
        } else if (changed) {
          const parts = [
            result.imported
              ? `${result.imported} booking${result.imported === 1 ? "" : "s"} imported` +
                (result.unmatched ? ` (${result.unmatched} without a matching lead)` : "")
              : null,
            result.rsvpUpdated ? `${result.rsvpUpdated} RSVP updated` : null,
            result.canceled ? `${result.canceled} canceled in Google` : null,
          ].filter(Boolean);
          toast.success(parts.join(" · "));
        } else {
          toast.success("Up to date with Google Calendar.");
        }
      } else if (changed && result.imported > 0) {
        toast.info(
          `${result.imported} website tour booking${
            result.imported === 1 ? "" : "s"
          } imported from Google Calendar.`
        );
      }
    } catch (err) {
      console.error("[ToursPanel.runSync]", err);
      if (manual) {
        toast.error(
          err instanceof Error ? err.message : "Couldn't sync with Google."
        );
      }
    } finally {
      setSyncing(false);
    }
  }

  // One quiet sync per mount, so bookings made overnight appear
  // without anyone thinking to press the button.
  const syncedOnce = useRef(false);
  useEffect(() => {
    if (syncedOnce.current) return;
    syncedOnce.current = true;
    void runSync(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function patchTour(
    row: TourRow,
    body: Record<string, unknown>,
    successMsg: string
  ) {
    setPendingAction(row.id);
    try {
      const res = await fetch(`/api/admin/tours/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? `Update failed (${res.status})`);
      }
      const result = await res.json().catch(() => null);
      if (result?.warning) toast.warning(result.warning);
      else toast.success(successMsg);
      // Refresh everything the change shows up in, so an open lead
      // sheet animates the new activity-log entry immediately.
      refreshTourSurfaces();
    } catch (err) {
      console.error("[ToursPanel.patchTour]", err);
      toast.error(
        err instanceof Error ? err.message : "Couldn't update the tour."
      );
    } finally {
      setPendingAction(null);
    }
  }

  /** Hard-delete a tour row (any status, canceled included) — the
   *  API cancels any still-live Google event first, then removes the
   *  record from the table and every timeline that renders it. */
  async function deleteTour(row: TourRow) {
    setPendingAction(row.id);
    try {
      const res = await fetch(`/api/admin/tours/${row.id}`, {
        method: "DELETE",
      });
      const result = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(result?.error ?? `Delete failed (${res.status})`);
      }
      if (result?.warning) toast.warning(result.warning);
      else toast.success("Tour deleted.");
      refreshTourSurfaces();
    } catch (err) {
      console.error("[ToursPanel.deleteTour]", err);
      toast.error(
        err instanceof Error ? err.message : "Couldn't delete the tour."
      );
    } finally {
      setPendingAction(null);
    }
  }

  const columns: ColumnDef<TourRow>[] = [
    {
      key: "scheduled_at",
      header: "When",
      sortable: true,
      width: "w-[17%]",
      render: (r) => (
        <span
          className={cn(
            "block truncate text-sm tabular-nums",
            r.status === "scheduled" ? "font-medium" : "text-muted-foreground"
          )}
          title={new Date(r.scheduled_at).toLocaleString()}
        >
          {r.when}
        </span>
      ),
    },
    {
      key: "parent_name",
      header: "Parent",
      sortable: true,
      searchable: true,
      width: "w-[15%]",
      render: (r) => (
        <span className="block truncate text-sm font-medium">
          {r.parent_name || "—"}
        </span>
      ),
    },
    {
      key: "student_name",
      header: "Student",
      sortable: true,
      searchable: true,
      width: "w-[13%]",
      render: (r) => (
        <span className="block truncate text-sm">{r.student_name || "—"}</span>
      ),
    },
    {
      key: "parent_email",
      header: "Contact",
      searchable: true,
      width: "w-[15%]",
      render: (r) => (
        <span className="block truncate text-sm" title={r.parent_email}>
          {r.parent_email ||
            formatUSPhone(r.parent_phone) ||
            r.parent_phone ||
            "—"}
        </span>
      ),
    },
    {
      key: "location",
      header: "Location",
      searchable: true,
      width: "w-[11%]",
      render: (r) => (
        <span
          className="block truncate text-sm text-muted-foreground"
          title={r.location}
        >
          {r.location || "—"}
        </span>
      ),
    },
    {
      key: "lead",
      header: "Lead",
      width: "w-[10%]",
      accessor: (r) => (r.lead ? LEAD_LABEL[r.lead.source] : ""),
      render: (r) =>
        r.lead ? (
          <span className="text-xs text-muted-foreground">
            {LEAD_LABEL[r.lead.source]}
          </span>
        ) : (
          <Badge
            className="bg-amber-100 text-amber-800 hover:bg-amber-100"
            title="No matching lead — use the row menu to link one"
          >
            Unlinked
          </Badge>
        ),
    },
    {
      key: "status",
      header: "Status",
      sortable: true,
      width: "w-[9%]",
      render: (r) => (
        <Badge className={cn(tourStatusBadgeClass(r.status))}>
          {TOUR_STATUS_LABEL[r.status] ?? r.status}
        </Badge>
      ),
    },
    {
      key: "rsvp",
      header: "Invite",
      width: "w-[9%]",
      render: (r) =>
        r.hasInvite ? (
          <Badge className={cn(tourRsvpBadge(r.rsvp).className)}>
            {tourRsvpBadge(r.rsvp).label}
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      key: "id",
      header: "",
      width: "w-[44px]",
      align: "right",
      render: (r) => (
        // stopPropagation: the row itself opens the lead sheet, and
        // clicking the actions button must not do both.
        <span onClick={(e) => e.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label="Tour actions"
                disabled={pendingAction === r.id}
              >
                {pendingAction === r.id ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <MoreHorizontal className="size-4" />
                )}
              </Button>
            </DropdownMenuTrigger>
            {/* w-auto overrides the base content width, which is
                pinned to the TRIGGER's width — a size-7 icon button,
                so every label wrapped to two lines. */}
            <DropdownMenuContent align="end" className="w-auto [&_*]:whitespace-nowrap">
              {/* Link actions are offered on ANY tour (even past ones
                  — the visit still belongs on the lead's timeline);
                  lifecycle actions only while scheduled. */}
              {r.lead ? (
                <>
                  <DropdownMenuItem onClick={() => setLinking(r)}>
                    <Link2 className="size-4" />
                    Change lead…
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() =>
                      void patchTour(
                        r,
                        { action: "unlink" },
                        "Tour unlinked from that lead."
                      )
                    }
                  >
                    <Link2Off className="size-4" />
                    Unlink from lead
                  </DropdownMenuItem>
                </>
              ) : (
                <DropdownMenuItem onClick={() => setLinking(r)}>
                  <Link2 className="size-4" />
                  Link to lead…
                </DropdownMenuItem>
              )}
              {r.status === "scheduled" ? (
                <>
                  <DropdownMenuItem
                    onClick={() =>
                      void patchTour(r, { action: "complete" }, "Tour marked completed.")
                    }
                  >
                    <Check className="size-4" />
                    Mark completed
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() =>
                      void patchTour(r, { action: "no_show" }, "Marked as a no-show.")
                    }
                  >
                    <UserX className="size-4" />
                    Mark no-show
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setReschedule(r)}>
                    <CalendarX2 className="size-4" />
                    Reschedule…
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() =>
                      void patchTour(
                        r,
                        { action: "cancel" },
                        "Tour canceled — the parent was notified."
                      )
                    }
                  >
                    Cancel tour
                  </DropdownMenuItem>
                </>
              ) : null}
              {/* Delete is offered on EVERY status — canceled rows
                  included; that's the whole point (cancel keeps the
                  record, delete removes it). Confirmed via dialog. */}
              <DropdownMenuItem
                variant="destructive"
                onClick={() => setDeleting(r)}
              >
                <Trash2 className="size-4" />
                Delete tour…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      ),
    },
  ];

  return (
    <Card className="overflow-hidden bg-white py-0 gap-0">
      <CardHeader className="py-4 border-b bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-base">
            Scheduled tours
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {upcoming.length} upcoming
            </span>
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="Search by parent, student, email, or location…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-full sm:w-72"
            />
            <Button onClick={() => setPickingForSchedule(true)}>
              <CalendarPlus className="size-4" />
              Schedule tour
            </Button>
            {/* Straight to the admissions calendar the events land
                on — the ?cid= link opens (or offers to add) that
                calendar in the admin's own Google Calendar. */}
            {data?.calendarEmail ? (
              <Button asChild variant="outline" className="bg-white">
                <a
                  href={`https://calendar.google.com/calendar/u/0/r?cid=${encodeURIComponent(data.calendarEmail)}`}
                  target="_blank"
                  rel="noreferrer"
                  title={`Open ${data.calendarEmail} in Google Calendar`}
                >
                  <ExternalLink className="size-4" />
                  Google Calendar
                </a>
              </Button>
            ) : null}
            <Button
              variant="outline"
              className="bg-white"
              disabled={syncing}
              onClick={() => void runSync(true)}
              title="Pull every booking since Jan 1 2026, plus RSVP changes, from Google Calendar"
            >
              <RefreshCw className={cn("size-4", syncing && "animate-spin")} />
              {syncing ? "Syncing…" : "Sync Google"}
            </Button>
          </div>
        </div>
        {data && !data.calendarConfigured ? (
          <p className="text-xs text-amber-700">
            Google Calendar sync isn&rsquo;t configured — tours are logged
            here, but no invites are emailed.
          </p>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-6 p-4 bg-white">
        {error && !data ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            Couldn&rsquo;t load tours. Refresh to try again.
          </div>
        ) : upcoming.length + past.length === 0 && !isLoading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No tours yet. Bookings from the website tour page import
            here automatically — use Sync Google to pull them in now.
          </div>
        ) : (
          // Two sections split on the tour's DATE — upcoming above,
          // everything already past below (including still-"scheduled"
          // rows whose slot passed without an outcome; their badge +
          // row menu say what's left to resolve).
          (
            [
              {
                key: "upcoming",
                title: "Upcoming",
                dot: "bg-sky-500",
                description: "On the calendar ahead — soonest first.",
                data: upcoming,
              },
              {
                key: "past",
                title: "Past",
                dot: "bg-slate-400",
                description:
                  "Completed, canceled, no-shows — and scheduled tours whose date has passed without an outcome.",
                data: past,
              },
            ] as const
          ).map((section) =>
            section.data.length === 0 && !isLoading ? null : (
              <div key={section.key} className="space-y-3">
                <div className="flex items-baseline gap-3">
                  <span
                    className={cn(
                      "size-2.5 shrink-0 self-center rounded-full",
                      section.dot
                    )}
                    aria-hidden
                  />
                  <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                    {section.title}
                  </p>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    ({section.data.length})
                  </span>
                  <p className="text-xs text-muted-foreground">
                    {section.description}
                  </p>
                </div>
                <DataTable<TourRow>
                  columns={columns}
                  data={section.data}
                  isLoading={isLoading && !data}
                  externalSearch={search}
                  // A tour is one event in a lead's story, so the row
                  // opens that lead's details + activity. An unlinked
                  // tour has no lead to open — offer the picker
                  // instead of doing nothing, which would read as a
                  // broken row.
                  onRowClick={(r) => {
                    if (r.lead) setOpenTour(r);
                    else setLinking(r);
                  }}
                  rowClassName={(r) =>
                    openLead &&
                    r.lead?.source === openLead.source &&
                    r.lead.id === openLead.id
                      ? "bg-muted hover:bg-muted"
                      : "hover:bg-muted/50"
                  }
                />
              </div>
            )
          )
        )}
      </CardContent>

      {/* Delete confirm — deleting removes the record everywhere
          (Tours tab + the lead's activity timeline), so it gets the
          heavyweight dialog rather than a one-click menu action. */}
      <AlertDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this tour?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting
                ? `${deleting.parent_name || deleting.student_name || "This booking"} — ${deleting.when}. The record disappears from the Tours tab and the lead's activity log.${
                    deleting.status === "scheduled" && deleting.hasInvite
                      ? " Its calendar invite is canceled and the parent is emailed."
                      : ""
                  }`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                const row = deleting;
                setDeleting(null);
                if (row) void deleteTour(row);
              }}
            >
              Delete tour
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <TourRescheduleDialog
        row={reschedule}
        onOpenChange={(o) => !o && setReschedule(null)}
        onSubmit={async (scheduledAt) => {
          const row = reschedule;
          setReschedule(null);
          if (!row) return;
          await patchTour(
            row,
            { action: "reschedule", scheduled_at: scheduledAt },
            "Tour rescheduled — the parent's invite was updated."
          );
        }}
      />

      <LeadPickerDialog
        open={linking !== null}
        title={linking?.lead ? "Move tour to another lead" : "Link tour to a lead"}
        description={
          linking
            ? `${linking.parent_name || linking.parent_email || "This booking"} — ${linking.when}. Pick the lead this tour belongs to; it will appear on their activity log.`
            : ""
        }
        seed={linking ? linking.parent_email || linking.parent_name : ""}
        onOpenChange={(o) => !o && setLinking(null)}
        onPick={async (lead) => {
          const row = linking;
          setLinking(null);
          if (!row) return;
          await patchTour(
            row,
            { action: "link", leadSource: lead.source, leadId: lead.id },
            row.lead
              ? "Tour moved to that lead."
              : "Tour linked — it now shows on that lead's activity log."
          );
        }}
      />

      {/* Scheduling: pick the lead, then the date/time dialog. */}
      <LeadPickerDialog
        open={pickingForSchedule}
        title="Schedule a campus tour"
        description="Who is the tour for? Pick a lead and you'll set the date and time next."
        onOpenChange={setPickingForSchedule}
        onPick={(lead) => {
          setPickingForSchedule(false);
          setScheduleFor(lead);
        }}
      />
      {scheduleFor ? (
        <TourScheduleDialog
          open
          onOpenChange={(o) => !o && setScheduleFor(null)}
          scope={{ source: scheduleFor.source, id: scheduleFor.id }}
          parentName={scheduleFor.parent_name}
          parentEmail={scheduleFor.email}
          parentPhone={scheduleFor.phone}
          studentName={scheduleFor.student_name}
          calendarConfigured={data?.calendarConfigured ?? false}
          onScheduled={() => {
            setScheduleFor(null);
            refreshTourSurfaces();
          }}
        />
      ) : null}

      {/* The clicked tour's lead — the same triage sheet All Leads
          and the dashboard use: details, stars, tour section, and the
          full comms/activity log. */}
      {leadRow ? (
        <LeadTriageSheet
          open
          onOpenChange={(o) => !o && setOpenTour(null)}
          scope={{ source: leadRow.source, id: leadRow.id }}
          title={
            leadRow.student_name ||
            leadRow.parent_name ||
            `${LEAD_LABEL[leadRow.source]} #${leadRow.id}`
          }
          subtitle={[
            LEAD_LABEL[leadRow.source],
            leadRow.parent_name || null,
            formatUSPhone(leadRow.phone) || null,
            leadRow.detail || null,
          ]
            .filter(Boolean)
            .join(" · ")}
          rating={leadRow.rating}
          isFollowedUp={leadRow.followed_up}
          lastReachOut={leadRow.last_reach_out || null}
          details={{
            student_name: leadRow.student_name,
            parent_name:
              leadRow.source === "tasco" ? null : leadRow.parent_name,
            phone: leadRow.phone,
            email: leadRow.email,
            grade: leadRow.grade_raw,
            school: leadRow.school,
            opt_in: leadRow.opt_in,
            opt_in_editable: leadRow.source !== "camp",
          }}
          onChanged={() => {
            void mutateLeadRows();
            // Scheduling or canceling from inside the sheet changes
            // this very table — keep it in step.
            void mutate();
          }}
        />
      ) : null}
    </Card>
  );
}

/**
 * Searchable lead picker across all four recruitment sources — used
 * both to attach an orphaned booking to its lead and to choose who a
 * newly scheduled tour is for. `seed` pre-fills the search (the
 * booker's email, when linking) so the likely match is already on
 * screen.
 */
function LeadPickerDialog({
  open,
  title,
  description,
  seed,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  title: string;
  description: string;
  seed?: string;
  onOpenChange: (open: boolean) => void;
  onPick: (lead: AllLeadRow) => void | Promise<void>;
}) {
  const { data: leads, isLoading } = useSWR<AllLeadRow[]>(
    open ? "/api/admin/all-leads" : null,
    adminFetcher,
    { revalidateOnFocus: false }
  );

  const [query, setQuery] = useState("");
  // Re-seed each time the dialog opens — render-phase adjust, not an
  // effect (the repo lint bans setState in effects).
  const [prevOpen, setPrevOpen] = useState(false);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setQuery(seed ?? "");
  }

  const q = query.trim().toLowerCase();
  const qDigits = q.replace(/\D/g, "");
  const matches = (leads ?? [])
    .filter((l) => {
      if (!q) return true;
      return (
        l.parent_name.toLowerCase().includes(q) ||
        l.student_name.toLowerCase().includes(q) ||
        l.email.toLowerCase().includes(q) ||
        l.school.toLowerCase().includes(q) ||
        (qDigits.length >= 3 && l.phone.replace(/\D/g, "").includes(qDigits))
      );
    })
    .slice(0, 30);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by parent, student, email, phone, or school…"
            className="h-9 bg-white pl-8"
          />
        </div>
        <div className="max-h-[45vh] space-y-1 overflow-y-auto overscroll-contain">
          {isLoading && !leads ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading leads…
            </div>
          ) : matches.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {q
                ? "No leads match this search."
                : "No leads found."}
            </p>
          ) : (
            matches.map((l) => (
              <button
                key={l.key}
                type="button"
                onClick={() => void onPick(l)}
                className="w-full rounded-md border bg-white px-3 py-2 text-left transition-colors hover:bg-muted/50"
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate text-sm font-medium">
                    {l.parent_name || l.student_name || `#${l.id}`}
                  </span>
                  <span className="shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">
                    {LEAD_LABEL[l.source]}
                  </span>
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {[
                    l.student_name && l.parent_name
                      ? `Student: ${l.student_name}`
                      : null,
                    l.email || null,
                    formatUSPhone(l.phone) || null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "No contact info"}
                </span>
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Minimal reschedule dialog — new date + time; duration, location,
 *  and attendee carry over from the existing tour. */
function TourRescheduleDialog({
  row,
  onOpenChange,
  onSubmit,
}: {
  row: TourRow | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (scheduledAt: number) => void | Promise<void>;
}) {
  const [date, setDate] = useState("");
  const [time, setTime] = useState("10:00");

  // Seed from the tour being rescheduled when the dialog opens.
  const [prevId, setPrevId] = useState<number | null>(null);
  if ((row?.id ?? null) !== prevId) {
    setPrevId(row?.id ?? null);
    if (row) {
      const d = new Date(row.scheduled_at);
      setDate(
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
          d.getDate()
        ).padStart(2, "0")}`
      );
      setTime(msToTimeInput(row.scheduled_at) || "10:00");
    }
  }

  const scheduledAt = date ? timeInputToMs(date, time) : 0;

  return (
    <Dialog open={row !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Reschedule tour</DialogTitle>
          <DialogDescription>
            {row
              ? `${row.parent_name || row.student_name || "This family"} — currently ${row.when}. Google emails them the updated invite.`
              : ""}
          </DialogDescription>
        </DialogHeader>
        {/* Stacked, not side-by-side: the time control is three
            inputs wide and got crushed in a half-width column. */}
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="reschedule-date" className="text-xs">
              New date
            </Label>
            <Input
              id="reschedule-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="h-9 bg-white"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">New time</Label>
            <TimeSelect
              value={time}
              onChange={setTime}
              ariaLabel="New tour time"
              // A tour always has a time — no clear button.
              clearable={false}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={scheduledAt <= 0}
            onClick={() => void onSubmit(scheduledAt)}
          >
            Reschedule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

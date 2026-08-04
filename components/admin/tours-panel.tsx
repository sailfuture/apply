"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import {
  CalendarX2,
  Check,
  Link2,
  Link2Off,
  Loader2,
  MoreHorizontal,
  RefreshCw,
  Search,
  UserX,
} from "lucide-react";
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
  TOUR_RSVP_LABEL,
  TOUR_STATUS_LABEL,
  tourWhenLabel,
} from "@/lib/tours";
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

  // Upcoming (still-scheduled, soonest first) above history (newest
  // first) — one table, a status filter would hide the history admins
  // scan for "did they ever tour?".
  const sorted = useMemo(() => {
    const upcoming = rows
      .filter((r) => r.status === "scheduled")
      .sort((a, b) => a.scheduled_at - b.scheduled_at);
    const past = rows
      .filter((r) => r.status !== "scheduled")
      .sort((a, b) => b.scheduled_at - a.scheduled_at);
    return [...upcoming, ...past];
  }, [rows]);

  const [search, setSearch] = useState("");
  const [pendingAction, setPendingAction] = useState<number | null>(null);
  const [reschedule, setReschedule] = useState<TourRow | null>(null);
  const [linking, setLinking] = useState<TourRow | null>(null);
  const [syncing, setSyncing] = useState(false);

  // Clicking a tour opens ITS LEAD's triage sheet — the inquiry
  // details plus the full comms/activity log — rather than a
  // tour-only view: the tour is one event in that lead's story. The
  // all-leads fetch is lazy (first row click) like the Messages page.
  const [openLead, setOpenLead] = useState<{
    source: LeadNoteSource;
    id: number;
  } | null>(null);
  const { data: leadRows, mutate: mutateLeadRows } = useSWR<AllLeadRow[]>(
    openLead ? "/api/admin/all-leads" : null,
    adminFetcher,
    {
      revalidateOnFocus: false,
      onSuccess: (rows) => {
        const found =
          openLead &&
          rows.some(
            (l) => l.source === openLead.source && l.id === openLead.id
          );
        if (!found) {
          toast.error("Couldn't find this tour's lead record.");
          setOpenLead(null);
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
      const res = await fetch("/api/admin/tours/sync", { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? `Sync failed (${res.status})`);
      }
      const result: TourSyncResult = await res.json();
      const changed =
        result.imported + result.rsvpUpdated + result.canceled > 0;
      if (changed) await mutate();
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
      await mutate();
    } catch (err) {
      console.error("[ToursPanel.patchTour]", err);
      toast.error(
        err instanceof Error ? err.message : "Couldn't update the tour."
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
          <span className="text-xs text-muted-foreground">
            {TOUR_RSVP_LABEL[r.rsvp] ?? "No reply yet"}
          </span>
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
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      ),
    },
  ];

  const upcomingCount = rows.filter((r) => r.status === "scheduled").length;

  return (
    <Card className="overflow-hidden bg-white py-0 gap-0">
      <CardHeader className="py-4 border-b bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-base">
            Scheduled tours
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {upcomingCount} upcoming
            </span>
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="Search by parent, student, email, or location…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-full sm:w-72"
            />
            <Button
              variant="outline"
              className="bg-white"
              disabled={syncing}
              onClick={() => void runSync(true)}
              title="Pull website bookings and RSVP changes from Google Calendar"
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
      <CardContent className="p-4 bg-white">
        {error && !data ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            Couldn&rsquo;t load tours. Refresh to try again.
          </div>
        ) : sorted.length === 0 && !isLoading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No tours yet. Schedule one from a lead&rsquo;s sheet on All
            Leads (or a visitor sheet on Liability Waiver Visits).
          </div>
        ) : (
          <DataTable<TourRow>
            columns={columns}
            data={sorted}
            isLoading={isLoading && !data}
            externalSearch={search}
            // A tour is one event in a lead's story, so the row opens
            // that lead's details + activity. An unlinked tour has no
            // lead to open — offer the picker instead of doing
            // nothing, which would read as a broken row.
            onRowClick={(r) => {
              if (r.lead) setOpenLead(r.lead);
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
        )}
      </CardContent>

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

      <TourLinkDialog
        row={linking}
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
              : "Tour linked — it now shows on that lead's timeline."
          );
        }}
      />

      {/* The clicked tour's lead — the same triage sheet All Leads
          and the dashboard use: details, stars, tour section, and the
          full comms/activity log. */}
      {leadRow ? (
        <LeadTriageSheet
          open
          onOpenChange={(o) => !o && setOpenLead(null)}
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
 * Pick which lead an unlinked tour belongs to — searchable across all
 * four sources, seeded with the booker's email so the likely match is
 * on screen immediately. Picking PATCHes `action: "link"`, which also
 * writes the "tour linked" note onto that lead's comms log.
 */
function TourLinkDialog({
  row,
  onOpenChange,
  onPick,
}: {
  row: TourRow | null;
  onOpenChange: (open: boolean) => void;
  onPick: (lead: { source: LeadNoteSource; id: number }) => void | Promise<void>;
}) {
  const { data: leads, isLoading } = useSWR<AllLeadRow[]>(
    row ? "/api/admin/all-leads" : null,
    adminFetcher,
    { revalidateOnFocus: false }
  );

  const [query, setQuery] = useState("");
  // Seed the search with the booker's email (else name) when the
  // dialog opens for a tour — render-phase adjust on row change.
  const [prevRowId, setPrevRowId] = useState<number | null>(null);
  if ((row?.id ?? null) !== prevRowId) {
    setPrevRowId(row?.id ?? null);
    setQuery(row ? row.parent_email || row.parent_name : "");
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
    <Dialog open={row !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Link tour to a lead</DialogTitle>
          <DialogDescription>
            {row
              ? `${row.parent_name || row.parent_email || "This booking"} — ${row.when}. Pick the lead this tour belongs to; it will appear on their timeline.`
              : ""}
          </DialogDescription>
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
                onClick={() => void onPick({ source: l.source, id: l.id })}
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
        <div className="grid grid-cols-2 gap-3">
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

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import {
  CalendarX2,
  Check,
  Loader2,
  MoreHorizontal,
  RefreshCw,
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
import { adminFetcher } from "@/lib/admin-fetcher";
import { formatUSPhone } from "@/lib/phone";
import {
  TOUR_RSVP_LABEL,
  TOUR_STATUS_LABEL,
  tourWhenLabel,
} from "@/lib/tours";
import { liveTourEventId, type XanoTour } from "@/lib/xano";
import type { ToursResponse } from "@/app/api/admin/tours/route";
import type { TourSyncResult } from "@/app/api/admin/tours/sync/route";
import { cn } from "@/lib/utils";

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
  const [syncing, setSyncing] = useState(false);

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
      width: "w-[19%]",
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
      width: "w-[18%]",
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
      width: "w-[13%]",
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
      render: (r) =>
        r.status === "scheduled" ? (
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
            <DropdownMenuContent align="end">
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
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null,
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
            Leads (or the visitor sheet on the Waivers tab).
          </div>
        ) : (
          <DataTable<TourRow>
            columns={columns}
            data={sorted}
            isLoading={isLoading && !data}
            externalSearch={search}
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
    </Card>
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

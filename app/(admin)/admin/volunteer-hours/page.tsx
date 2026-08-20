"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import {
  Bell,
  Check,
  ChevronRight,
  Loader2,
  MapPin,
  Pencil,
  Plus,
  Trash2,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { adminFetcher } from "@/lib/admin-fetcher";
import { isSignUpEvent, isUnlimitedSpots } from "@/lib/school-calendar";
import { cn } from "@/lib/utils";
import {
  EventUpsertDialog,
  eventColor,
} from "@/components/admin/event-upsert-dialog";
import { EventReminderDialog } from "@/components/admin/event-reminder-dialog";
import type {
  AdminVolunteerHoursResponse,
  EventRsvpRow,
  VolunteerEvent,
  VolunteerFamily,
} from "@/app/api/admin/volunteer-hours/route";
import type { XanoVolunteerHours } from "@/lib/xano";

/** Annual goal — in lockstep with the parent dashboard's constant so
 *  both surfaces show the same target. */
const HOURS_GOAL = 40;

/** Trim trailing zeros so whole hours read as "12" not "12.00". */
function formatHours(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2).replace(/\.?0+$/, "");
}

/** "YYYY-MM-DD" → "Aug 26, 2026" without the UTC off-by-one. */
function fmtDate(iso: string): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Admissions → Volunteer Hours. The admin workspace for the family
 * volunteer-hours program:
 *   - per-family progress toward the 40-hour annual minimum
 *     (approved hours only, matching the parent dashboard)
 *   - review queue for unapproved entries
 *   - parent events pulled from the school calendar — create/edit
 *     events here (shared dialog with the calendar page) and credit
 *     specific families as attendees, which writes approved hour
 *     entries linked to the event.
 */
export default function AdminVolunteerHoursPage() {
  const searchParams = useSearchParams();
  const yearIdParam = searchParams.get("yearId");
  const yearId = Number(yearIdParam) || 0;

  const { data, error, isLoading, isValidating, mutate } =
    useSWR<AdminVolunteerHoursResponse>(
      yearId ? `/api/admin/volunteer-hours?yearId=${yearId}` : null,
      adminFetcher
    );
  // True while a revalidation is in flight AFTER a dialog save calls
  // `mutate()` (first load renders skeletons via `isLoading` instead).
  // Drives the dim-and-pulse on the tables below so an edit visibly
  // "lands" — without it the page sits on stale rows for a second or
  // two and the change appears to have been swallowed.
  const refreshing = isValidating && !isLoading;
  const entries = useMemo(() => data?.entries ?? [], [data]);
  const families = useMemo(() => data?.families ?? [], [data]);
  const events = useMemo(() => data?.events ?? [], [data]);
  const days = useMemo(() => data?.days ?? [], [data]);
  const rsvps = useMemo(() => data?.rsvps ?? [], [data]);

  /** event id → its RSVP rows (family name, spots, comment). */
  const rsvpsByEvent = useMemo(() => {
    const m = new Map<number, EventRsvpRow[]>();
    for (const r of rsvps) {
      const list = m.get(r.school_calendar_events_id) ?? [];
      list.push(r);
      m.set(r.school_calendar_events_id, list);
    }
    return m;
  }, [rsvps]);
  /** Event whose RSVP list dialog is open. */
  const [rsvpListEvent, setRsvpListEvent] = useState<VolunteerEvent | null>(
    null
  );

  const familyById = useMemo(
    () => new Map(families.map((f) => [f.id, f])),
    [families]
  );
  const eventById = useMemo(
    () => new Map(events.map((e) => [e.id, e])),
    [events]
  );
  const entriesByFamily = useMemo(() => {
    const m = new Map<number, XanoVolunteerHours[]>();
    for (const e of entries) {
      const list = m.get(e.registration_families_id) ?? [];
      list.push(e);
      m.set(e.registration_families_id, list);
    }
    return m;
  }, [entries]);
  const entriesByEvent = useMemo(() => {
    const m = new Map<number, XanoVolunteerHours[]>();
    for (const e of entries) {
      const evId = Number(e.school_calendar_events_id);
      if (!evId) continue;
      const list = m.get(evId) ?? [];
      list.push(e);
      m.set(evId, list);
    }
    return m;
  }, [entries]);

  /** Family progress rows: every enrolled family (even with zero
   *  entries), plus any non-enrolled family that has entries. Least
   *  progress first so at-risk families surface. */
  const familyRows = useMemo(() => {
    const rows: Array<{
      family: VolunteerFamily;
      approved: number;
      pending: number;
    }> = [];
    const seen = new Set<number>();
    for (const f of families) {
      const hasEntries = (entriesByFamily.get(f.id) ?? []).length > 0;
      if (!f.enrolled && !hasEntries) continue;
      seen.add(f.id);
      const list = entriesByFamily.get(f.id) ?? [];
      rows.push({
        family: f,
        approved: list
          .filter((e) => e.is_approved)
          .reduce((s, e) => s + (Number(e.hours) || 0), 0),
        pending: list
          .filter((e) => !e.is_approved)
          .reduce((s, e) => s + (Number(e.hours) || 0), 0),
      });
    }
    rows.sort(
      (a, b) =>
        Number(b.family.enrolled) - Number(a.family.enrolled) ||
        a.approved - b.approved ||
        a.family.name.localeCompare(b.family.name)
    );
    return rows;
  }, [families, entriesByFamily]);

  const pendingEntries = useMemo(
    () => entries.filter((e) => !e.is_approved),
    [entries]
  );
  const parentEvents = useMemo(
    () => events.filter((e) => e.parent_volunteer_hours),
    [events]
  );
  const stats = useMemo(() => {
    const enrolled = familyRows.filter((r) => r.family.enrolled);
    return {
      enrolledCount: enrolled.length,
      atGoal: enrolled.filter((r) => r.approved >= HOURS_GOAL).length,
      approvedTotal: enrolled.reduce((s, r) => s + r.approved, 0),
      pendingCount: pendingEntries.length,
    };
  }, [familyRows, pendingEntries]);

  // ── UI state ──
  const [openFamilyId, setOpenFamilyId] = useState<number | null>(null);
  const openFamily = openFamilyId ? (familyById.get(openFamilyId) ?? null) : null;
  const [entryEdit, setEntryEdit] = useState<{
    familyId: number;
    existing: XanoVolunteerHours | null;
  } | null>(null);
  const [attendeesEvent, setAttendeesEvent] =
    useState<VolunteerEvent | null>(null);
  const [eventEdit, setEventEdit] = useState<
    { event: VolunteerEvent } | "new" | null
  >(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [remindEvent, setRemindEvent] = useState<VolunteerEvent | null>(
    null
  );
  const [deleteTarget, setDeleteTarget] =
    useState<XanoVolunteerHours | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [approvingId, setApprovingId] = useState<number | null>(null);

  async function setApproved(entry: XanoVolunteerHours, approved: boolean) {
    if (approvingId) return;
    setApprovingId(entry.id);
    try {
      const res = await fetch(`/api/admin/volunteer-hours/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_approved: approved }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? `Update failed (${res.status})`);
      }
      await mutate();
      toast.success(approved ? "Entry approved." : "Approval removed.");
    } catch (err) {
      console.error("Failed to update approval:", err);
      toast.error(
        err instanceof Error ? err.message : "Couldn't update entry."
      );
    } finally {
      setApprovingId(null);
    }
  }

  async function deleteEntry() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      const res = await fetch(
        `/api/admin/volunteer-hours/${deleteTarget.id}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? `Delete failed (${res.status})`);
      }
      await mutate();
      toast.success("Entry deleted.");
      setDeleteTarget(null);
    } catch (err) {
      console.error("Failed to delete entry:", err);
      toast.error(
        err instanceof Error ? err.message : "Couldn't delete entry."
      );
    } finally {
      setDeleting(false);
    }
  }

  const sourceLabel = (e: XanoVolunteerHours): string => {
    const ev = eventById.get(Number(e.school_calendar_events_id));
    // Manual entries surface their note as the source ("rising junior
    // meeting w/ Mr. Angelo") — "Manual" only when no note was left.
    // (" " is the cleared-note sentinel; trim() folds it to empty.)
    const note = (e.note ?? "").trim();
    if (ev) return note ? `${ev.title} — ${note}` : ev.title;
    return note || "Manual";
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Volunteer Hours</h1>
          <p className="text-sm text-muted-foreground">
            Track each enrolled family&rsquo;s progress toward the{" "}
            {HOURS_GOAL}-hour annual minimum, review submitted hours, and
            credit families for parent events.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="bg-white"
            disabled={families.length === 0}
            onClick={() => setBulkOpen(true)}
          >
            <Plus className="size-3.5 mr-1" />
            Add hours
          </Button>
          <Button
            size="sm"
            disabled={days.length === 0}
            onClick={() => setEventEdit("new")}
          >
            <Plus className="size-4 mr-1" />
            New event
          </Button>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
          Failed to load volunteer hours:{" "}
          {error instanceof Error ? error.message : "unknown error"}
        </div>
      ) : null}

      {!yearId ? (
        <div className="rounded-lg border bg-white px-6 py-12 text-center text-sm text-muted-foreground">
          Pick a school year above to view volunteer hours.
        </div>
      ) : isLoading && !data ? (
        <div className="flex justify-center rounded-lg border bg-white px-6 py-16">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {/* ── Stat row ── */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              label="Enrolled families"
              value={String(stats.enrolledCount)}
            />
            <StatCard
              label={`At ${HOURS_GOAL}-hour goal`}
              value={`${stats.atGoal} / ${stats.enrolledCount}`}
            />
            <StatCard
              label="Approved hours (enrolled)"
              value={formatHours(stats.approvedTotal)}
            />
            <StatCard
              label="Pending review"
              value={String(stats.pendingCount)}
              highlight={stats.pendingCount > 0}
            />
          </div>

          {/* ── Pending review ── */}
          {pendingEntries.length > 0 ? (
            <Card className="bg-white py-0 gap-0 overflow-hidden">
              <CardHeader className="border-b py-4">
                <CardTitle className="text-base">
                  Pending review ({pendingEntries.length})
                </CardTitle>
              </CardHeader>
              <CardContent
                aria-busy={refreshing}
                className={cn(
                  "p-0 transition-opacity",
                  refreshing && "opacity-50 animate-pulse"
                )}
              >
                <Table className="[&_th]:px-4 [&_td]:px-4 [&_td]:py-3">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Family</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead className="text-right">Hours</TableHead>
                      <TableHead className="w-32">
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pendingEntries.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="font-medium">
                          {familyById.get(e.registration_families_id)
                            ?.name ?? `Family #${e.registration_families_id}`}
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {fmtDate(e.entry_date)}
                        </TableCell>
                        <TableCell className="max-w-48 truncate">
                          {sourceLabel(e)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatHours(Number(e.hours) || 0)}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              size="sm"
                              className="h-7 px-2"
                              disabled={approvingId === e.id}
                              onClick={() => void setApproved(e, true)}
                            >
                              {approvingId === e.id ? (
                                <Loader2 className="size-3.5 animate-spin" />
                              ) : (
                                <>
                                  <Check className="size-3.5 mr-1" />
                                  Approve
                                </>
                              )}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="size-7 p-0"
                              onClick={() =>
                                setEntryEdit({
                                  familyId: e.registration_families_id,
                                  existing: e,
                                })
                              }
                              aria-label="Edit entry"
                            >
                              <Pencil className="size-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="size-7 p-0 text-red-600 hover:text-red-700"
                              onClick={() => setDeleteTarget(e)}
                              aria-label="Delete entry"
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : null}

          {/* ── Parent events ── */}
          <Card className="bg-white py-0 gap-0 overflow-hidden">
            <CardHeader className="border-b py-4">
              <CardTitle className="text-base">
                Parent events ({parentEvents.length})
              </CardTitle>
            </CardHeader>
            <CardContent
              aria-busy={refreshing}
              className={cn(
                "p-0 transition-opacity",
                refreshing && "opacity-50 animate-pulse"
              )}
            >
              <Table className="[&_th]:px-4 [&_td]:px-4 [&_td]:py-3">
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Event</TableHead>
                    <TableHead className="text-right">Credit</TableHead>
                    <TableHead className="text-right">RSVPs</TableHead>
                    <TableHead className="text-right">
                      Families credited
                    </TableHead>
                    <TableHead className="w-56">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parentEvents.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="py-6 text-center text-sm text-muted-foreground"
                      >
                        No volunteer-credit events on the calendar yet —
                        use New event and turn on &ldquo;Counts toward
                        parent volunteer hours&rdquo;.
                      </TableCell>
                    </TableRow>
                  ) : (
                    parentEvents.map((ev) => {
                      const c = eventColor(ev.color);
                      const credited =
                        entriesByEvent.get(ev.id)?.length ?? 0;
                      const evRsvps = rsvpsByEvent.get(ev.id) ?? [];
                      const spotsReserved = evRsvps.reduce(
                        (s, r) => s + r.spots,
                        0
                      );
                      return (
                        <TableRow key={ev.id}>
                          <TableCell className="whitespace-nowrap tabular-nums">
                            {fmtDate(ev.date)}
                          </TableCell>
                          <TableCell>
                            <span className="flex min-w-0 items-center gap-1.5 font-medium">
                              <span
                                className={cn(
                                  "size-2 shrink-0 rounded-full",
                                  c ? c.dot : "bg-slate-300"
                                )}
                              />
                              <span className="truncate">{ev.title}</span>
                            </span>
                            {ev.location ? (
                              <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                                <MapPin className="mr-0.5 inline size-3" />
                                {ev.location}
                              </span>
                            ) : null}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatHours(ev.volunteer_hour_total || 0)} hrs
                          </TableCell>
                          <TableCell className="text-right">
                            {isSignUpEvent(ev.parent_spots) ||
                            evRsvps.length > 0 ? (
                              <button
                                type="button"
                                onClick={() => setRsvpListEvent(ev)}
                                className={cn(
                                  "tabular-nums underline-offset-2 hover:underline",
                                  spotsReserved > 0
                                    ? "font-medium text-foreground"
                                    : "text-muted-foreground"
                                )}
                                title="View sign-ups"
                              >
                                {spotsReserved}
                                {isUnlimitedSpots(ev.parent_spots)
                                  ? " / ∞"
                                  : (ev.parent_spots ?? 0) > 0
                                    ? ` / ${ev.parent_spots}`
                                    : ""}
                              </button>
                            ) : (
                              // No capacity set → parents can't sign up.
                              // Say so plainly; a bare dash read as
                              // "nothing here" and hid the feature.
                              <span
                                className="text-xs text-muted-foreground"
                                title="Set “Parent sign-up spots” on this event to open RSVPs"
                              >
                                Sign-ups off
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {credited}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 bg-white px-2"
                                onClick={() => setAttendeesEvent(ev)}
                              >
                                <Users className="size-3.5 mr-1" />
                                Attendees
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 bg-white px-2"
                                onClick={() => setRemindEvent(ev)}
                              >
                                <Bell className="size-3.5 mr-1" />
                                Send SMS
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="size-7 p-0"
                                onClick={() => setEventEdit({ event: ev })}
                                aria-label={`Edit ${ev.title}`}
                              >
                                <Pencil className="size-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          {/* ── Family progress ── */}
          <Card className="bg-white py-0 gap-0 overflow-hidden">
            <CardHeader className="border-b py-4">
              <CardTitle className="text-base">
                Family progress ({familyRows.length})
              </CardTitle>
            </CardHeader>
            <CardContent
              aria-busy={refreshing}
              className={cn(
                "p-0 transition-opacity",
                refreshing && "opacity-50 animate-pulse"
              )}
            >
              <Table className="[&_th]:px-4 [&_td]:px-4 [&_td]:py-3">
                <TableHeader>
                  <TableRow>
                    <TableHead>Family</TableHead>
                    <TableHead className="text-right">Approved</TableHead>
                    <TableHead className="text-right">Pending</TableHead>
                    <TableHead className="w-64">
                      Progress to {HOURS_GOAL} hrs
                    </TableHead>
                    <TableHead className="w-10">
                      <span className="sr-only">Open</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {familyRows.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        className="py-6 text-center text-sm text-muted-foreground"
                      >
                        No enrolled families for this school year yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    familyRows.map(({ family, approved, pending }) => {
                      const pct = Math.min(
                        100,
                        (approved / HOURS_GOAL) * 100
                      );
                      const atGoal = approved >= HOURS_GOAL;
                      return (
                        <TableRow
                          key={family.id}
                          className="cursor-pointer"
                          onClick={() => setOpenFamilyId(family.id)}
                        >
                          <TableCell className="font-medium">
                            {family.name}
                            {!family.enrolled ? (
                              <span className="ml-1.5 rounded-full border px-1.5 py-px text-[10px] font-medium text-muted-foreground align-middle">
                                Not enrolled
                              </span>
                            ) : null}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatHours(approved)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">
                            {pending ? formatHours(pending) : "—"}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                                <div
                                  className={cn(
                                    "h-full rounded-full",
                                    atGoal
                                      ? "bg-emerald-500"
                                      : "bg-foreground/70"
                                  )}
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              <span
                                className={cn(
                                  "w-16 shrink-0 text-right text-xs tabular-nums",
                                  atGoal
                                    ? "font-medium text-emerald-700"
                                    : "text-muted-foreground"
                                )}
                              >
                                {formatHours(approved)} / {HOURS_GOAL}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <ChevronRight className="size-4 text-muted-foreground" />
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

        </>
      )}

      {/* ── Family entries sheet ── */}
      {openFamily ? (
        <FamilySheet
          key={openFamily.id}
          family={openFamily}
          entries={entriesByFamily.get(openFamily.id) ?? []}
          sourceLabel={sourceLabel}
          approvingId={approvingId}
          onApprove={(e, v) => void setApproved(e, v)}
          onAdd={() =>
            setEntryEdit({ familyId: openFamily.id, existing: null })
          }
          onEdit={(e) =>
            setEntryEdit({ familyId: openFamily.id, existing: e })
          }
          onDelete={(e) => setDeleteTarget(e)}
          onClose={() => setOpenFamilyId(null)}
        />
      ) : null}

      {/* ── Add/edit entry ── */}
      {entryEdit ? (
        <EntryDialog
          key={entryEdit.existing?.id ?? `new-${entryEdit.familyId}`}
          yearId={yearId}
          familyName={
            familyById.get(entryEdit.familyId)?.name ??
            `Family #${entryEdit.familyId}`
          }
          familyId={entryEdit.familyId}
          events={events}
          existing={entryEdit.existing}
          onDone={(saved) => {
            setEntryEdit(null);
            if (saved) void mutate();
          }}
        />
      ) : null}

      {/* ── Event attendees ── */}
      {attendeesEvent ? (
        <AttendeesDialog
          key={attendeesEvent.id}
          yearId={yearId}
          event={attendeesEvent}
          families={families}
          eventEntries={entriesByEvent.get(attendeesEvent.id) ?? []}
          familyById={familyById}
          onDelete={(e) => setDeleteTarget(e)}
          onDone={(changed) => {
            setAttendeesEvent(null);
            if (changed) void mutate();
          }}
        />
      ) : null}

      {/* ── Bulk hours for many families ── */}
      {bulkOpen ? (
        <BulkHoursDialog
          yearId={yearId}
          families={families}
          events={events}
          onDone={(saved) => {
            setBulkOpen(false);
            if (saved) void mutate();
          }}
        />
      ) : null}

      {/* ── Event reminder text ── */}
      {remindEvent ? (
        <EventReminderDialog
          key={remindEvent.id}
          yearId={yearId}
          event={remindEvent}
          onDone={() => setRemindEvent(null)}
        />
      ) : null}

      {/* ── Event RSVP list (parent sign-ups) ── */}
      {rsvpListEvent ? (
        <RsvpListDialog
          key={rsvpListEvent.id}
          event={rsvpListEvent}
          rsvps={rsvpsByEvent.get(rsvpListEvent.id) ?? []}
          onClose={() => setRsvpListEvent(null)}
        />
      ) : null}

      {/* ── Create/edit calendar event (shared dialog) ── */}
      {eventEdit ? (
        <EventUpsertDialog
          days={days}
          existing={
            eventEdit === "new"
              ? null
              : { event: eventEdit.event, date: eventEdit.event.date }
          }
          defaultVolunteer
          onDone={(saved) => {
            setEventEdit(null);
            if (saved) void mutate();
          }}
        />
      ) : null}

      {/* ── Delete entry confirm ── */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => !deleting && !o && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this entry?</AlertDialogTitle>
            <AlertDialogDescription>
              Removes {formatHours(Number(deleteTarget?.hours) || 0)}{" "}
              hours ({deleteTarget ? sourceLabel(deleteTarget) : ""}) from{" "}
              {deleteTarget
                ? (familyById.get(deleteTarget.registration_families_id)
                    ?.name ?? "this family")
                : "this family"}
              . This can&rsquo;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>
              Keep entry
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700"
              onClick={(e) => {
                e.preventDefault();
                void deleteEntry();
              }}
            >
              {deleting ? "Deleting…" : "Delete entry"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function StatCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <Card className="bg-white py-0">
      <CardContent className="px-4 py-3">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p
          className={cn(
            "text-xl font-bold tabular-nums",
            highlight && "text-amber-600"
          )}
        >
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

/* ── Family entries sheet ─────────────────────────────────────────── */

function FamilySheet({
  family,
  entries,
  sourceLabel,
  approvingId,
  onApprove,
  onAdd,
  onEdit,
  onDelete,
  onClose,
}: {
  family: VolunteerFamily;
  entries: XanoVolunteerHours[];
  sourceLabel: (e: XanoVolunteerHours) => string;
  approvingId: number | null;
  onApprove: (e: XanoVolunteerHours, approved: boolean) => void;
  onAdd: () => void;
  onEdit: (e: XanoVolunteerHours) => void;
  onDelete: (e: XanoVolunteerHours) => void;
  onClose: () => void;
}) {
  const approved = entries
    .filter((e) => e.is_approved)
    .reduce((s, e) => s + (Number(e.hours) || 0), 0);
  const pending = entries
    .filter((e) => !e.is_approved)
    .reduce((s, e) => s + (Number(e.hours) || 0), 0);

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-y-auto overscroll-contain p-0 sm:max-w-lg"
      >
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle className="text-base">{family.name}</SheetTitle>
          <SheetDescription className="text-xs">
            {formatHours(approved)} of {HOURS_GOAL} hours approved
            {pending ? ` · ${formatHours(pending)} pending` : ""}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-3 px-4 py-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Entries ({entries.length})
            </h3>
            <Button
              variant="outline"
              size="sm"
              className="bg-white"
              onClick={onAdd}
            >
              <Plus className="size-3.5 mr-1" />
              Add entry
            </Button>
          </div>

          {entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No hours logged for this family yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {[...entries]
                .sort((a, b) =>
                  (b.entry_date ?? "").localeCompare(a.entry_date ?? "")
                )
                .map((e) => (
                  <li
                    key={e.id}
                    className="rounded-md border bg-muted/10 px-3 py-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">
                          {formatHours(Number(e.hours) || 0)} hrs
                          <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                            · {fmtDate(e.entry_date)}
                          </span>
                          {e.is_approved ? (
                            <span className="ml-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-emerald-700 align-middle">
                              Approved
                            </span>
                          ) : (
                            <span className="ml-1.5 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-amber-700 align-middle">
                              Pending
                            </span>
                          )}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {sourceLabel(e)}
                          {e.is_approved && e.is_approved_admin?.trim()
                            ? ` · approved by ${e.is_approved_admin.trim()}`
                            : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          variant={e.is_approved ? "ghost" : "default"}
                          size="sm"
                          className={cn(
                            "h-7 px-2",
                            e.is_approved && "text-muted-foreground"
                          )}
                          disabled={approvingId === e.id}
                          onClick={() => onApprove(e, !e.is_approved)}
                        >
                          {approvingId === e.id ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : e.is_approved ? (
                            "Unapprove"
                          ) : (
                            <>
                              <Check className="size-3.5 mr-1" />
                              Approve
                            </>
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="size-7 p-0"
                          onClick={() => onEdit(e)}
                          aria-label="Edit entry"
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="size-7 p-0 text-red-600 hover:text-red-700"
                          onClick={() => onDelete(e)}
                          aria-label="Delete entry"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </div>
                  </li>
                ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ── Add/edit entry dialog ────────────────────────────────────────── */

function EntryDialog({
  yearId,
  familyId,
  familyName,
  events,
  existing,
  onDone,
}: {
  yearId: number;
  familyId: number;
  familyName: string;
  events: VolunteerEvent[];
  /** Null = creating a new entry. */
  existing: XanoVolunteerHours | null;
  onDone: (saved: boolean) => void;
}) {
  const [date, setDate] = useState(existing?.entry_date ?? "");
  const [hours, setHours] = useState(
    existing ? String(existing.hours) : ""
  );
  const [eventId, setEventId] = useState(
    String(existing?.school_calendar_events_id || 0)
  );
  const [note, setNote] = useState((existing?.note ?? "").trim());
  const [approved, setApproved] = useState(
    existing ? existing.is_approved === true : true
  );
  const [saving, setSaving] = useState(false);

  /** Linking an event conveniently prefills its date and credit. */
  function pickEvent(v: string) {
    setEventId(v);
    const ev = events.find((e) => e.id === Number(v));
    if (ev) {
      if (!date) setDate(ev.date);
      if (!hours && ev.volunteer_hour_total) {
        setHours(String(ev.volunteer_hour_total));
      }
    }
  }

  const hoursNum = Number(hours);
  const valid =
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(hoursNum) &&
    hoursNum > 0;

  async function save() {
    if (!valid || saving) return;
    setSaving(true);
    try {
      const res = existing
        ? await fetch(`/api/admin/volunteer-hours/${existing.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              hours: hoursNum,
              entry_date: date,
              school_calendar_events_id: Number(eventId) || 0,
              is_approved: approved,
              note: note.trim(),
            }),
          })
        : await fetch("/api/admin/volunteer-hours", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              yearId,
              familyIds: [familyId],
              hours: hoursNum,
              entryDate: date,
              eventId: Number(eventId) || 0,
              approved,
              note: note.trim(),
            }),
          });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? `Save failed (${res.status})`);
      }
      toast.success(existing ? "Entry updated." : "Entry added.");
      onDone(true);
    } catch (err) {
      console.error("Failed to save entry:", err);
      toast.error(
        err instanceof Error ? err.message : "Couldn't save entry."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !saving && !o && onDone(false)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {existing ? "Edit entry" : "Add hours"} · {familyName}
          </DialogTitle>
          <DialogDescription>
            {existing
              ? "Update this volunteer-hours entry."
              : "Log volunteer hours for this family."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Linked event (optional)</Label>
            <Select value={eventId} onValueChange={pickEvent}>
              <SelectTrigger className="w-full bg-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-64">
                <SelectItem value="0">No event — manual entry</SelectItem>
                {events.map((ev) => (
                  <SelectItem key={ev.id} value={String(ev.id)}>
                    {fmtDate(ev.date)} · {ev.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Date</Label>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Hours</Label>
              <Input
                type="number"
                min="0"
                step="0.5"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                placeholder="2"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Note (optional)</Label>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              placeholder="e.g. rising junior meeting w/ Mr. Angelo"
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="entry-approved" className="text-xs font-normal">
              Approved (counts toward the {HOURS_GOAL}-hour goal)
            </Label>
            <Switch
              id="entry-approved"
              size="sm"
              checked={approved}
              onCheckedChange={setApproved}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            className="bg-white"
            disabled={saving}
            onClick={() => onDone(false)}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => void save()}
            disabled={saving || !valid}
          >
            {saving ? (
              <>
                <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                Saving
              </>
            ) : (
              "Save"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Event attendees dialog ───────────────────────────────────────── */

/**
 * Credit families for one parent event: shows who's already credited
 * (with per-entry delete), and a searchable checkbox list of families
 * to add — one approved, event-linked hours entry per family, dated
 * to the event.
 */
function AttendeesDialog({
  yearId,
  event,
  families,
  eventEntries,
  familyById,
  onDelete,
  onDone,
}: {
  yearId: number;
  event: VolunteerEvent;
  families: VolunteerFamily[];
  eventEntries: XanoVolunteerHours[];
  familyById: Map<number, VolunteerFamily>;
  onDelete: (e: XanoVolunteerHours) => void;
  onDone: (changed: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [hours, setHours] = useState(
    event.volunteer_hour_total ? String(event.volunteer_hour_total) : ""
  );
  const [saving, setSaving] = useState(false);

  const creditedIds = useMemo(
    () => new Set(eventEntries.map((e) => e.registration_families_id)),
    [eventEntries]
  );
  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return families
      .filter((f) => f.enrolled && !creditedIds.has(f.id))
      .filter(
        (f) =>
          !q ||
          f.name.toLowerCase().includes(q) ||
          // Students match too — "searching for a student" should
          // find their family, not just the family name.
          f.students.toLowerCase().includes(q)
      );
  }, [families, creditedIds, query]);

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const hoursNum = Number(hours);
  const canAdd =
    selected.size > 0 && Number.isFinite(hoursNum) && hoursNum > 0;

  async function addAttendees() {
    if (!canAdd || saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/volunteer-hours", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          yearId,
          familyIds: [...selected],
          hours: hoursNum,
          entryDate: event.date,
          eventId: event.id,
          approved: true,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? `Save failed (${res.status})`);
      }
      toast.success(
        `Credited ${selected.size} famil${selected.size === 1 ? "y" : "ies"} ${formatHours(hoursNum)} hours.`
      );
      onDone(true);
    } catch (err) {
      console.error("Failed to credit attendees:", err);
      toast.error(
        err instanceof Error ? err.message : "Couldn't credit families."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !saving && !o && onDone(false)}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="border-b px-5 py-4 pr-12">
          <DialogTitle>Attendees · {event.title}</DialogTitle>
          <DialogDescription>
            {fmtDate(event.date)} · credits{" "}
            {formatHours(event.volunteer_hour_total || 0)} hours by
            default. Added families get an approved entry linked to this
            event.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 py-4">
          {/* Already credited */}
          {eventEntries.length > 0 ? (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Credited ({eventEntries.length})
              </h3>
              <ul className="space-y-1">
                {eventEntries.map((e) => (
                  <li
                    key={e.id}
                    className="flex items-center justify-between gap-2 rounded-md border bg-muted/10 px-3 py-1.5"
                  >
                    <span className="min-w-0 truncate text-sm">
                      {familyById.get(e.registration_families_id)?.name ??
                        `Family #${e.registration_families_id}`}
                      <span className="ml-1.5 text-xs text-muted-foreground">
                        {formatHours(Number(e.hours) || 0)} hrs
                        {!e.is_approved ? " · pending" : ""}
                      </span>
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="size-6 shrink-0 p-0 text-red-600 hover:text-red-700"
                      onClick={() => onDelete(e)}
                      aria-label="Remove credit"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* Add families */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Add families
              </h3>
              <div className="flex items-center gap-3 text-xs">
                <button
                  type="button"
                  className="font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  onClick={() =>
                    setSelected(new Set(candidates.map((f) => f.id)))
                  }
                >
                  Select all shown
                </button>
                {selected.size > 0 ? (
                  <button
                    type="button"
                    className="font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                    onClick={() => setSelected(new Set())}
                  >
                    Clear
                  </button>
                ) : null}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search enrolled families…"
                type="search"
                autoComplete="off"
                className="flex-1"
              />
              <div className="flex w-28 shrink-0 items-center gap-1.5">
                <Input
                  type="number"
                  min="0"
                  step="0.5"
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                  aria-label="Hours to credit"
                />
                <span className="text-xs text-muted-foreground">hrs</span>
              </div>
            </div>
            {candidates.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">
                {query
                  ? "No matching families."
                  : "Every enrolled family is already credited."}
              </p>
            ) : (
              <ul className="max-h-64 space-y-0.5 overflow-y-auto overscroll-contain rounded-md border p-1">
                {candidates.map((f) => {
                  const on = selected.has(f.id);
                  return (
                    <li key={f.id}>
                      <button
                        type="button"
                        onClick={() => toggle(f.id)}
                        aria-pressed={on}
                        className={cn(
                          "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors",
                          on ? "bg-muted" : "hover:bg-muted/50"
                        )}
                      >
                        <span
                          className={cn(
                            "flex size-4 shrink-0 items-center justify-center rounded border",
                            on
                              ? "border-foreground bg-foreground text-background"
                              : "border-border bg-white"
                          )}
                        >
                          {on ? <Check className="size-3" /> : null}
                        </span>
                        <span className="min-w-0 flex-1 truncate">
                          {f.name}
                          {f.students ? (
                            <span className="text-xs text-muted-foreground">
                              {" "}
                              · {f.students}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        <DialogFooter className="border-t px-5 py-3">
          <Button
            variant="outline"
            size="sm"
            className="bg-white"
            disabled={saving}
            onClick={() => onDone(false)}
          >
            Close
          </Button>
          <Button
            size="sm"
            disabled={saving || !canAdd}
            onClick={() => void addAttendees()}
          >
            {saving ? (
              <>
                <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                Crediting
              </>
            ) : (
              `Credit ${selected.size || ""} ${selected.size === 1 ? "family" : "families"}`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Bulk hours dialog ────────────────────────────────────────────── */

/**
 * Log the same hours for MANY families at once without an event
 * context — search + select-all over enrolled families, one date +
 * hours amount, optional event link (which prefills date and credit).
 */
function BulkHoursDialog({
  yearId,
  families,
  events,
  onDone,
}: {
  yearId: number;
  families: VolunteerFamily[];
  events: VolunteerEvent[];
  onDone: (saved: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [date, setDate] = useState("");
  const [hours, setHours] = useState("");
  const [eventId, setEventId] = useState("0");
  const [note, setNote] = useState("");
  const [approved, setApproved] = useState(true);
  const [saving, setSaving] = useState(false);

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return families
      .filter((f) => f.enrolled)
      .filter(
        (f) =>
          !q ||
          f.name.toLowerCase().includes(q) ||
          f.students.toLowerCase().includes(q)
      );
  }, [families, query]);

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function pickEvent(v: string) {
    setEventId(v);
    const ev = events.find((e) => e.id === Number(v));
    if (ev) {
      if (!date) setDate(ev.date);
      if (!hours && ev.volunteer_hour_total) {
        setHours(String(ev.volunteer_hour_total));
      }
    }
  }

  const hoursNum = Number(hours);
  const valid =
    selected.size > 0 &&
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(hoursNum) &&
    hoursNum > 0;

  async function save() {
    if (!valid || saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/volunteer-hours", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          yearId,
          familyIds: [...selected],
          hours: hoursNum,
          entryDate: date,
          eventId: Number(eventId) || 0,
          approved,
          note: note.trim(),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? `Save failed (${res.status})`);
      }
      toast.success(
        `Logged ${formatHours(hoursNum)} hours for ${selected.size} famil${selected.size === 1 ? "y" : "ies"}.`
      );
      onDone(true);
    } catch (err) {
      console.error("Failed to bulk-add hours:", err);
      toast.error(
        err instanceof Error ? err.message : "Couldn't add hours."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !saving && !o && onDone(false)}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="border-b px-5 py-4 pr-12">
          <DialogTitle>Add hours for multiple families</DialogTitle>
          <DialogDescription>
            One entry per selected family — same date and hours for
            everyone.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 py-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Linked event (optional)</Label>
            <Select value={eventId} onValueChange={pickEvent}>
              <SelectTrigger className="w-full bg-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-64">
                <SelectItem value="0">No event — manual entry</SelectItem>
                {events.map((ev) => (
                  <SelectItem key={ev.id} value={String(ev.id)}>
                    {fmtDate(ev.date)} · {ev.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Date</Label>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Hours each</Label>
              <Input
                type="number"
                min="0"
                step="0.5"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                placeholder="2"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Note (optional)</Label>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              placeholder="e.g. rising junior meeting w/ Mr. Angelo"
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="bulk-approved" className="text-xs font-normal">
              Approved (counts toward the {HOURS_GOAL}-hour goal)
            </Label>
            <Switch
              id="bulk-approved"
              size="sm"
              checked={approved}
              onCheckedChange={setApproved}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Families ({selected.size} selected)
              </h3>
              <div className="flex items-center gap-3 text-xs">
                <button
                  type="button"
                  className="font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  onClick={() =>
                    setSelected(new Set(candidates.map((f) => f.id)))
                  }
                >
                  Select all shown
                </button>
                {selected.size > 0 ? (
                  <button
                    type="button"
                    className="font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                    onClick={() => setSelected(new Set())}
                  >
                    Clear
                  </button>
                ) : null}
              </div>
            </div>
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search enrolled families…"
              type="search"
              autoComplete="off"
            />
            {candidates.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">
                No matching families.
              </p>
            ) : (
              <ul className="max-h-56 space-y-0.5 overflow-y-auto overscroll-contain rounded-md border p-1">
                {candidates.map((f) => {
                  const on = selected.has(f.id);
                  return (
                    <li key={f.id}>
                      <button
                        type="button"
                        onClick={() => toggle(f.id)}
                        aria-pressed={on}
                        className={cn(
                          "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors",
                          on ? "bg-muted" : "hover:bg-muted/50"
                        )}
                      >
                        <span
                          className={cn(
                            "flex size-4 shrink-0 items-center justify-center rounded border",
                            on
                              ? "border-foreground bg-foreground text-background"
                              : "border-border bg-white"
                          )}
                        >
                          {on ? <Check className="size-3" /> : null}
                        </span>
                        <span className="min-w-0 flex-1 truncate">
                          {f.name}
                          {f.students ? (
                            <span className="text-xs text-muted-foreground">
                              {" "}
                              · {f.students}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        <DialogFooter className="border-t px-5 py-3">
          <Button
            variant="outline"
            size="sm"
            className="bg-white"
            disabled={saving}
            onClick={() => onDone(false)}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={saving || !valid}
            onClick={() => void save()}
          >
            {saving ? (
              <>
                <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                Saving
              </>
            ) : (
              `Add for ${selected.size || ""} ${selected.size === 1 ? "family" : "families"}`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─────────────────── Event RSVP list ─────────────────── */

/**
 * Read-only list of a parent event's sign-ups — family, spots
 * reserved, and the parent's who's-coming comment. Reservations are
 * made by families on the parent volunteer page; staff use this list
 * for headcounts and at-the-door check-in.
 */
function RsvpListDialog({
  event,
  rsvps,
  onClose,
}: {
  event: VolunteerEvent;
  rsvps: EventRsvpRow[];
  onClose: () => void;
}) {
  const totalSpots = rsvps.reduce((s, r) => s + r.spots, 0);
  const capacity = event.parent_spots ?? 0;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Sign-ups — {event.title}</DialogTitle>
          <DialogDescription>
            {fmtDate(event.date)} ·{" "}
            {isUnlimitedSpots(event.parent_spots)
              ? `${totalSpots} spots reserved · no limit`
              : capacity > 0
                ? `${totalSpots} of ${capacity} parent spots reserved`
                : `${totalSpots} spots reserved`}{" "}
            · {rsvps.length} famil{rsvps.length === 1 ? "y" : "ies"}
          </DialogDescription>
        </DialogHeader>
        {rsvps.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No sign-ups yet.
          </p>
        ) : (
          <div className="max-h-80 overflow-y-auto overscroll-contain rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-3">Family</TableHead>
                  <TableHead className="w-16 text-right">Spots</TableHead>
                  <TableHead>Comment</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rsvps.map((r) => (
                  <TableRow key={r.id} className="hover:bg-transparent">
                    <TableCell className="pl-3 font-medium">
                      {r.family_name}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.spots}
                    </TableCell>
                    <TableCell className="whitespace-pre-wrap text-muted-foreground">
                      {r.comment || "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

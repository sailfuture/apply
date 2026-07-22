"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Loader2,
  MapPin,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
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
import { cn } from "@/lib/utils";
import type { SchoolCalendarResponse } from "@/app/api/admin/school-calendar/route";
import type {
  XanoSchoolCalendarDay,
  XanoSchoolCalendarEvent,
} from "@/lib/xano";

/**
 * Settings → School Calendar. Month-grid view of the year's
 * `school_calendar` day rows (School / Weekend / Break, externship vs
 * internship rotation, holidays, term boundaries), with a day editor
 * sheet that also manages the events pinned to that day
 * (`school_calendar_events`: title, time, location, mandatory,
 * parent-volunteer-hours credit).
 *
 * The year comes from the top-bar year picker. Terms have no lookup
 * endpoint, so they're labeled ordinally (first distinct `terms_id`
 * in date order = Term 1).
 */

const DAY_TYPES = ["School", "Weekend", "Break"] as const;
const WORK_TYPES = [
  { value: "", label: "None" },
  { value: "Externship", label: "Externship" },
  { value: "Internship", label: "Internship" },
] as const;

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

/** "YYYY-MM-DD" → local Date (avoids the UTC-midnight off-by-one that
 *  `new Date("YYYY-MM-DD")` gives in western timezones). */
function parseDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function monthKeyOf(iso: string): string {
  return iso.slice(0, 7); // YYYY-MM
}

function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

/** ms → "HH:MM" for a time input ("" when unset). */
function msToTimeInput(ms: number | null | undefined): string {
  if (!ms || !Number.isFinite(ms)) return "";
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes()
  ).padStart(2, "0")}`;
}

/** Day date + "HH:MM" → local unix-ms (0 when the time is blank). */
function timeInputToMs(dateIso: string, hhmm: string): number {
  if (!hhmm) return 0;
  const [hh, mm] = hhmm.split(":").map(Number);
  const d = parseDate(dateIso);
  d.setHours(hh ?? 0, mm ?? 0, 0, 0);
  return d.getTime();
}

function fmtTime(ms: number | null | undefined): string {
  if (!ms || !Number.isFinite(ms)) return "";
  return new Date(ms).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function SchoolCalendarPage() {
  const searchParams = useSearchParams();
  const yearId = searchParams.get("yearId");

  const key = yearId ? `/api/admin/school-calendar?yearId=${yearId}` : null;
  const { data, isLoading, error, mutate } = useSWR<SchoolCalendarResponse>(
    key,
    adminFetcher
  );

  const days = useMemo(() => data?.days ?? [], [data]);
  const events = useMemo(() => data?.events ?? [], [data]);

  const dayByDate = useMemo(
    () => new Map(days.map((d) => [d.date, d])),
    [days]
  );
  const eventsByDay = useMemo(() => {
    const m = new Map<number, XanoSchoolCalendarEvent[]>();
    for (const e of events) {
      const list = m.get(Number(e.school_calendar_id)) ?? [];
      list.push(e);
      m.set(Number(e.school_calendar_id), list);
    }
    for (const list of m.values()) {
      list.sort((a, b) => (a.start_time ?? 0) - (b.start_time ?? 0));
    }
    return m;
  }, [events]);

  /** Ordinal term labels — first distinct terms_id in date order is
   *  Term 1 (no terms lookup endpoint exists). */
  const termLabel = useMemo(() => {
    const seen: number[] = [];
    for (const d of days) {
      if (d.terms_id > 0 && !seen.includes(d.terms_id)) seen.push(d.terms_id);
    }
    const m = new Map<number, string>();
    seen.forEach((id, i) => m.set(id, `Term ${i + 1}`));
    return m;
  }, [days]);

  const months = useMemo(() => {
    const seen: string[] = [];
    for (const d of days) {
      const k = monthKeyOf(d.date);
      if (!seen.includes(k)) seen.push(k);
    }
    return seen;
  }, [days]);

  const [monthIdx, setMonthIdx] = useState<number | null>(null);
  // Default to the current month when it's inside the school year,
  // else the first month. Derived lazily so the data can load first.
  const effectiveMonthIdx = useMemo(() => {
    if (monthIdx !== null && monthIdx >= 0 && monthIdx < months.length) {
      return monthIdx;
    }
    const nowKey = monthKeyOf(new Date().toISOString().slice(0, 10));
    const idx = months.indexOf(nowKey);
    return idx >= 0 ? idx : 0;
  }, [monthIdx, months]);
  const monthKey = months[effectiveMonthIdx] ?? null;

  const [selectedDayId, setSelectedDayId] = useState<number | null>(null);
  const selectedDay = useMemo(
    () => days.find((d) => d.id === selectedDayId) ?? null,
    [days, selectedDayId]
  );

  // Month grid cells — leading blanks so the 1st lands on its weekday.
  const cells = useMemo(() => {
    if (!monthKey) return [];
    const [y, m] = monthKey.split("-").map(Number);
    const first = new Date(y, (m ?? 1) - 1, 1);
    const daysInMonth = new Date(y, m ?? 1, 0).getDate();
    const out: Array<{ date: string; day: XanoSchoolCalendarDay | null } | null> =
      [];
    for (let i = 0; i < first.getDay(); i++) out.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      out.push({ date: iso, day: dayByDate.get(iso) ?? null });
    }
    return out;
  }, [monthKey, dayByDate]);

  const monthStats = useMemo(() => {
    if (!monthKey) return null;
    const inMonth = days.filter((d) => monthKeyOf(d.date) === monthKey);
    return {
      school: inMonth.filter((d) => d.type === "School").length,
      extern: inMonth.filter((d) => d.work_type === "Externship").length,
      intern: inMonth.filter((d) => d.work_type === "Internship").length,
      breaks: inMonth.filter((d) => d.type === "Break" || d.break).length,
    };
  }, [days, monthKey]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">School Calendar</h1>
          <p className="text-sm text-muted-foreground">
            Every day of the selected year — school days, rotations,
            breaks, holidays, and term boundaries. Click a day to edit it
            or manage its events.
          </p>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
          Failed to load the calendar:{" "}
          {error instanceof Error ? error.message : "unknown error"}
        </div>
      ) : null}

      {!yearId ? (
        <div className="rounded-lg border bg-white px-6 py-12 text-center text-sm text-muted-foreground">
          Pick a school year above to view its calendar.
        </div>
      ) : isLoading && days.length === 0 ? (
        <div className="flex justify-center rounded-lg border bg-white px-6 py-16">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : days.length === 0 ? (
        <div className="rounded-lg border bg-white px-6 py-12 text-center text-sm text-muted-foreground">
          No calendar has been generated for this school year yet.
        </div>
      ) : (
        <Card className="overflow-hidden bg-white py-0 gap-0">
          <CardHeader className="py-4 border-b bg-white">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="bg-white"
                  disabled={effectiveMonthIdx <= 0}
                  onClick={() => setMonthIdx(effectiveMonthIdx - 1)}
                  aria-label="Previous month"
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <CardTitle className="min-w-[170px] text-center text-base">
                  {monthKey ? monthLabel(monthKey) : ""}
                </CardTitle>
                <Button
                  variant="outline"
                  size="sm"
                  className="bg-white"
                  disabled={effectiveMonthIdx >= months.length - 1}
                  onClick={() => setMonthIdx(effectiveMonthIdx + 1)}
                  aria-label="Next month"
                >
                  <ChevronRight className="size-4" />
                </Button>
                {monthStats ? (
                  <span className="ml-2 text-xs tabular-nums text-muted-foreground">
                    {monthStats.school} school days ·{" "}
                    {monthStats.extern} externship · {monthStats.intern}{" "}
                    internship
                    {monthStats.breaks
                      ? ` · ${monthStats.breaks} break`
                      : ""}
                  </span>
                ) : null}
              </div>
              {/* Legend */}
              <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                <LegendSwatch className="bg-white border" label="School" />
                <LegendSwatch className="bg-muted/60" label="Weekend" />
                <LegendSwatch className="bg-amber-100" label="Break" />
                <span className="inline-flex items-center gap-1">
                  <span className="size-2 rounded-full bg-red-500" />
                  Holiday
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="rounded bg-indigo-100 px-1 font-medium text-indigo-700">
                    E
                  </span>
                  Externship
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="rounded bg-teal-100 px-1 font-medium text-teal-700">
                    I
                  </span>
                  Internship
                </span>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-4 bg-white">
            <div className="grid grid-cols-7 gap-1">
              {WEEKDAYS.map((w) => (
                <div
                  key={w}
                  className="pb-1 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  {w}
                </div>
              ))}
              {cells.map((cell, i) =>
                cell === null ? (
                  <div key={`blank-${i}`} />
                ) : (
                  <DayCell
                    key={cell.date}
                    date={cell.date}
                    day={cell.day}
                    eventCount={
                      cell.day
                        ? (eventsByDay.get(cell.day.id)?.length ?? 0)
                        : 0
                    }
                    termLabel={
                      cell.day
                        ? (termLabel.get(cell.day.terms_id) ?? "")
                        : ""
                    }
                    onOpen={() => cell.day && setSelectedDayId(cell.day.id)}
                  />
                )
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Day editor + events sheet — keyed by day id so drafts reset
          cleanly when a different day opens. */}
      {selectedDay ? (
        <DaySheet
          key={selectedDay.id}
          day={selectedDay}
          events={eventsByDay.get(selectedDay.id) ?? []}
          termLabel={termLabel.get(selectedDay.terms_id) ?? ""}
          onClose={() => setSelectedDayId(null)}
          onChanged={() => void mutate()}
        />
      ) : null}
    </div>
  );
}

function LegendSwatch({
  className,
  label,
}: {
  className: string;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={cn("size-3 rounded-sm", className)} />
      {label}
    </span>
  );
}

function DayCell({
  date,
  day,
  eventCount,
  termLabel,
  onOpen,
}: {
  date: string;
  day: XanoSchoolCalendarDay | null;
  eventCount: number;
  termLabel: string;
  onOpen: () => void;
}) {
  const num = Number(date.slice(8));
  if (!day) {
    // A month-edge day outside the school year's generated range.
    return (
      <div className="min-h-[76px] rounded-md border border-dashed border-border/50 p-1.5 text-xs text-muted-foreground/40">
        {num}
      </div>
    );
  }
  const isBreak = day.type === "Break" || day.break;
  const isWeekend = day.type === "Weekend";
  const boundaries: string[] = [];
  if (day.first_day_term) boundaries.push(`${termLabel || "Term"} starts`);
  if (day.last_day_term) boundaries.push(`${termLabel || "Term"} ends`);
  if (day.first_day_extern_term) boundaries.push("Externship starts");
  if (day.last_day_extern_term) boundaries.push("Externship ends");
  if (day.first_day_intern_term) boundaries.push("Internship starts");
  if (day.last_day_intern_term) boundaries.push("Internship ends");

  return (
    <button
      type="button"
      onClick={onOpen}
      title={[
        `${day.day_of_week} · ${day.type}${day.work_type ? ` · ${day.work_type}` : ""}`,
        day.holiday ? "Holiday" : "",
        ...boundaries,
        eventCount
          ? `${eventCount} event${eventCount === 1 ? "" : "s"}`
          : "",
      ]
        .filter(Boolean)
        .join("\n")}
      className={cn(
        "flex min-h-[76px] flex-col rounded-md border p-1.5 text-left text-xs transition-colors hover:border-foreground/40",
        isBreak
          ? "bg-amber-100/70"
          : isWeekend
            ? "bg-muted/60 text-muted-foreground"
            : "bg-white"
      )}
    >
      <span className="flex items-center justify-between">
        <span className="font-medium tabular-nums">{num}</span>
        <span className="flex items-center gap-1">
          {day.holiday ? (
            <span
              className="size-2 rounded-full bg-red-500"
              aria-label="Holiday"
            />
          ) : null}
          {day.work_type === "Externship" ? (
            <span className="rounded bg-indigo-100 px-1 text-[10px] font-medium text-indigo-700">
              E
            </span>
          ) : day.work_type === "Internship" ? (
            <span className="rounded bg-teal-100 px-1 text-[10px] font-medium text-teal-700">
              I
            </span>
          ) : null}
        </span>
      </span>
      <span className="mt-auto space-y-0.5">
        {boundaries.slice(0, 2).map((b) => (
          <span
            key={b}
            className="block truncate text-[9px] font-medium uppercase tracking-wide text-emerald-700"
          >
            {b}
          </span>
        ))}
        {eventCount > 0 ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-primary px-1.5 py-px text-[10px] font-medium text-primary-foreground">
            <CalendarDays className="size-2.5" />
            {eventCount}
          </span>
        ) : null}
      </span>
    </button>
  );
}

/* ── Day editor sheet ─────────────────────────────────────────────── */

function DaySheet({
  day,
  events,
  termLabel,
  onClose,
  onChanged,
}: {
  day: XanoSchoolCalendarDay;
  events: XanoSchoolCalendarEvent[];
  termLabel: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [type, setType] = useState(day.type);
  const [workType, setWorkType] = useState(day.work_type);
  const [holiday, setHoliday] = useState(day.holiday === true);
  const [isBreak, setIsBreak] = useState(day.break === true);
  const [firstTerm, setFirstTerm] = useState(day.first_day_term === true);
  const [lastTerm, setLastTerm] = useState(day.last_day_term === true);
  const [firstExtern, setFirstExtern] = useState(
    day.first_day_extern_term === true
  );
  const [lastExtern, setLastExtern] = useState(
    day.last_day_extern_term === true
  );
  const [firstIntern, setFirstIntern] = useState(
    day.first_day_intern_term === true
  );
  const [lastIntern, setLastIntern] = useState(
    day.last_day_intern_term === true
  );
  const [savingDay, setSavingDay] = useState(false);

  const dirty =
    type !== day.type ||
    workType !== day.work_type ||
    holiday !== (day.holiday === true) ||
    isBreak !== (day.break === true) ||
    firstTerm !== (day.first_day_term === true) ||
    lastTerm !== (day.last_day_term === true) ||
    firstExtern !== (day.first_day_extern_term === true) ||
    lastExtern !== (day.last_day_extern_term === true) ||
    firstIntern !== (day.first_day_intern_term === true) ||
    lastIntern !== (day.last_day_intern_term === true);

  async function saveDay() {
    if (!dirty || savingDay) return;
    setSavingDay(true);
    try {
      const res = await fetch(`/api/admin/school-calendar/${day.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          work_type: workType,
          holiday,
          break: isBreak,
          first_day_term: firstTerm,
          last_day_term: lastTerm,
          first_day_extern_term: firstExtern,
          last_day_extern_term: lastExtern,
          first_day_intern_term: firstIntern,
          last_day_intern_term: lastIntern,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? `Save failed (${res.status})`);
      }
      onChanged();
      toast.success("Day updated.");
    } catch (err) {
      console.error("Failed to save calendar day:", err);
      toast.error(err instanceof Error ? err.message : "Couldn't save day.");
    } finally {
      setSavingDay(false);
    }
  }

  const dateLabel = parseDate(day.date).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  // null = not editing; 0 = new event; otherwise the event id.
  const [editingId, setEditingId] = useState<number | null>(
    events.length === 0 ? 0 : null
  );
  const editingEvent =
    editingId && editingId > 0
      ? (events.find((e) => e.id === editingId) ?? null)
      : null;
  const [deleteTarget, setDeleteTarget] =
    useState<XanoSchoolCalendarEvent | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function deleteEvent() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      const res = await fetch(
        `/api/admin/school-calendar/events/${deleteTarget.id}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? `Delete failed (${res.status})`);
      }
      onChanged();
      toast.success("Event deleted.");
      setDeleteTarget(null);
    } catch (err) {
      console.error("Failed to delete event:", err);
      toast.error(
        err instanceof Error ? err.message : "Couldn't delete event."
      );
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <Sheet open onOpenChange={(o) => !o && onClose()}>
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-lg"
        >
          <SheetHeader className="border-b px-4 py-3">
            <SheetTitle className="text-base">{dateLabel}</SheetTitle>
            <SheetDescription className="text-xs">
              {termLabel || "—"} · {day.day_of_week}
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-5 px-4 py-4">
            {/* ── Day settings ── */}
            <section className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Day settings
              </h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Type</Label>
                  <Select value={type} onValueChange={setType}>
                    <SelectTrigger className="w-full bg-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DAY_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Work rotation</Label>
                  <Select
                    value={workType || "none"}
                    onValueChange={(v) => setWorkType(v === "none" ? "" : v)}
                  >
                    <SelectTrigger className="w-full bg-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {WORK_TYPES.map((w) => (
                        <SelectItem key={w.value || "none"} value={w.value || "none"}>
                          {w.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                <FlagSwitch id="holiday" label="Holiday" checked={holiday} onChange={setHoliday} />
                <FlagSwitch id="break" label="Break day" checked={isBreak} onChange={setIsBreak} />
                <FlagSwitch id="ft" label="First day of term" checked={firstTerm} onChange={setFirstTerm} />
                <FlagSwitch id="lt" label="Last day of term" checked={lastTerm} onChange={setLastTerm} />
                <FlagSwitch id="fe" label="Externship starts" checked={firstExtern} onChange={setFirstExtern} />
                <FlagSwitch id="le" label="Externship ends" checked={lastExtern} onChange={setLastExtern} />
                <FlagSwitch id="fi" label="Internship starts" checked={firstIntern} onChange={setFirstIntern} />
                <FlagSwitch id="li" label="Internship ends" checked={lastIntern} onChange={setLastIntern} />
              </div>
              <div className="flex justify-end">
                <Button
                  size="sm"
                  onClick={() => void saveDay()}
                  disabled={!dirty || savingDay}
                >
                  {savingDay ? (
                    <>
                      <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                      Saving
                    </>
                  ) : (
                    "Save day"
                  )}
                </Button>
              </div>
            </section>

            {/* ── Events ── */}
            <section className="space-y-3 border-t pt-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Events ({events.length})
                </h3>
                {editingId === null ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="bg-white"
                    onClick={() => setEditingId(0)}
                  >
                    <Plus className="size-3.5 mr-1" />
                    Add event
                  </Button>
                ) : null}
              </div>

              {events.length === 0 && editingId === null ? (
                <p className="text-sm text-muted-foreground">
                  No events on this day yet.
                </p>
              ) : null}

              <ul className="space-y-2">
                {events.map((e) => (
                  <li
                    key={e.id}
                    className="rounded-md border bg-muted/10 px-3 py-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {e.title}
                          {e.mandatory ? (
                            <span className="ml-1.5 rounded-full border border-red-200 bg-red-50 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-red-700 align-middle">
                              Mandatory
                            </span>
                          ) : null}
                          {e.parent_volunteer_hours ? (
                            <span className="ml-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-emerald-700 align-middle">
                              {e.volunteer_hour_total || 0} vol hrs
                            </span>
                          ) : null}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {[
                            e.start_time
                              ? `${fmtTime(e.start_time)}${
                                  e.end_time
                                    ? ` – ${fmtTime(e.end_time)}`
                                    : ""
                                }`
                              : "All day",
                            e.location ? (
                              <span key="loc">
                                <MapPin className="mr-0.5 inline size-3" />
                                {e.location}
                              </span>
                            ) : null,
                          ]
                            .filter(Boolean)
                            .map((part, i) => (
                              <span key={i}>
                                {i > 0 ? " · " : ""}
                                {part}
                              </span>
                            ))}
                        </p>
                        {e.description ? (
                          <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">
                            {e.description}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="size-7 p-0"
                          onClick={() => setEditingId(e.id)}
                          aria-label={`Edit ${e.title}`}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="size-7 p-0 text-red-600 hover:text-red-700"
                          onClick={() => setDeleteTarget(e)}
                          aria-label={`Delete ${e.title}`}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>

              {editingId !== null ? (
                <EventForm
                  key={editingId}
                  day={day}
                  existing={editingEvent}
                  onDone={(saved) => {
                    setEditingId(null);
                    if (saved) onChanged();
                  }}
                />
              ) : null}
            </section>
          </div>
        </SheetContent>
      </Sheet>

      {/* Delete confirm */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => !deleting && !o && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete &ldquo;{deleteTarget?.title}&rdquo;?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Removes the event from {dateLabel}. This can&rsquo;t be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Keep event</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700"
              onClick={(e) => {
                e.preventDefault();
                void deleteEvent();
              }}
            >
              {deleting ? "Deleting…" : "Delete event"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function FlagSwitch({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <Label htmlFor={id} className="text-xs font-normal">
        {label}
      </Label>
      <Switch id={id} size="sm" checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

/* ── Event add/edit form ──────────────────────────────────────────── */

function EventForm({
  day,
  existing,
  onDone,
}: {
  day: XanoSchoolCalendarDay;
  /** Null = creating a new event on this day. */
  existing: XanoSchoolCalendarEvent | null;
  onDone: (saved: boolean) => void;
}) {
  const [title, setTitle] = useState(existing?.title ?? "");
  const [location, setLocation] = useState(existing?.location ?? "");
  const [description, setDescription] = useState(
    existing?.description ?? ""
  );
  const [start, setStart] = useState(msToTimeInput(existing?.start_time));
  const [end, setEnd] = useState(msToTimeInput(existing?.end_time));
  const [mandatory, setMandatory] = useState(existing?.mandatory === true);
  const [volunteer, setVolunteer] = useState(
    existing?.parent_volunteer_hours === true
  );
  const [hours, setHours] = useState(
    existing?.volunteer_hour_total ? String(existing.volunteer_hour_total) : ""
  );
  const [saving, setSaving] = useState(false);

  async function save() {
    const trimmed = title.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      const payload = {
        school_calendar_id: day.id,
        title: trimmed,
        location: location.trim(),
        description: description.trim(),
        start_time: timeInputToMs(day.date, start),
        end_time: timeInputToMs(day.date, end),
        mandatory,
        parent_volunteer_hours: volunteer,
        volunteer_hour_total: volunteer ? Number(hours) || 0 : 0,
      };
      const res = await fetch(
        existing
          ? `/api/admin/school-calendar/events/${existing.id}`
          : "/api/admin/school-calendar/events",
        {
          method: existing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? `Save failed (${res.status})`);
      }
      toast.success(existing ? "Event updated." : "Event added.");
      onDone(true);
    } catch (err) {
      console.error("Failed to save event:", err);
      toast.error(
        err instanceof Error ? err.message : "Couldn't save event."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3 rounded-md border bg-white p-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {existing ? "Edit event" : "New event"}
      </p>
      <div className="space-y-1.5">
        <Label className="text-xs">Title</Label>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Family Night, field trip, early release…"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Starts</Label>
          <Input
            type="time"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Ends</Label>
          <Input
            type="time"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Location</Label>
        <Input
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="Campus, marina, address…"
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Description</Label>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          placeholder="Details families should know…"
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor="ev-mandatory" className="text-xs font-normal">
          Mandatory attendance
        </Label>
        <Switch
          id="ev-mandatory"
          size="sm"
          checked={mandatory}
          onCheckedChange={setMandatory}
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor="ev-volunteer" className="text-xs font-normal">
          Counts toward parent volunteer hours
        </Label>
        <Switch
          id="ev-volunteer"
          size="sm"
          checked={volunteer}
          onCheckedChange={setVolunteer}
        />
      </div>
      {volunteer ? (
        <div className="space-y-1.5">
          <Label className="text-xs">Volunteer hours credited</Label>
          <Input
            type="number"
            min="0"
            step="0.5"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            placeholder="2"
          />
        </div>
      ) : null}
      <div className="flex items-center justify-end gap-2">
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
          disabled={saving || !title.trim()}
        >
          {saving ? (
            <>
              <Loader2 className="size-3.5 mr-1.5 animate-spin" />
              Saving
            </>
          ) : existing ? (
            "Save changes"
          ) : (
            "Add event"
          )}
        </Button>
      </div>
    </div>
  );
}

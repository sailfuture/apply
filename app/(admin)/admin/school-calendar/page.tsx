"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Clock,
  List,
  Loader2,
  MapPin,
  Pencil,
  Plus,
  Settings2,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
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
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
import { cn } from "@/lib/utils";
import type { SchoolCalendarResponse } from "@/app/api/admin/school-calendar/route";
import type {
  XanoAcademicSeason,
  XanoAcademicTerm,
  XanoSchoolCalendarDay,
  XanoSchoolCalendarEvent,
} from "@/lib/xano";

/**
 * Settings → Calendar. Full-viewport month calendar over the year's
 * `school_calendar` day rows (School / Weekend / Break, externship vs
 * internship rotation, holidays, term boundaries). Styled like a
 * calendar app: Today + chevron nav with a large month title, a
 * "New event" dialog top-right, seamless hairline grid whose rows
 * stretch to fill the viewport, and event chips inside day cells.
 * Clicking a day opens the editor sheet, which also manages that
 * day's events (`school_calendar_events`: title, time, location,
 * event-type color, mandatory, parent-volunteer-hours credit).
 *
 * Term chips (real names + ranges from `registration_academic_terms`)
 * jump the month view to a term and dim days outside it. The Events
 * button opens a sheet streaming every event chronologically (term
 * chips filter it; rows open the day editor on top). The Terms &
 * seasons overlay is a table view with full CRUD over
 * `registration_academic_terms` / `registration_academic_seasons` —
 * season dates aren't columns, they derive from the calendar day rows
 * assigned via `seasons_id` (the season editor stamps a date range).
 * The year comes from the top-bar year picker; ordinal "Term N"
 * labels remain the fallback for `terms_id`s the terms table doesn't
 * know.
 */

const DAY_TYPES = ["School", "Weekend", "Break"] as const;
const WORK_TYPES = [
  { value: "", label: "None" },
  { value: "Externship", label: "Externship" },
  { value: "Internship", label: "Internship" },
] as const;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Event categories and their colors — the brand etiquette palette.
 * The slug is what `school_calendar_events.color` stores; empty (or
 * the " " clear-sentinel) renders the neutral gray chip.
 */
const EVENT_COLORS = [
  {
    value: "sky",
    label: "Testing",
    dot: "bg-sky-400",
    chip: "bg-sky-100 text-sky-900",
  },
  {
    value: "emerald",
    label: "SailFuture Serves",
    dot: "bg-emerald-400",
    chip: "bg-emerald-100 text-emerald-900",
  },
  {
    value: "violet",
    label: "Student Events",
    dot: "bg-violet-400",
    chip: "bg-violet-100 text-violet-900",
  },
  {
    value: "amber",
    label: "Parent Events",
    dot: "bg-amber-400",
    chip: "bg-amber-100 text-amber-900",
  },
] as const;

function eventColor(color: string | null | undefined) {
  const slug = (color ?? "").trim();
  return EVENT_COLORS.find((c) => c.value === slug) ?? null;
}

/** 15-minute options for the time dropdowns — "HH:MM" 24h values with
 *  12-hour labels, like the pickers in calendar apps. */
const TIME_OPTIONS: Array<{ value: string; label: string }> = (() => {
  const out: Array<{ value: string; label: string }> = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 15) {
      out.push({
        value: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`,
        label: timeLabel12(h, m),
      });
    }
  }
  return out;
})();

function timeLabel12(h: number, m: number): string {
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** "HH:MM" → 12-hour label, for values off the 15-minute grid. */
function labelForTimeValue(v: string): string {
  const found = TIME_OPTIONS.find((o) => o.value === v);
  if (found) return found.label;
  const [h, m] = v.split(":").map(Number);
  return timeLabel12(h ?? 0, m ?? 0);
}

/**
 * Loose time parsing for the combobox — accepts "8", "8:05", "815",
 * "8:05p", "8 pm", "14:30"… Bare hours with no AM/PM read as 24-hour
 * (8 → 8:00 AM, 14 → 2:00 PM). Returns null when it isn't a time.
 */
function parseTimeInput(raw: string): { value: string; label: string } | null {
  const s = raw.trim().toLowerCase().replace(/\./g, "");
  if (!s) return null;
  const m = s.match(/^(\d{1,2})(?::?(\d{2}))?\s*(a|am|p|pm)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const mer = m[3];
  if (min > 59) return null;
  if (mer) {
    if (h < 1 || h > 12) return null;
    if ((mer === "p" || mer === "pm") && h !== 12) h += 12;
    if ((mer === "a" || mer === "am") && h === 12) h = 0;
  } else if (h > 23) {
    return null;
  }
  const value = `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
  return { value, label: timeLabel12(h, min) };
}

/** "YYYY-MM-DD" → local Date (avoids the UTC-midnight off-by-one that
 *  `new Date("YYYY-MM-DD")` gives in western timezones). */
function parseDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

/** Local Date → "YYYY-MM-DD" (`toISOString` would shift to UTC and
 *  report the wrong day in the evening for US timezones). */
function localIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
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

function fmtShortDate(iso: string): string {
  return parseDate(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function agendaDateLabel(iso: string): string {
  return parseDate(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
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
  const terms = useMemo(() => data?.terms ?? [], [data]);
  const seasons = useMemo(() => data?.seasons ?? [], [data]);

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

  /** terms_id → display name. Real names from the academic-terms
   *  table when available, ordinal "Term N" fallback for ids the
   *  table doesn't know (legacy calendars). */
  const termLabel = useMemo(() => {
    const byId = new Map(terms.map((t) => [t.id, t.term_name]));
    const seen: number[] = [];
    for (const d of days) {
      if (d.terms_id > 0 && !seen.includes(d.terms_id)) seen.push(d.terms_id);
    }
    const m = new Map<number, string>();
    seen.forEach((id, i) => m.set(id, byId.get(id) ?? `Term ${i + 1}`));
    return m;
  }, [days, terms]);

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
    const nowKey = monthKeyOf(localIso(new Date()));
    const idx = months.indexOf(nowKey);
    return idx >= 0 ? idx : 0;
  }, [monthIdx, months]);
  const monthKey = months[effectiveMonthIdx] ?? null;

  const [selectedDayId, setSelectedDayId] = useState<number | null>(null);
  const selectedDay = useMemo(
    () => days.find((d) => d.id === selectedDayId) ?? null,
    [days, selectedDayId]
  );

  const [eventsOpen, setEventsOpen] = useState(false);
  const [termFilter, setTermFilter] = useState<number | "all">("all");
  const [termsOpen, setTermsOpen] = useState(false);

  /** Term chip click — filter (agenda) and jump the month view to the
   *  term's first month. */
  function selectTerm(t: XanoAcademicTerm) {
    setTermFilter(t.id);
    const startIso =
      t.start_date ?? days.find((d) => d.terms_id === t.id)?.date ?? null;
    if (startIso) {
      const idx = months.indexOf(monthKeyOf(startIso));
      if (idx >= 0) setMonthIdx(idx);
    }
  }

  /** When a term is selected, month-view days outside its date range
   *  dim so the term's span pops. Only possible when the term has
   *  dates. */
  const activeTermRange = useMemo(() => {
    if (termFilter === "all") return null;
    const t = terms.find((x) => x.id === termFilter);
    return t?.start_date && t?.end_date
      ? { start: t.start_date, end: t.end_date }
      : null;
  }, [termFilter, terms]);


  // Month grid cells — leading blanks so the 1st lands on its weekday,
  // trailing blanks so the grid is a clean rectangle of full weeks
  // (rows share the viewport height equally, so ragged rows would
  // stretch oddly).
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
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [monthKey, dayByDate]);

  const weekCount = Math.max(1, cells.length / 7);
  const todayIso = localIso(new Date());
  const todayMonthIdx = months.indexOf(monthKeyOf(todayIso));

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col gap-4 p-6">
      {/* Toolbar — Today · ‹ › · month title on the left; legend and
          the New-event dialog on the right. The month label doubles as
          the page heading, calendar-app style. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            className="mr-1 bg-white"
            disabled={todayMonthIdx < 0 || todayMonthIdx === effectiveMonthIdx}
            onClick={() => setMonthIdx(todayMonthIdx)}
          >
            Today
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="size-8 p-0"
            disabled={effectiveMonthIdx <= 0}
            onClick={() => setMonthIdx(effectiveMonthIdx - 1)}
            aria-label="Previous month"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="size-8 p-0"
            disabled={effectiveMonthIdx >= months.length - 1}
            onClick={() => setMonthIdx(effectiveMonthIdx + 1)}
            aria-label="Next month"
          >
            <ChevronRight className="size-4" />
          </Button>
          <h1 className="ml-2 text-xl font-semibold tracking-tight">
            {monthKey ? monthLabel(monthKey) : "Calendar"}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Legend — hidden on narrow viewports where it would wrap
              the toolbar onto three lines. */}
          <div className="mr-2 hidden items-center gap-3 text-[11px] text-muted-foreground xl:flex">
            <LegendSwatch className="bg-white border" label="School" />
            <LegendSwatch className="bg-muted/60" label="Weekend" />
            <LegendSwatch className="bg-amber-100" label="Break" />
            <span className="inline-flex items-center gap-1">
              <span className="size-2 rounded-full bg-rose-500" />
              Holiday
            </span>
            <span className="rounded-full bg-indigo-100 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-indigo-700">
              Extern
            </span>
            <span className="rounded-full bg-orange-100 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-orange-700">
              Intern
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="bg-white"
            disabled={!yearId}
            onClick={() => setEventsOpen(true)}
          >
            <List className="size-3.5 mr-1.5" />
            Events
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="bg-white"
            disabled={!yearId}
            onClick={() => setTermsOpen(true)}
          >
            <Settings2 className="size-3.5 mr-1.5" />
            Terms &amp; seasons
          </Button>
          <NewEventDialog
            days={days}
            dayByDate={dayByDate}
            monthKey={monthKey}
            todayIso={todayIso}
            onCreated={() => void mutate()}
          />
        </div>
      </div>

      {/* Term chips — jump the month view to a term's start and dim
          days outside its range. */}
      {terms.length > 0 ? (
        <TermChipRow
          terms={terms}
          value={termFilter}
          onAll={() => setTermFilter("all")}
          onTerm={selectTerm}
        />
      ) : null}

      {error ? (
        <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
          Failed to load the calendar:{" "}
          {error instanceof Error ? error.message : "unknown error"}
        </div>
      ) : null}

      {!yearId ? (
        <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border bg-white p-6 text-center text-sm text-muted-foreground">
          Pick a school year above to view its calendar.
        </div>
      ) : isLoading && days.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border bg-white">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : days.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border bg-white p-6 text-center text-sm text-muted-foreground">
          No calendar has been generated for this school year yet.
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-white">
          {/* Weekday header */}
          <div className="grid shrink-0 grid-cols-7 border-b">
            {WEEKDAYS.map((w) => (
              <div
                key={w}
                className="py-2 text-center text-xs font-medium text-muted-foreground"
              >
                {w}
              </div>
            ))}
          </div>
          {/* Month grid — a seamless hairline grid whose rows split the
              remaining viewport height equally, so the calendar always
              fills the page regardless of 4-, 5-, or 6-week months. */}
          <div
            className="grid min-h-0 flex-1 grid-cols-7"
            style={{
              gridTemplateRows: `repeat(${weekCount}, minmax(0, 1fr))`,
            }}
          >
            {cells.map((cell, i) => {
              // Hairline separators: right edge on all but the last
              // column, bottom edge on all but the last row.
              const edge = cn(
                i % 7 !== 6 && "border-r",
                i < cells.length - 7 && "border-b"
              );
              if (cell === null) {
                return (
                  <div key={`blank-${i}`} className={cn("bg-muted/20", edge)} />
                );
              }
              return (
                <DayCell
                  key={cell.date}
                  date={cell.date}
                  day={cell.day}
                  events={
                    cell.day ? (eventsByDay.get(cell.day.id) ?? []) : []
                  }
                  termLabel={
                    cell.day
                      ? (termLabel.get(cell.day.terms_id) ?? "")
                      : ""
                  }
                  isToday={cell.date === todayIso}
                  dimmed={
                    activeTermRange !== null &&
                    (cell.date < activeTermRange.start ||
                      cell.date > activeTermRange.end)
                  }
                  className={edge}
                  onOpen={() => cell.day && setSelectedDayId(cell.day.id)}
                />
              );
            })}
          </div>
        </div>
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

      {/* All-events stream — right-hand sheet; clicking a row opens
          that day's editor sheet on top. */}
      {eventsOpen ? (
        <EventsSheet
          days={days}
          events={events}
          terms={terms}
          termLabel={termLabel}
          onClose={() => setEventsOpen(false)}
          onOpenDay={(dayId) => setSelectedDayId(dayId)}
        />
      ) : null}

      {/* Terms & seasons management */}
      {termsOpen ? (
        <TermsSeasonsDialog
          yearId={Number(yearId) || 0}
          terms={terms}
          seasons={seasons}
          days={days}
          onClose={() => setTermsOpen(false)}
          onChanged={() => void mutate()}
        />
      ) : null}
    </div>
  );
}

/** Shared term filter chips — "All terms" + one chip per term with
 *  its date range. */
function TermChipRow({
  terms,
  value,
  onAll,
  onTerm,
  className,
}: {
  terms: XanoAcademicTerm[];
  value: number | "all";
  onAll: () => void;
  onTerm: (t: XanoAcademicTerm) => void;
  className?: string;
}) {
  const chip = (on: boolean) =>
    cn(
      "rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
      on
        ? "border-foreground bg-foreground text-background"
        : "border-border bg-white text-muted-foreground hover:border-foreground/40 hover:text-foreground"
    );
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      <button
        type="button"
        aria-pressed={value === "all"}
        onClick={onAll}
        className={chip(value === "all")}
      >
        All terms
      </button>
      {terms.map((t) => {
        const on = value === t.id;
        const range =
          t.start_date && t.end_date
            ? `${fmtShortDate(t.start_date)} – ${fmtShortDate(t.end_date)}`
            : "";
        return (
          <button
            key={t.id}
            type="button"
            aria-pressed={on}
            title={range}
            onClick={() => onTerm(t)}
            className={chip(on)}
          >
            {t.term_name}
            {range ? (
              <span
                className={cn(
                  "ml-1.5 font-normal",
                  on ? "text-background/70" : "text-muted-foreground/70"
                )}
              >
                {range}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Right-hand sheet listing every event on the year's calendar,
 * oldest first, grouped by day with sticky date headers. Term chips
 * filter the stream; clicking a row opens that day's editor sheet on
 * top of this one.
 */
function EventsSheet({
  days,
  events,
  terms,
  termLabel,
  onClose,
  onOpenDay,
}: {
  days: XanoSchoolCalendarDay[];
  events: XanoSchoolCalendarEvent[];
  terms: XanoAcademicTerm[];
  termLabel: Map<number, string>;
  onClose: () => void;
  onOpenDay: (dayId: number) => void;
}) {
  const [filter, setFilter] = useState<number | "all">("all");

  const groups = useMemo(() => {
    const dayById = new Map(days.map((d) => [d.id, d]));
    const rows: Array<{
      e: XanoSchoolCalendarEvent;
      day: XanoSchoolCalendarDay;
    }> = [];
    for (const e of events) {
      const day = dayById.get(Number(e.school_calendar_id));
      if (!day) continue;
      if (filter !== "all" && day.terms_id !== filter) continue;
      rows.push({ e, day });
    }
    rows.sort(
      (a, b) =>
        a.day.date.localeCompare(b.day.date) ||
        (a.e.start_time ?? 0) - (b.e.start_time ?? 0)
    );
    const out: Array<{
      date: string;
      day: XanoSchoolCalendarDay;
      items: XanoSchoolCalendarEvent[];
    }> = [];
    for (const r of rows) {
      const last = out[out.length - 1];
      if (last && last.date === r.day.date) last.items.push(r.e);
      else out.push({ date: r.day.date, day: r.day, items: [r.e] });
    }
    return out;
  }, [days, events, filter]);

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-xl"
      >
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle className="text-base">Events</SheetTitle>
          <SheetDescription className="text-xs">
            Every event on this year&rsquo;s calendar. Click one to open
            its day.
          </SheetDescription>
        </SheetHeader>
        {terms.length > 0 ? (
          <TermChipRow
            terms={terms}
            value={filter}
            onAll={() => setFilter("all")}
            onTerm={(t) => setFilter(t.id)}
            className="border-b px-4 py-2.5"
          />
        ) : null}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {groups.length === 0 ? (
            <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
              No events{filter !== "all" ? " in this term" : ""} yet —
              use New event to add one.
            </div>
          ) : (
            groups.map((g) => (
              <div key={g.date}>
                <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-muted/60 px-4 py-1.5 backdrop-blur">
                  <span className="text-xs font-semibold">
                    {agendaDateLabel(g.date)}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {termLabel.get(g.day.terms_id) ?? ""}
                  </span>
                </div>
                <ul className="divide-y">
                  {g.items.map((e) => {
                    const c = eventColor(e.color);
                    return (
                      <li key={e.id}>
                        <button
                          type="button"
                          onClick={() => onOpenDay(g.day.id)}
                          className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/40"
                        >
                          <span
                            className={cn(
                              "size-2.5 shrink-0 rounded-full",
                              c ? c.dot : "bg-slate-300"
                            )}
                          />
                          <span className="w-28 shrink-0 text-xs tabular-nums text-muted-foreground">
                            {e.start_time
                              ? `${fmtTime(e.start_time)}${
                                  e.end_time
                                    ? ` – ${fmtTime(e.end_time)}`
                                    : ""
                                }`
                              : "All day"}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">
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
                            </span>
                            {e.location ? (
                              <span className="block truncate text-xs text-muted-foreground">
                                <MapPin className="mr-0.5 inline size-3" />
                                {e.location}
                              </span>
                            ) : null}
                          </span>
                          {c ? (
                            <span className="hidden shrink-0 text-[11px] text-muted-foreground sm:block">
                              {c.label}
                            </span>
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
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
  events,
  termLabel,
  isToday,
  dimmed,
  className,
  onOpen,
}: {
  date: string;
  day: XanoSchoolCalendarDay | null;
  events: XanoSchoolCalendarEvent[];
  termLabel: string;
  isToday: boolean;
  /** True when a term filter is active and this day falls outside its
   *  date range — the cell fades so the term's span pops. */
  dimmed: boolean;
  className?: string;
  onOpen: () => void;
}) {
  const num = Number(date.slice(8));
  if (!day) {
    // A month-edge day outside the school year's generated range.
    return (
      <div
        className={cn(
          "p-1.5 text-xs tabular-nums text-muted-foreground/40",
          className
        )}
      >
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

  // How many event chips fit varies with viewport height — cap at 3
  // and summarize the rest; the day sheet lists them all.
  const MAX_CHIPS = 3;
  const shown = events.slice(0, MAX_CHIPS);
  const extra = events.length - shown.length;

  return (
    <button
      type="button"
      onClick={onOpen}
      title={[
        `${day.day_of_week} · ${day.type}${day.work_type ? ` · ${day.work_type}` : ""}`,
        day.holiday ? "Holiday" : "",
        ...boundaries,
        ...events.map((e) =>
          e.start_time ? `${fmtTime(e.start_time)} ${e.title}` : e.title
        ),
      ]
        .filter(Boolean)
        .join("\n")}
      className={cn(
        "flex h-full min-h-0 flex-col gap-1 overflow-hidden p-1.5 text-left text-xs transition-colors",
        isBreak
          ? "bg-amber-100/60 hover:bg-amber-100"
          : isWeekend
            ? "bg-muted/50 text-muted-foreground hover:bg-muted/70"
            : "bg-white hover:bg-muted/40",
        dimmed && "opacity-40 hover:opacity-70",
        className
      )}
    >
      <span className="flex shrink-0 items-center justify-between">
        <span
          className={cn(
            "font-medium tabular-nums",
            isToday &&
              "flex size-6 -m-0.5 items-center justify-center rounded-full bg-foreground text-background"
          )}
        >
          {num}
        </span>
        <span className="flex items-center gap-1">
          {day.holiday ? (
            <span
              className="size-2 rounded-full bg-rose-500"
              aria-label="Holiday"
            />
          ) : null}
          {day.work_type === "Externship" ? (
            <span className="rounded-full bg-indigo-100 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-indigo-700">
              Extern
            </span>
          ) : day.work_type === "Internship" ? (
            <span className="rounded-full bg-orange-100 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-orange-700">
              Intern
            </span>
          ) : null}
        </span>
      </span>
      {boundaries.length > 0 ? (
        <span className="shrink-0 space-y-px">
          {boundaries.slice(0, 2).map((b) => (
            <span
              key={b}
              className="block truncate text-[9px] font-medium uppercase tracking-wide text-muted-foreground"
            >
              {b}
            </span>
          ))}
        </span>
      ) : null}
      {shown.length > 0 ? (
        <span className="flex min-h-0 flex-col gap-0.5 overflow-hidden">
          {shown.map((e) => {
            const c = eventColor(e.color);
            return (
              <span
                key={e.id}
                className={cn(
                  "block shrink-0 truncate rounded px-1.5 py-0.5 text-[10px] font-medium leading-4",
                  c ? c.chip : "bg-slate-200/70 text-slate-800"
                )}
              >
                {e.start_time ? (
                  <span className="tabular-nums">
                    {fmtTime(e.start_time)}{" "}
                  </span>
                ) : null}
                {e.title}
              </span>
            );
          })}
          {extra > 0 ? (
            <span className="shrink-0 px-1 text-[10px] font-medium text-muted-foreground">
              +{extra} more
            </span>
          ) : null}
        </span>
      ) : null}
    </button>
  );
}

/* ── Time + event-type field widgets ──────────────────────────────── */

/**
 * Searchable time combobox — type to filter the 15-minute grid, or
 * type any exact time ("8:05", "8:05p", "14:30") and pick the parsed
 * "Use …" row it offers. "No time" clears.
 */
function TimeSelect({
  value,
  onChange,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  // Free-typed time that isn't one of the grid rows — offered as its
  // own "Use 8:05 AM" item (value = the raw query so cmdk's filter
  // always keeps it visible).
  const parsed = parseTimeInput(query);
  const offParsed =
    parsed && !TIME_OPTIONS.some((o) => o.value === parsed.value)
      ? parsed
      : null;

  function pick(v: string) {
    onChange(v);
    setOpen(false);
    setQuery("");
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          className="w-full justify-between bg-white px-3 font-normal"
        >
          <span
            className={cn(
              "flex min-w-0 items-center gap-1.5",
              !value && "text-muted-foreground"
            )}
          >
            <Clock className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">
              {value ? labelForTimeValue(value) : "No time"}
            </span>
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[220px] p-0" align="start">
        <Command>
          <CommandInput
            placeholder="Type a time…"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList className="max-h-56">
            <CommandEmpty>No matching time.</CommandEmpty>
            {offParsed ? (
              <CommandGroup>
                <CommandItem value={query} onSelect={() => pick(offParsed.value)}>
                  Use {offParsed.label}
                </CommandItem>
              </CommandGroup>
            ) : null}
            <CommandGroup>
              <CommandItem
                value="no time clear none"
                onSelect={() => pick("")}
              >
                No time
                {!value ? <Check className="ml-auto size-3.5" /> : null}
              </CommandItem>
              {TIME_OPTIONS.map((o) => (
                <CommandItem
                  key={o.value}
                  value={o.label}
                  onSelect={() => pick(o.value)}
                >
                  {o.label}
                  {value === o.value ? (
                    <Check className="ml-auto size-3.5" />
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** One Places suggestion from /api/admin/places. */
interface PlaceSuggestion {
  main: string;
  secondary: string;
  full: string;
}

/**
 * Location field with Google Places autocomplete. Still a free-text
 * input (events store location as plain text) — typing 3+ characters
 * fetches address/place suggestions through the server-side proxy;
 * picking one fills the input with the full formatted address. When
 * the API key isn't configured the dropdown never appears and this
 * behaves exactly like the old plain input.
 */
function LocationInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  // Server said "no key configured" — stop asking for this mount.
  const disabledRef = useRef(false);
  // Google per-session billing token: one UUID per typing session,
  // reset after a pick.
  const sessionRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqRef = useRef(0);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  function queryPlaces(q: string) {
    if (disabledRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    if (q.trim().length < 3) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    timerRef.current = setTimeout(async () => {
      const seq = ++seqRef.current;
      setLoading(true);
      try {
        if (!sessionRef.current) {
          sessionRef.current =
            typeof crypto !== "undefined" && "randomUUID" in crypto
              ? crypto.randomUUID()
              : String(Math.random()).slice(2);
        }
        const res = await fetch(
          `/api/admin/places?q=${encodeURIComponent(q)}&session=${sessionRef.current}`
        );
        if (!res.ok) return;
        const data = await res.json();
        if (seq !== seqRef.current) return; // a newer keystroke won
        if (data?.configured === false) {
          disabledRef.current = true;
          setOpen(false);
          return;
        }
        const list: PlaceSuggestion[] = data?.suggestions ?? [];
        setSuggestions(list);
        setOpen(list.length > 0);
      } catch {
        // Best-effort — the field keeps working as plain text.
      } finally {
        if (seq === seqRef.current) setLoading(false);
      }
    }, 300);
  }

  return (
    <div className="relative">
      <Input
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          queryPlaces(e.target.value);
        }}
        onFocus={() => {
          if (suggestions.length > 0 && value.trim().length >= 3) {
            setOpen(true);
          }
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
        placeholder={placeholder}
        autoComplete="off"
      />
      {loading ? (
        <Loader2 className="absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
      ) : null}
      {open && suggestions.length > 0 ? (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-md border bg-white shadow-md">
          <ul className="max-h-56 overflow-y-auto py-1">
            {suggestions.map((s) => (
              <li key={s.full}>
                {/* onMouseDown (not onClick) so the pick lands before
                    the input's blur closes the dropdown. */}
                <button
                  type="button"
                  className="w-full px-3 py-1.5 text-left transition-colors hover:bg-muted/60"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onChange(s.full);
                    setSuggestions([]);
                    setOpen(false);
                    sessionRef.current = null;
                  }}
                >
                  <span className="block truncate text-sm font-medium">
                    {s.main}
                  </span>
                  {s.secondary ? (
                    <span className="block truncate text-xs text-muted-foreground">
                      {s.secondary}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
          {/* Required attribution for Places data shown without a map. */}
          <p className="border-t px-3 py-1 text-right text-[10px] text-muted-foreground">
            Powered by Google
          </p>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Etiquette-style color dots, one per event category. Clicking the
 * selected dot again clears back to the neutral default.
 */
function EventColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const selected = eventColor(value);
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">Event type</Label>
      <div className="flex items-center gap-2">
        {EVENT_COLORS.map((c) => {
          const on = value.trim() === c.value;
          return (
            <button
              key={c.value}
              type="button"
              title={c.label}
              aria-label={c.label}
              aria-pressed={on}
              onClick={() => onChange(on ? "" : c.value)}
              className={cn(
                "flex size-8 items-center justify-center rounded-full transition-all",
                c.dot,
                on
                  ? "ring-2 ring-foreground ring-offset-2"
                  : "opacity-70 hover:opacity-100"
              )}
            >
              {on ? (
                <span className="size-2 rounded-full bg-black/80" />
              ) : null}
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-muted-foreground">
        {selected ? selected.label : "General (gray)"}
      </p>
    </div>
  );
}

/* ── New-event dialog ─────────────────────────────────────────────── */

/**
 * "New event" from the toolbar — the same fields as the day sheet's
 * inline form plus a date picker, since the toolbar isn't anchored to
 * a day. Events pin to a `school_calendar` day row, so the date input
 * is clamped to the school year's generated range.
 */
function NewEventDialog({
  days,
  dayByDate,
  monthKey,
  todayIso,
  onCreated,
}: {
  days: XanoSchoolCalendarDay[];
  dayByDate: Map<string, XanoSchoolCalendarDay>;
  monthKey: string | null;
  todayIso: string;
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [color, setColor] = useState("");
  const [mandatory, setMandatory] = useState(false);
  const [volunteer, setVolunteer] = useState(false);
  const [hours, setHours] = useState("");
  const [saving, setSaving] = useState(false);

  const minDate = days[0]?.date;
  const maxDate = days[days.length - 1]?.date;
  const day = date ? (dayByDate.get(date) ?? null) : null;

  function openDialog() {
    // Default date: today when it's inside the school year, else the
    // first day of the month being viewed.
    let d = "";
    if (dayByDate.has(todayIso)) d = todayIso;
    else if (monthKey) {
      d = days.find((x) => monthKeyOf(x.date) === monthKey)?.date ?? "";
    }
    setDate(d || (days[0]?.date ?? ""));
    setTitle("");
    setDescription("");
    setLocation("");
    setAllDay(false);
    setStart("");
    setEnd("");
    setColor("");
    setMandatory(false);
    setVolunteer(false);
    setHours("");
    setOpen(true);
  }

  async function save() {
    const trimmed = title.trim();
    if (!trimmed || !day || saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/school-calendar/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          school_calendar_id: day.id,
          title: trimmed,
          location: location.trim(),
          description: description.trim(),
          start_time: allDay ? 0 : timeInputToMs(date, start),
          end_time: allDay ? 0 : timeInputToMs(date, end),
          color,
          mandatory,
          parent_volunteer_hours: volunteer,
          volunteer_hour_total: volunteer ? Number(hours) || 0 : 0,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? `Save failed (${res.status})`);
      }
      toast.success("Event added.");
      setOpen(false);
      onCreated();
    } catch (err) {
      console.error("Failed to create event:", err);
      toast.error(
        err instanceof Error ? err.message : "Couldn't create event."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button size="sm" onClick={openDialog} disabled={days.length === 0}>
        <Plus className="size-4 mr-1" />
        New event
      </Button>
      <Dialog open={open} onOpenChange={(o) => !saving && setOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create event</DialogTitle>
            <DialogDescription>
              Adds an event to a day on the school calendar.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Title</Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Family Night, field trip, early release…"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Date</Label>
              <Input
                type="date"
                value={date}
                min={minDate}
                max={maxDate}
                onChange={(e) => setDate(e.target.value)}
              />
              {date && !day ? (
                <p className="text-xs text-red-600">
                  That date isn&rsquo;t part of this school year&rsquo;s
                  calendar.
                </p>
              ) : null}
            </div>
            {!allDay ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Starts</Label>
                  <TimeSelect
                    value={start}
                    onChange={setStart}
                    ariaLabel="Start time"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Ends</Label>
                  <TimeSelect
                    value={end}
                    onChange={setEnd}
                    ariaLabel="End time"
                  />
                </div>
              </div>
            ) : null}
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="ne-allday" className="text-xs font-normal">
                All day
              </Label>
              <Switch
                id="ne-allday"
                size="sm"
                checked={allDay}
                onCheckedChange={setAllDay}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Location</Label>
              <LocationInput
                value={location}
                onChange={setLocation}
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
            <EventColorPicker value={color} onChange={setColor} />
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="ne-mandatory" className="text-xs font-normal">
                Mandatory attendance
              </Label>
              <Switch
                id="ne-mandatory"
                size="sm"
                checked={mandatory}
                onCheckedChange={setMandatory}
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="ne-volunteer" className="text-xs font-normal">
                Counts toward parent volunteer hours
              </Label>
              <Switch
                id="ne-volunteer"
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
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              className="bg-white"
              disabled={saving}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => void save()}
              disabled={saving || !title.trim() || !day}
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
    </>
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
                  <Label className="text-xs">Work type</Label>
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
                          <span
                            className={cn(
                              "mr-1.5 inline-block size-2 rounded-full align-middle",
                              eventColor(e.color)?.dot ?? "bg-slate-300"
                            )}
                            aria-hidden
                          />
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
  const [color, setColor] = useState((existing?.color ?? "").trim());
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
        color,
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
          <TimeSelect
            value={start}
            onChange={setStart}
            ariaLabel="Start time"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Ends</Label>
          <TimeSelect value={end} onChange={setEnd} ariaLabel="End time" />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Location</Label>
        <LocationInput
          value={location}
          onChange={setLocation}
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
      <EventColorPicker value={color} onChange={setColor} />
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

/* ── Terms & seasons management ───────────────────────────────────── */

/** "Aug 24, 2026" — school years span two calendar years, so the
 *  tables always show the year. */
function fmtMedDate(iso: string): string {
  return parseDate(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Large overlay for managing the year's academic terms and seasons as
 * tables. Add/Edit open their own small modal (TermEditDialog /
 * SeasonEditDialog) on top; deletes confirm via AlertDialog. Counts
 * shown are in-session SCHOOL days, not raw calendar days. A season's
 * dates aren't stored on the season row — they derive from the
 * `school_calendar` day rows assigned to it (`seasons_id`), which the
 * season editor manages via a date range.
 */
function TermsSeasonsDialog({
  yearId,
  terms,
  seasons,
  days,
  onClose,
  onChanged,
}: {
  yearId: number;
  terms: XanoAcademicTerm[];
  seasons: XanoAcademicSeason[];
  days: XanoSchoolCalendarDay[];
  onClose: () => void;
  onChanged: () => void;
}) {
  // null = closed; { existing: null } = add-new.
  const [termEdit, setTermEdit] = useState<{
    existing: XanoAcademicTerm | null;
  } | null>(null);
  const [seasonEdit, setSeasonEdit] = useState<{
    existing: XanoAcademicSeason | null;
  } | null>(null);

  const [deleteTermTarget, setDeleteTermTarget] =
    useState<XanoAcademicTerm | null>(null);
  const [deleteSeasonTarget, setDeleteSeasonTarget] =
    useState<XanoAcademicSeason | null>(null);
  const [deleting, setDeleting] = useState(false);

  /** In-session school days per term (terms_id on day rows). */
  const termSchoolDays = useMemo(() => {
    const m = new Map<number, number>();
    for (const d of days) {
      if (d.type !== "School" || !d.terms_id) continue;
      m.set(d.terms_id, (m.get(d.terms_id) ?? 0) + 1);
    }
    return m;
  }, [days]);

  /** All day rows referencing each term — delete-warning integrity
   *  count (broader than the school-day stat). */
  const termDayRefs = useMemo(() => {
    const m = new Map<number, number>();
    for (const d of days) {
      if (!d.terms_id) continue;
      m.set(d.terms_id, (m.get(d.terms_id) ?? 0) + 1);
    }
    return m;
  }, [days]);

  /** Derived per-season info from assigned day rows: date range,
   *  total assigned days, school-day count. */
  const seasonInfo = useMemo(() => {
    const m = new Map<
      number,
      { start: string; end: string; total: number; school: number }
    >();
    for (const d of days) {
      const sid = Number(d.seasons_id);
      if (!sid) continue;
      const cur = m.get(sid) ?? {
        start: d.date,
        end: d.date,
        total: 0,
        school: 0,
      };
      if (d.date < cur.start) cur.start = d.date;
      if (d.date > cur.end) cur.end = d.date;
      cur.total += 1;
      if (d.type === "School") cur.school += 1;
      m.set(sid, cur);
    }
    return m;
  }, [days]);

  const termNameById = useMemo(
    () => new Map(terms.map((t) => [t.id, t.term_name])),
    [terms]
  );

  async function runDelete(url: string, label: string, after: () => void) {
    if (deleting) return;
    setDeleting(true);
    try {
      const res = await fetch(url, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? `Delete failed (${res.status})`);
      }
      onChanged();
      toast.success(`${label} deleted.`);
      after();
    } catch (err) {
      console.error(`Failed to delete ${label.toLowerCase()}:`, err);
      toast.error(
        err instanceof Error
          ? err.message
          : `Couldn't delete ${label.toLowerCase()}.`
      );
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
          <DialogHeader className="border-b px-6 py-4 pr-12">
            <DialogTitle>Terms &amp; seasons</DialogTitle>
            <DialogDescription>
              Academic terms and seasons for this school year — dates,
              in-session school-day counts, and the links between them.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">
            {/* ── Terms table ── */}
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Terms ({terms.length})
                </h3>
                <Button
                  variant="outline"
                  size="sm"
                  className="bg-white"
                  onClick={() => setTermEdit({ existing: null })}
                >
                  <Plus className="size-3.5 mr-1" />
                  Add term
                </Button>
              </div>
              <div className="overflow-hidden rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Term</TableHead>
                      <TableHead>Starts</TableHead>
                      <TableHead>Ends</TableHead>
                      <TableHead className="text-right">
                        School days
                      </TableHead>
                      <TableHead className="w-20">
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {terms.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={5}
                          className="py-6 text-center text-sm text-muted-foreground"
                        >
                          No terms for this school year yet.
                        </TableCell>
                      </TableRow>
                    ) : (
                      terms.map((t) => (
                        <TableRow key={t.id}>
                          <TableCell className="font-medium">
                            {t.term_name}
                            {t.isActive ? (
                              <span className="ml-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-emerald-700 align-middle">
                                Active
                              </span>
                            ) : null}
                          </TableCell>
                          <TableCell className="tabular-nums">
                            {t.start_date ? fmtMedDate(t.start_date) : "—"}
                          </TableCell>
                          <TableCell className="tabular-nums">
                            {t.end_date ? fmtMedDate(t.end_date) : "—"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {termSchoolDays.get(t.id) ?? 0}
                          </TableCell>
                          <TableCell>
                            <div className="flex justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="size-7 p-0"
                                onClick={() =>
                                  setTermEdit({ existing: t })
                                }
                                aria-label={`Edit ${t.term_name}`}
                              >
                                <Pencil className="size-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="size-7 p-0 text-red-600 hover:text-red-700"
                                onClick={() => setDeleteTermTarget(t)}
                                aria-label={`Delete ${t.term_name}`}
                              >
                                <Trash2 className="size-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </section>

            {/* ── Seasons table ── */}
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Seasons ({seasons.length})
                </h3>
                <Button
                  variant="outline"
                  size="sm"
                  className="bg-white"
                  onClick={() => setSeasonEdit({ existing: null })}
                >
                  <Plus className="size-3.5 mr-1" />
                  Add season
                </Button>
              </div>
              <div className="overflow-hidden rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Season</TableHead>
                      <TableHead>Linked term</TableHead>
                      <TableHead>Dates</TableHead>
                      <TableHead className="text-right">
                        School days
                      </TableHead>
                      <TableHead className="w-20">
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {seasons.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={5}
                          className="py-6 text-center text-sm text-muted-foreground"
                        >
                          No seasons for this school year yet.
                        </TableCell>
                      </TableRow>
                    ) : (
                      seasons.map((s) => {
                        const info = seasonInfo.get(s.id);
                        return (
                          <TableRow key={s.id}>
                            <TableCell className="font-medium">
                              {s.name}
                            </TableCell>
                            <TableCell>
                              {s.registration_academic_terms_id > 0
                                ? (termNameById.get(
                                    s.registration_academic_terms_id
                                  ) ?? "Missing term")
                                : "—"}
                            </TableCell>
                            <TableCell className="tabular-nums">
                              {info
                                ? `${fmtMedDate(info.start)} – ${fmtMedDate(info.end)}`
                                : "No dates set"}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {info?.school ?? 0}
                            </TableCell>
                            <TableCell>
                              <div className="flex justify-end gap-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="size-7 p-0"
                                  onClick={() =>
                                    setSeasonEdit({ existing: s })
                                  }
                                  aria-label={`Edit ${s.name}`}
                                >
                                  <Pencil className="size-3.5" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="size-7 p-0 text-red-600 hover:text-red-700"
                                  onClick={() =>
                                    setDeleteSeasonTarget(s)
                                  }
                                  aria-label={`Delete ${s.name}`}
                                >
                                  <Trash2 className="size-3.5" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Season dates come from the calendar days assigned to the
                season — pick the range in the season editor.
              </p>
            </section>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add/Edit modals — stacked over the tables */}
      {termEdit ? (
        <TermEditDialog
          key={termEdit.existing?.id ?? 0}
          yearId={yearId}
          existing={termEdit.existing}
          onDone={(saved) => {
            setTermEdit(null);
            if (saved) onChanged();
          }}
        />
      ) : null}
      {seasonEdit ? (
        <SeasonEditDialog
          key={seasonEdit.existing?.id ?? 0}
          yearId={yearId}
          terms={terms}
          days={days}
          existing={seasonEdit.existing}
          onDone={(saved) => {
            setSeasonEdit(null);
            if (saved) onChanged();
          }}
        />
      ) : null}

      {/* Term delete confirm */}
      <AlertDialog
        open={deleteTermTarget !== null}
        onOpenChange={(o) => !deleting && !o && setDeleteTermTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete &ldquo;{deleteTermTarget?.term_name}&rdquo;?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {(() => {
                const refs = deleteTermTarget
                  ? (termDayRefs.get(deleteTermTarget.id) ?? 0)
                  : 0;
                const school = deleteTermTarget
                  ? (termSchoolDays.get(deleteTermTarget.id) ?? 0)
                  : 0;
                return refs > 0
                  ? `This term still covers ${school} school days (${refs} days on the calendar reference it) — those days will keep pointing at a term that no longer exists. This can't be undone.`
                  : "This can't be undone.";
              })()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>
              Keep term
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700"
              onClick={(e) => {
                e.preventDefault();
                if (!deleteTermTarget) return;
                void runDelete(
                  `/api/admin/academic-terms/${deleteTermTarget.id}`,
                  "Term",
                  () => setDeleteTermTarget(null)
                );
              }}
            >
              {deleting ? "Deleting…" : "Delete term"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Season delete confirm */}
      <AlertDialog
        open={deleteSeasonTarget !== null}
        onOpenChange={(o) =>
          !deleting && !o && setDeleteSeasonTarget(null)
        }
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete &ldquo;{deleteSeasonTarget?.name}&rdquo;?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {(() => {
                const n = deleteSeasonTarget
                  ? (seasonInfo.get(deleteSeasonTarget.id)?.total ?? 0)
                  : 0;
                return n > 0
                  ? `Clears the season from the ${n} days assigned to it, then deletes it. This can't be undone.`
                  : "This can't be undone.";
              })()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>
              Keep season
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700"
              onClick={(e) => {
                e.preventDefault();
                if (!deleteSeasonTarget) return;
                void runDelete(
                  `/api/admin/academic-seasons/${deleteSeasonTarget.id}`,
                  "Season",
                  () => setDeleteSeasonTarget(null)
                );
              }}
            >
              {deleting ? "Deleting…" : "Delete season"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** Small modal for adding/editing one academic term. */
function TermEditDialog({
  yearId,
  existing,
  onDone,
}: {
  yearId: number;
  /** Null = creating a new term. */
  existing: XanoAcademicTerm | null;
  onDone: (saved: boolean) => void;
}) {
  const [name, setName] = useState(existing?.term_name ?? "");
  const [startDate, setStartDate] = useState(existing?.start_date ?? "");
  const [endDate, setEndDate] = useState(existing?.end_date ?? "");
  const [active, setActive] = useState(existing?.isActive === true);
  const [saving, setSaving] = useState(false);

  const rangeInvalid = Boolean(startDate && endDate && endDate < startDate);

  async function save() {
    const trimmed = name.trim();
    if (!trimmed || saving || rangeInvalid) return;
    setSaving(true);
    try {
      const res = await fetch(
        existing
          ? `/api/admin/academic-terms/${existing.id}`
          : "/api/admin/academic-terms",
        {
          method: existing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            term_name: trimmed,
            start_date: startDate || null,
            end_date: endDate || null,
            isActive: active,
            ...(existing
              ? {}
              : { registration_school_years_id: yearId }),
          }),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? `Save failed (${res.status})`);
      }
      toast.success(existing ? "Term updated." : "Term added.");
      onDone(true);
    } catch (err) {
      console.error("Failed to save term:", err);
      toast.error(
        err instanceof Error ? err.message : "Couldn't save term."
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
            {existing ? `Edit ${existing.term_name}` : "New term"}
          </DialogTitle>
          <DialogDescription>
            Term name, date range, and whether it&rsquo;s the active
            term.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Term 1"
              autoFocus
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Starts</Label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Ends</Label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>
          {rangeInvalid ? (
            <p className="text-xs text-red-600">
              End date can&rsquo;t be before the start date.
            </p>
          ) : null}
          {existing && (existing.start_date || existing.end_date) ? (
            <p className="text-[11px] text-muted-foreground">
              Saved dates can be changed here, but not cleared.
            </p>
          ) : null}
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="term-active" className="text-xs font-normal">
              Active term
            </Label>
            <Switch
              id="term-active"
              size="sm"
              checked={active}
              onCheckedChange={setActive}
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
            disabled={saving || !name.trim() || rangeInvalid}
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

/**
 * Small modal for adding/editing one season. The date range here
 * drives the calendar-day assignment: saving stamps `seasons_id` on
 * every day row in the range (via the season's /days endpoint) and
 * clears rows that fell out of it, so the season always reflects the
 * selected dates. Both dates blank = clear the assignment.
 */
function SeasonEditDialog({
  yearId,
  terms,
  days,
  existing,
  onDone,
}: {
  yearId: number;
  terms: XanoAcademicTerm[];
  days: XanoSchoolCalendarDay[];
  /** Null = creating a new season. */
  existing: XanoAcademicSeason | null;
  onDone: (saved: boolean) => void;
}) {
  // Days currently assigned to this season (days arrive date-sorted),
  // seeding the range inputs with the season's present span.
  const assigned = existing
    ? days.filter((d) => Number(d.seasons_id) === existing.id)
    : [];
  const [name, setName] = useState(existing?.name ?? "");
  const [termId, setTermId] = useState(
    String(existing?.registration_academic_terms_id || 0)
  );
  const [startDate, setStartDate] = useState(assigned[0]?.date ?? "");
  const [endDate, setEndDate] = useState(
    assigned[assigned.length - 1]?.date ?? ""
  );
  const [saving, setSaving] = useState(false);

  const minDate = days[0]?.date;
  const maxDate = days[days.length - 1]?.date;
  const halfRange = Boolean(startDate) !== Boolean(endDate);
  const rangeInvalid =
    halfRange || Boolean(startDate && endDate && endDate < startDate);

  const schoolDaysInRange =
    startDate && endDate && endDate >= startDate
      ? days.filter(
          (d) =>
            d.date >= startDate &&
            d.date <= endDate &&
            d.type === "School"
        ).length
      : 0;

  async function save() {
    const trimmed = name.trim();
    if (!trimmed || saving || rangeInvalid) return;
    setSaving(true);
    try {
      const res = await fetch(
        existing
          ? `/api/admin/academic-seasons/${existing.id}`
          : "/api/admin/academic-seasons",
        {
          method: existing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: trimmed,
            registration_academic_terms_id: Number(termId) || 0,
            ...(existing
              ? {}
              : { registration_school_years_id: yearId }),
          }),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? `Save failed (${res.status})`);
      }
      const saved = await res.json().catch(() => null);
      const seasonId = existing?.id ?? Number(saved?.id);

      // Day assignment: set when a full range is picked; clear when
      // the range was blanked out and the season had days before.
      const wantAssign = Boolean(startDate && endDate);
      const wantClear =
        !startDate && !endDate && assigned.length > 0;
      if (seasonId && (wantAssign || wantClear)) {
        const dres = await fetch(
          `/api/admin/academic-seasons/${seasonId}/days`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              yearId,
              start_date: wantAssign ? startDate : null,
              end_date: wantAssign ? endDate : null,
            }),
          }
        );
        if (!dres.ok) {
          const err = await dres.json().catch(() => null);
          toast.error(
            err?.error ??
              "Season saved, but assigning its days failed — reopen it and try again."
          );
          onDone(true);
          return;
        }
      }
      toast.success(existing ? "Season updated." : "Season added.");
      onDone(true);
    } catch (err) {
      console.error("Failed to save season:", err);
      toast.error(
        err instanceof Error ? err.message : "Couldn't save season."
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
            {existing ? `Edit ${existing.name}` : "New season"}
          </DialogTitle>
          <DialogDescription>
            Name the season, link it to a term, and pick the calendar
            dates it covers.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Season 1"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Linked term</Label>
            <Select value={termId} onValueChange={setTermId}>
              <SelectTrigger className="w-full bg-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">Not linked</SelectItem>
                {terms.map((t) => (
                  <SelectItem key={t.id} value={String(t.id)}>
                    {t.term_name}
                    {t.start_date && t.end_date
                      ? ` (${fmtShortDate(t.start_date)} – ${fmtShortDate(t.end_date)})`
                      : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Starts</Label>
              <Input
                type="date"
                value={startDate}
                min={minDate}
                max={maxDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Ends</Label>
              <Input
                type="date"
                value={endDate}
                min={minDate}
                max={maxDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>
          {halfRange ? (
            <p className="text-xs text-red-600">
              Set both dates — or leave both blank to clear the
              season&rsquo;s days.
            </p>
          ) : startDate && endDate && endDate < startDate ? (
            <p className="text-xs text-red-600">
              End date can&rsquo;t be before the start date.
            </p>
          ) : startDate && endDate ? (
            <p className="text-[11px] text-muted-foreground">
              Assigns every calendar day in this range to the season
              ({schoolDaysInRange} school days). Days already in another
              season move to this one.
            </p>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              The season&rsquo;s dates come from the calendar days
              assigned to it.
            </p>
          )}
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
            disabled={saving || !name.trim() || rangeInvalid}
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

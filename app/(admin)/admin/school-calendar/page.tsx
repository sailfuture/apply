"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import {
  ChevronLeft,
  ChevronRight,
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
 * jump the month view to a term and filter the Agenda view — a
 * chronological stream of every event. The Terms & seasons sheet is
 * full CRUD over `registration_academic_terms` /
 * `registration_academic_seasons`. The year comes from the top-bar
 * year picker; ordinal "Term N" labels remain the fallback for
 * `terms_id`s the terms table doesn't know.
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

  const [view, setView] = useState<"month" | "agenda">("month");
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

  /** Agenda stream — every event (optionally one term's), grouped by
   *  day, chronological. */
  const agendaGroups = useMemo(() => {
    const dayById = new Map(days.map((d) => [d.id, d]));
    const rows: Array<{
      e: XanoSchoolCalendarEvent;
      day: XanoSchoolCalendarDay;
    }> = [];
    for (const e of events) {
      const day = dayById.get(Number(e.school_calendar_id));
      if (!day) continue;
      if (termFilter !== "all" && day.terms_id !== termFilter) continue;
      rows.push({ e, day });
    }
    rows.sort(
      (a, b) =>
        a.day.date.localeCompare(b.day.date) ||
        (a.e.start_time ?? 0) - (b.e.start_time ?? 0)
    );
    const groups: Array<{
      date: string;
      day: XanoSchoolCalendarDay;
      items: XanoSchoolCalendarEvent[];
    }> = [];
    for (const r of rows) {
      const last = groups[groups.length - 1];
      if (last && last.date === r.day.date) last.items.push(r.e);
      else groups.push({ date: r.day.date, day: r.day, items: [r.e] });
    }
    return groups;
  }, [days, events, termFilter]);

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
          {/* Legend — month view only, hidden on narrow viewports
              where it would wrap the toolbar onto three lines. */}
          {view === "month" ? (
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
          ) : null}
          <Select
            value={view}
            onValueChange={(v) => setView(v as "month" | "agenda")}
          >
            <SelectTrigger
              className="h-8 w-[110px] bg-white"
              aria-label="Calendar view"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="month">Month</SelectItem>
              <SelectItem value="agenda">Agenda</SelectItem>
            </SelectContent>
          </Select>
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

      {/* Term chips — jump the month view to a term and filter the
          agenda stream. */}
      {terms.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            aria-pressed={termFilter === "all"}
            onClick={() => setTermFilter("all")}
            className={cn(
              "rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
              termFilter === "all"
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-white text-muted-foreground hover:border-foreground/40 hover:text-foreground"
            )}
          >
            All terms
          </button>
          {terms.map((t) => {
            const on = termFilter === t.id;
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
                onClick={() => selectTerm(t)}
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
                  on
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-white text-muted-foreground hover:border-foreground/40 hover:text-foreground"
                )}
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
      ) : view === "agenda" ? (
        /* Agenda — a chronological stream of every event (or one
           term's), grouped by day. Rows open the day sheet for edits. */
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-white">
          {agendaGroups.length === 0 ? (
            <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
              No events{termFilter !== "all" ? " in this term" : ""} yet —
              use New event to add one.
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto">
              {agendaGroups.map((g) => (
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
                            onClick={() => setSelectedDayId(g.day.id)}
                            className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/40"
                          >
                            <span
                              className={cn(
                                "size-2.5 shrink-0 rounded-full",
                                c ? c.dot : "bg-slate-300"
                              )}
                            />
                            <span className="w-32 shrink-0 text-xs tabular-nums text-muted-foreground">
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
              ))}
            </div>
          )}
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

      {/* Terms & seasons management */}
      {termsOpen ? (
        <TermsSheet
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
 * Time dropdown in 15-minute steps with a "No time" clear option —
 * friendlier than the native time input. An off-grid stored value
 * (e.g. 8:05 from the old free-text input) is kept as an extra option
 * so editing doesn't silently drop it.
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
  const options = useMemo(() => {
    if (!value || TIME_OPTIONS.some((o) => o.value === value)) {
      return TIME_OPTIONS;
    }
    const [h, m] = value.split(":").map(Number);
    return [
      ...TIME_OPTIONS,
      { value, label: timeLabel12(h ?? 0, m ?? 0) },
    ].sort((a, b) => a.value.localeCompare(b.value));
  }, [value]);
  return (
    <Select
      value={value || "none"}
      onValueChange={(v) => onChange(v === "none" ? "" : v)}
    >
      <SelectTrigger className="w-full bg-white" aria-label={ariaLabel}>
        <SelectValue placeholder="No time" />
      </SelectTrigger>
      <SelectContent className="max-h-64">
        <SelectItem value="none">No time</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
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

/**
 * Right-hand sheet for managing the year's academic terms (name,
 * start/end dates, active flag) and seasons (name + linked term).
 * Full CRUD against /api/admin/academic-terms and
 * /api/admin/academic-seasons; every change refreshes the calendar's
 * single SWR key so term chips and labels update in place.
 */
function TermsSheet({
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
  // null = not editing; 0 = new row; otherwise the row id.
  const [editingTermId, setEditingTermId] = useState<number | null>(null);
  const [editingSeasonId, setEditingSeasonId] = useState<number | null>(
    null
  );
  const editingTerm =
    editingTermId && editingTermId > 0
      ? (terms.find((t) => t.id === editingTermId) ?? null)
      : null;
  const editingSeason =
    editingSeasonId && editingSeasonId > 0
      ? (seasons.find((s) => s.id === editingSeasonId) ?? null)
      : null;

  const [deleteTermTarget, setDeleteTermTarget] =
    useState<XanoAcademicTerm | null>(null);
  const [deleteSeasonTarget, setDeleteSeasonTarget] =
    useState<XanoAcademicSeason | null>(null);
  const [deleting, setDeleting] = useState(false);

  const termNameById = useMemo(
    () => new Map(terms.map((t) => [t.id, t.term_name])),
    [terms]
  );
  const dayCountByTerm = useMemo(() => {
    const m = new Map<number, number>();
    for (const d of days) {
      if (d.terms_id > 0) m.set(d.terms_id, (m.get(d.terms_id) ?? 0) + 1);
    }
    return m;
  }, [days]);

  async function runDelete(
    url: string,
    label: string,
    after: () => void
  ) {
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
      <Sheet open onOpenChange={(o) => !o && onClose()}>
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-lg"
        >
          <SheetHeader className="border-b px-4 py-3">
            <SheetTitle className="text-base">Terms &amp; seasons</SheetTitle>
            <SheetDescription className="text-xs">
              Academic term date ranges and the seasons tied to them for
              this school year.
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-5 px-4 py-4">
            {/* ── Terms ── */}
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Terms ({terms.length})
                </h3>
                {editingTermId === null ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="bg-white"
                    onClick={() => setEditingTermId(0)}
                  >
                    <Plus className="size-3.5 mr-1" />
                    Add term
                  </Button>
                ) : null}
              </div>

              {terms.length === 0 && editingTermId === null ? (
                <p className="text-sm text-muted-foreground">
                  No terms for this school year yet.
                </p>
              ) : null}

              <ul className="space-y-2">
                {terms.map((t) => {
                  const dayCount = dayCountByTerm.get(t.id) ?? 0;
                  return (
                    <li
                      key={t.id}
                      className="rounded-md border bg-muted/10 px-3 py-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {t.term_name}
                            {t.isActive ? (
                              <span className="ml-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-emerald-700 align-middle">
                                Active
                              </span>
                            ) : null}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {t.start_date && t.end_date
                              ? `${fmtShortDate(t.start_date)} – ${fmtShortDate(t.end_date)}`
                              : "No dates set"}
                            {dayCount
                              ? ` · ${dayCount} calendar days`
                              : ""}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="size-7 p-0"
                            onClick={() => setEditingTermId(t.id)}
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
                      </div>
                    </li>
                  );
                })}
              </ul>

              {editingTermId !== null ? (
                <TermForm
                  key={editingTermId}
                  yearId={yearId}
                  existing={editingTerm}
                  onDone={(saved) => {
                    setEditingTermId(null);
                    if (saved) onChanged();
                  }}
                />
              ) : null}
            </section>

            {/* ── Seasons ── */}
            <section className="space-y-3 border-t pt-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Seasons ({seasons.length})
                </h3>
                {editingSeasonId === null ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="bg-white"
                    onClick={() => setEditingSeasonId(0)}
                  >
                    <Plus className="size-3.5 mr-1" />
                    Add season
                  </Button>
                ) : null}
              </div>

              {seasons.length === 0 && editingSeasonId === null ? (
                <p className="text-sm text-muted-foreground">
                  No seasons for this school year yet.
                </p>
              ) : null}

              <ul className="space-y-2">
                {seasons.map((s) => {
                  const linkedTerm =
                    s.registration_academic_terms_id > 0
                      ? terms.find(
                          (t) => t.id === s.registration_academic_terms_id
                        )
                      : undefined;
                  return (
                    <li
                      key={s.id}
                      className="rounded-md border bg-muted/10 px-3 py-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {s.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {linkedTerm
                              ? `${linkedTerm.term_name}${
                                  linkedTerm.start_date &&
                                  linkedTerm.end_date
                                    ? ` · ${fmtShortDate(linkedTerm.start_date)} – ${fmtShortDate(linkedTerm.end_date)}`
                                    : ""
                                }`
                              : s.registration_academic_terms_id > 0
                                ? (termNameById.get(
                                    s.registration_academic_terms_id
                                  ) ?? "Linked term missing")
                                : "Not linked to a term"}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="size-7 p-0"
                            onClick={() => setEditingSeasonId(s.id)}
                            aria-label={`Edit ${s.name}`}
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="size-7 p-0 text-red-600 hover:text-red-700"
                            onClick={() => setDeleteSeasonTarget(s)}
                            aria-label={`Delete ${s.name}`}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>

              {editingSeasonId !== null ? (
                <SeasonForm
                  key={editingSeasonId}
                  yearId={yearId}
                  terms={terms}
                  existing={editingSeason}
                  onDone={(saved) => {
                    setEditingSeasonId(null);
                    if (saved) onChanged();
                  }}
                />
              ) : null}
            </section>
          </div>
        </SheetContent>
      </Sheet>

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
                const n = deleteTermTarget
                  ? (dayCountByTerm.get(deleteTermTarget.id) ?? 0)
                  : 0;
                return n > 0
                  ? `${n} calendar days currently reference this term — they'll keep pointing at a term that no longer exists. This can't be undone.`
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
        onOpenChange={(o) => !deleting && !o && setDeleteSeasonTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete &ldquo;{deleteSeasonTarget?.name}&rdquo;?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Removes this season from the school year. This can&rsquo;t
              be undone.
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

function TermForm({
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
    <div className="space-y-3 rounded-md border bg-white p-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {existing ? "Edit term" : "New term"}
      </p>
      <div className="space-y-1.5">
        <Label className="text-xs">Name</Label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Term 1"
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
          disabled={saving || !name.trim() || rangeInvalid}
        >
          {saving ? (
            <>
              <Loader2 className="size-3.5 mr-1.5 animate-spin" />
              Saving
            </>
          ) : existing ? (
            "Save changes"
          ) : (
            "Add term"
          )}
        </Button>
      </div>
    </div>
  );
}

function SeasonForm({
  yearId,
  terms,
  existing,
  onDone,
}: {
  yearId: number;
  terms: XanoAcademicTerm[];
  /** Null = creating a new season. */
  existing: XanoAcademicSeason | null;
  onDone: (saved: boolean) => void;
}) {
  const [name, setName] = useState(existing?.name ?? "");
  const [termId, setTermId] = useState(
    String(existing?.registration_academic_terms_id || 0)
  );
  const [saving, setSaving] = useState(false);

  async function save() {
    const trimmed = name.trim();
    if (!trimmed || saving) return;
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
    <div className="space-y-3 rounded-md border bg-white p-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {existing ? "Edit season" : "New season"}
      </p>
      <div className="space-y-1.5">
        <Label className="text-xs">Name</Label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Season 1"
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
        <p className="text-[11px] text-muted-foreground">
          Seasons take their dates from the linked term.
        </p>
      </div>
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
          disabled={saving || !name.trim()}
        >
          {saving ? (
            <>
              <Loader2 className="size-3.5 mr-1.5 animate-spin" />
              Saving
            </>
          ) : existing ? (
            "Save changes"
          ) : (
            "Add season"
          )}
        </Button>
      </div>
    </div>
  );
}

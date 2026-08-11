"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import {
  CalendarDays,
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  List,
  MapPin,
} from "lucide-react";
import { apiFetcher, useApplications, useSchoolYears } from "@/hooks/use-api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { DashboardPageHeader } from "@/components/dashboard-page-header";
import { cn } from "@/lib/utils";
import { eventColor, parseDate, parseNeeds } from "@/lib/school-calendar";
import type { ParentSchoolCalendarResponse } from "@/app/api/school-calendar/route";
import type {
  XanoSchoolCalendarDay,
  XanoSchoolCalendarEvent,
} from "@/lib/xano";

/** The school calendar as published in Google Calendar. Both the
 *  "view it" link and the subscribe/download links are built from this
 *  one id so they can never drift apart.
 *
 *  This is the calendar the app PUSHES to (`GOOGLE_SCHOOL_CALENDAR_ID`
 *  server-side) — keep the two in step. It replaced an
 *  `@import.calendar.google.com` id, which was Google's own read-only
 *  subscription to our ICS feed: a second copy of the same events that
 *  the API could never write to.
 *
 *  Requires "Make available to public" on the calendar, or the embed
 *  and /public/basic.ics links below 404 for signed-out parents. */
const SCHOOL_CALENDAR_ID =
  "c_e9f69a1c071a973f0086ec5606b4262fe2ade4a9a13db6c47f0e438d002ed4e7@group.calendar.google.com";
const SCHOOL_CALENDAR_TZ = "America/New_York";

/** Public, signed-out-safe view of the calendar.
 *
 *  Deliberately NOT the `/calendar/u/0/newembed?...` URL Google's embed
 *  builder hands you: the `u/0` picks the *viewer's* first signed-in
 *  Google account, so it lands wrong for a parent with several accounts
 *  and can prompt a sign-in for one with none. `/calendar/embed` is the
 *  shareable form of the same calendar and renders for anyone. */
const LIVE_CALENDAR_URL = `https://calendar.google.com/calendar/embed?src=${encodeURIComponent(
  SCHOOL_CALENDAR_ID
)}&ctz=${encodeURIComponent(SCHOOL_CALENDAR_TZ)}`;

/** Subscribable / downloadable ICS for the same calendar — what a
 *  calendar app actually consumes (the embed URL is a web page and
 *  can't be subscribed to). */
const CALENDAR_ICS_URL = `https://calendar.google.com/calendar/ical/${encodeURIComponent(
  SCHOOL_CALENDAR_ID
)}/public/basic.ics`;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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

function fmtTime(ms: number | null | undefined): string {
  if (!ms || !Number.isFinite(ms)) return "";
  return new Date(ms).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function agendaDateLabel(iso: string): string {
  return parseDate(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/**
 * Parent-facing School Calendar page — a read-only view of the year's
 * `school_calendar` days and their events. Month grid (with Today +
 * chevron nav) and an Agenda view listing every event chronologically;
 * clicking a day (or agenda row) opens a details sheet for that day.
 * The header links out to the live public calendar on the Academy
 * website.
 */
export default function ParentCalendarPage() {
  const searchParams = useSearchParams();
  const yearIdParam = searchParams.get("yearId");
  const requestedYearId = yearIdParam ? Number(yearIdParam) : null;

  const { data: applications } = useApplications();
  const { data: yearsData } = useSchoolYears();

  // Same defensive fallback as the Tuition page: without ?yearId, pick
  // the most recent year this family has any application for.
  const yearId: number | null = useMemo(() => {
    if (requestedYearId !== null && Number.isFinite(requestedYearId)) {
      return requestedYearId;
    }
    if (!applications) return null;
    const ids = Array.from(
      new Set(
        (applications as { registration_school_years_id: number }[]).map(
          (a) => a.registration_school_years_id
        )
      )
    );
    if (ids.length === 0) return null;
    return ids.reduce((max, yid) => (yid > max ? yid : max));
  }, [requestedYearId, applications]);

  const yearName = useMemo(() => {
    if (!yearId || !yearsData) return "current";
    return (
      (yearsData as { id: number; year_name: string }[]).find(
        (y) => y.id === yearId
      )?.year_name ?? "current"
    );
  }, [yearId, yearsData]);

  const { data, error } = useSWR<ParentSchoolCalendarResponse>(
    yearId ? `/api/school-calendar?yearId=${yearId}` : null,
    apiFetcher,
    { revalidateOnFocus: false, dedupingInterval: 30000 }
  );

  const days = useMemo(() => data?.days ?? [], [data]);
  const events = useMemo(() => data?.events ?? [], [data]);
  const terms = useMemo(() => data?.terms ?? [], [data]);

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

  /** terms_id → display name (real names when available, ordinal
   *  fallback for ids the terms table doesn't know). */
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
  // else the first month.
  const effectiveMonthIdx = useMemo(() => {
    if (monthIdx !== null && monthIdx >= 0 && monthIdx < months.length) {
      return monthIdx;
    }
    const idx = months.indexOf(monthKeyOf(localIso(new Date())));
    return idx >= 0 ? idx : 0;
  }, [monthIdx, months]);
  const monthKey = months[effectiveMonthIdx] ?? null;

  const [view, setView] = useState<"month" | "agenda">("month");
  const [selectedDayId, setSelectedDayId] = useState<number | null>(null);
  const selectedDay = useMemo(
    () => days.find((d) => d.id === selectedDayId) ?? null,
    [days, selectedDayId]
  );

  // Month grid cells — leading/trailing blanks pad to full weeks.
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

  const todayIso = localIso(new Date());
  const todayMonthIdx = months.indexOf(monthKeyOf(todayIso));

  // Agenda rows — every event, chronological, grouped by day.
  const agendaGroups = useMemo(() => {
    const dayById = new Map(days.map((d) => [d.id, d]));
    const rows: Array<{
      e: XanoSchoolCalendarEvent;
      day: XanoSchoolCalendarDay;
    }> = [];
    for (const e of events) {
      const day = dayById.get(Number(e.school_calendar_id));
      if (day) rows.push({ e, day });
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
  }, [days, events]);

  const dashboardHref = yearId ? `/dashboard?yearId=${yearId}` : "/dashboard";
  const loading = !applications || !yearsData || (yearId !== null && !data && !error);

  return (
    <div className="flex flex-1 flex-col gap-6 p-6 mx-auto w-full max-w-5xl">
      <DashboardPageHeader
        backHref={dashboardHref}
        backLabel="Back to Dashboard"
        breadcrumb={[
          { label: "Dashboard", href: dashboardHref },
          { label: yearName, href: dashboardHref },
          { label: "School Calendar" },
        ]}
        title={`School Calendar — ${yearName} School Year`}
        subtitle="School days, breaks, holidays, and events for the year. Event details can change — check the live calendar for the latest."
        backRowAction={
          <div className="flex items-center gap-2">
            <SubscribeButton />
            <Button asChild variant="outline" size="sm" className="bg-white">
              <a
                href={LIVE_CALENDAR_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                View live calendar
                <ExternalLink className="size-3.5 ml-1.5" />
              </a>
            </Button>
          </div>
        }
      />

      {loading ? (
        <CalendarSkeleton />
      ) : error ? (
        <div className="rounded-xl border bg-white px-6 py-12 text-center text-sm text-muted-foreground">
          Couldn&rsquo;t load the calendar right now — please try again in a
          moment, or use the{" "}
          <a
            href={LIVE_CALENDAR_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline underline-offset-2"
          >
            live calendar
          </a>
          .
        </div>
      ) : days.length === 0 ? (
        <div className="rounded-xl border bg-white px-6 py-12 text-center text-sm text-muted-foreground">
          The {yearName} calendar hasn&rsquo;t been published yet. In the
          meantime, the{" "}
          <a
            href={LIVE_CALENDAR_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline underline-offset-2"
          >
            live calendar on our website
          </a>{" "}
          has the latest dates.
        </div>
      ) : (
        <>
          {/* Toolbar — month nav on the left, legend + view toggle on
              the right. */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                className="mr-1 bg-white"
                disabled={
                  view !== "month" ||
                  todayMonthIdx < 0 ||
                  todayMonthIdx === effectiveMonthIdx
                }
                onClick={() => setMonthIdx(todayMonthIdx)}
              >
                Today
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="size-8 p-0"
                disabled={view !== "month" || effectiveMonthIdx <= 0}
                onClick={() => setMonthIdx(effectiveMonthIdx - 1)}
                aria-label="Previous month"
              >
                <ChevronLeft className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="size-8 p-0"
                disabled={
                  view !== "month" || effectiveMonthIdx >= months.length - 1
                }
                onClick={() => setMonthIdx(effectiveMonthIdx + 1)}
                aria-label="Next month"
              >
                <ChevronRight className="size-4" />
              </Button>
              <h2 className="ml-2 text-lg font-semibold tracking-tight">
                {view === "month" && monthKey
                  ? monthLabel(monthKey)
                  : "All events"}
              </h2>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {/* Legend — hidden on narrow viewports. */}
              <div className="mr-2 hidden items-center gap-3 text-[11px] text-muted-foreground lg:flex">
                <LegendSwatch className="bg-white border" label="School" />
                <LegendSwatch className="bg-muted/60" label="Weekend" />
                <LegendSwatch className="bg-sky-100" label="Break" />
                <span className="inline-flex items-center gap-1">
                  <span className="size-2 rounded-full bg-rose-500" />
                  Holiday
                </span>
              </div>
              <div className="flex items-center rounded-md border bg-white p-0.5">
                <button
                  type="button"
                  aria-pressed={view === "month"}
                  onClick={() => setView("month")}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors",
                    view === "month"
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <CalendarDays className="size-3.5" />
                  Month
                </button>
                <button
                  type="button"
                  aria-pressed={view === "agenda"}
                  onClick={() => setView("agenda")}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors",
                    view === "agenda"
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <List className="size-3.5" />
                  Agenda
                </button>
              </div>
            </div>
          </div>

          {view === "month" ? (
            <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
              {/* Weekday header */}
              <div className="grid grid-cols-7 border-b">
                {WEEKDAYS.map((w) => (
                  <div
                    key={w}
                    className="py-2 text-center text-xs font-medium text-muted-foreground"
                  >
                    {w}
                  </div>
                ))}
              </div>
              {/* Month grid. `auto-rows-fr` makes every week the same
                  height: without it each row sizes to its own tallest
                  cell, so a week with two events stands visibly taller
                  than an empty one and the grid looks like it's
                  shrinking toward the bottom of the month. The
                  per-cell `min-h-*` still sets the floor. */}
              <div className="grid auto-rows-fr grid-cols-7">
                {cells.map((cell, i) => {
                  const edge = cn(
                    i % 7 !== 6 && "border-r",
                    i < cells.length - 7 && "border-b"
                  );
                  if (cell === null) {
                    return (
                      <div
                        key={`blank-${i}`}
                        className={cn("min-h-20 bg-muted/20 sm:min-h-28", edge)}
                      />
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
                      className={edge}
                      onOpen={() => cell.day && setSelectedDayId(cell.day.id)}
                    />
                  );
                })}
              </div>
            </div>
          ) : (
            /* Agenda — every event on the year's calendar, oldest first,
               grouped by day with sticky date headers. */
            <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
              {agendaGroups.length === 0 ? (
                <p className="px-6 py-12 text-center text-sm text-muted-foreground">
                  No events on this year&rsquo;s calendar yet.
                </p>
              ) : (
                agendaGroups.map((g) => (
                  <div key={g.date}>
                    <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-muted/60 px-4 py-1.5 backdrop-blur">
                      <span className="text-xs font-semibold">
                        {agendaDateLabel(g.date)}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {termLabel.get(g.day.terms_id) ?? ""}
                      </span>
                    </div>
                    <ul className="divide-y border-b last:border-b-0">
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
                              <span className="w-32 shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-foreground sm:w-40">
                                {e.start_time
                                  ? `${fmtTime(e.start_time)}${
                                      e.end_time
                                        ? ` – ${fmtTime(e.end_time)}`
                                        : ""
                                    }`
                                  : "All day"}
                              </span>
                              <span className="min-w-0 flex-1 truncate text-sm">
                                <span className="font-medium">{e.title}</span>
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
                                {e.location ? (
                                  <span className="text-muted-foreground">
                                    {" "}
                                    · <MapPin className="inline size-3" />{" "}
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
          )}
        </>
      )}

      {/* Day details — read-only sheet listing the day's events. */}
      {selectedDay ? (
        <DayDetailsSheet
          key={selectedDay.id}
          day={selectedDay}
          events={eventsByDay.get(selectedDay.id) ?? []}
          termLabel={termLabel.get(selectedDay.terms_id) ?? ""}
          onClose={() => setSelectedDayId(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * "Add to my calendar" — subscription links for the school's Google
 * Calendar. Subscribing (not importing) keeps the parent's calendar
 * app refreshing on its own, so new school events flow in
 * automatically. Google users get Google's native "add this calendar"
 * screen, which only needs the calendar id; Apple/Outlook get the
 * webcal: form of the public ICS, and a copy field covers everything
 * else.
 */
function SubscribeButton() {
  const [open, setOpen] = useState(false);
  const webcalUrl = CALENDAR_ICS_URL.replace(/^https?:\/\//, "webcal://");
  const googleUrl = `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(
    SCHOOL_CALENDAR_ID
  )}`;

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="bg-white"
        onClick={() => setOpen(true)}
      >
        <CalendarPlus className="size-3.5 mr-1.5" />
        Add to my calendar
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add the school calendar to your own</DialogTitle>
            <DialogDescription>
              Subscribe once and school events show up in your calendar
              app — and stay updated automatically when dates change.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Button asChild variant="outline" className="w-full bg-white">
              <a href={googleUrl} target="_blank" rel="noopener noreferrer">
                <CalendarPlus className="size-4 mr-2" />
                Add to Google Calendar
              </a>
            </Button>
            <Button asChild variant="outline" className="w-full bg-white">
              <a href={webcalUrl}>
                <CalendarPlus className="size-4 mr-2" />
                Add to Apple Calendar / Outlook
              </a>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
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

/** One month-grid day — read-only version of the admin calendar's day
 *  cell: tint by day type, holiday dot, extern/intern rotation badge,
 *  event chips (capped), term/rotation boundary bubbles. */
function DayCell({
  date,
  day,
  events,
  termLabel,
  isToday,
  className,
  onOpen,
}: {
  date: string;
  day: XanoSchoolCalendarDay | null;
  events: XanoSchoolCalendarEvent[];
  termLabel: string;
  isToday: boolean;
  className?: string;
  onOpen: () => void;
}) {
  const num = Number(date.slice(8));
  if (!day) {
    // A month-edge day outside the school year's generated range.
    return (
      <div
        className={cn(
          "min-h-20 p-1.5 text-xs tabular-nums text-muted-foreground/40 sm:min-h-28",
          className
        )}
      >
        {num}
      </div>
    );
  }
  const isBreak = day.type === "Break" || day.break;
  const isWeekend = day.type === "Weekend";
  // Trim — clearing the rotation stores the " " sentinel (Xano edits
  // drop empty strings), which must read as "none".
  const workType = (day.work_type ?? "").trim();
  const boundaries: string[] = [];
  if (day.first_day_term) boundaries.push(`${termLabel || "Term"} starts`);
  if (day.last_day_term) boundaries.push(`${termLabel || "Term"} ends`);
  if (day.first_day_extern_term) boundaries.push("Externship starts");
  if (day.last_day_extern_term) boundaries.push("Externship ends");
  if (day.first_day_intern_term) boundaries.push("Internship starts");
  if (day.last_day_intern_term) boundaries.push("Internship ends");

  const MAX_CHIPS = 2;
  const shown = events.slice(0, MAX_CHIPS);
  const extra = events.length - shown.length;

  return (
    <button
      type="button"
      onClick={onOpen}
      title={[
        `${day.day_of_week} · ${day.type}${workType ? ` · ${workType}` : ""}`,
        day.holiday ? "Holiday" : "",
        ...boundaries,
        ...events.map((e) =>
          e.start_time ? `${fmtTime(e.start_time)} ${e.title}` : e.title
        ),
      ]
        .filter(Boolean)
        .join("\n")}
      className={cn(
        "flex min-h-20 flex-col gap-1 overflow-hidden p-1.5 text-left text-xs transition-colors sm:min-h-28",
        isBreak
          ? "bg-sky-100/60 hover:bg-sky-100"
          : isWeekend
            ? "bg-muted/50 text-muted-foreground hover:bg-muted/70"
            : "bg-white hover:bg-muted/40",
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
          {workType === "Externship" ? (
            <span className="hidden rounded-full bg-indigo-100 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-indigo-700 sm:inline">
              Extern
            </span>
          ) : workType === "Internship" ? (
            <span className="hidden rounded-full bg-orange-100 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-orange-700 sm:inline">
              Intern
            </span>
          ) : null}
        </span>
      </span>
      {/* Event chips — hidden on very narrow cells (the dot column
          below covers mobile); long titles truncate to one row. */}
      {shown.length > 0 ? (
        <span className="hidden min-h-0 flex-col gap-1 overflow-hidden sm:flex">
          {shown.map((e) => {
            const c = eventColor(e.color);
            return (
              <span
                key={e.id}
                className={cn(
                  "block shrink-0 truncate whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-4",
                  c ? c.chip : "bg-slate-200/70 text-slate-800"
                )}
              >
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
      {/* Mobile: event dots instead of chips. */}
      {events.length > 0 ? (
        <span className="flex items-center gap-0.5 sm:hidden">
          {events.slice(0, 4).map((e) => {
            const c = eventColor(e.color);
            return (
              <span
                key={e.id}
                className={cn(
                  "size-1.5 rounded-full",
                  c ? c.dot : "bg-slate-300"
                )}
              />
            );
          })}
        </span>
      ) : null}
      {/* Term / rotation boundary bubbles pinned to the cell bottom. */}
      {boundaries.length > 0 ? (
        <span className="mt-auto hidden min-h-0 shrink-0 flex-col gap-1 overflow-hidden pt-0.5 sm:flex">
          {boundaries.slice(0, 2).map((b) => (
            <span
              key={b}
              className="block shrink-0 truncate whitespace-nowrap rounded-md bg-emerald-100 px-1.5 py-0.5 text-[11px] font-medium leading-4 text-emerald-800"
            >
              {b}
            </span>
          ))}
        </span>
      ) : null}
    </button>
  );
}

/** Read-only day sheet — the day's type/term context plus each event's
 *  full details (time, location, description, category, chips). */
function DayDetailsSheet({
  day,
  events,
  termLabel,
  onClose,
}: {
  day: XanoSchoolCalendarDay;
  events: XanoSchoolCalendarEvent[];
  termLabel: string;
  onClose: () => void;
}) {
  const dateLabel = parseDate(day.date).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const workType = (day.work_type ?? "").trim();

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-y-auto overscroll-contain p-0 sm:max-w-lg"
      >
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle className="text-base">{dateLabel}</SheetTitle>
          <SheetDescription className="text-xs">
            {[
              termLabel || null,
              day.type,
              workType || null,
              day.holiday ? "Holiday" : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </SheetDescription>
        </SheetHeader>

        {/* Events as flat line sections — one block per event divided
            by hairlines, each detail on its own labelled row (no inner
            cards). */}
        <div className="divide-y">
          {events.length === 0 ? (
            <p className="px-4 py-4 text-sm text-muted-foreground">
              No events on this day.
            </p>
          ) : (
            events.map((e) => {
              const c = eventColor(e.color);
              const needs = parseNeeds(e.needs);
              return (
                <section key={e.id} className="px-4 py-4">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "size-2.5 shrink-0 rounded-full",
                        c ? c.dot : "bg-slate-300"
                      )}
                      aria-hidden
                    />
                    <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">
                      {e.title}
                    </h3>
                    {c ? (
                      <span
                        className={cn(
                          "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
                          c.chip
                        )}
                      >
                        {c.label}
                      </span>
                    ) : null}
                  </div>

                  <dl className="mt-3 space-y-2.5 text-sm">
                    <DetailLine label="Time">
                      {e.start_time
                        ? `${fmtTime(e.start_time)}${
                            e.end_time ? ` – ${fmtTime(e.end_time)}` : ""
                          }`
                        : "All day"}
                    </DetailLine>
                    {e.location ? (
                      <DetailLine label="Location">{e.location}</DetailLine>
                    ) : null}
                    {e.description ? (
                      <DetailLine label="Description">
                        <span className="whitespace-pre-wrap">
                          {e.description}
                        </span>
                      </DetailLine>
                    ) : null}
                    {needs.length > 0 ? (
                      <DetailLine label="Needs">
                        <ul className="list-disc space-y-0.5 pl-4 marker:text-muted-foreground/60">
                          {needs.map((n) => (
                            <li key={n}>{n}</li>
                          ))}
                        </ul>
                      </DetailLine>
                    ) : null}
                    {e.mandatory || e.parent_volunteer_hours ? (
                      <DetailLine label="Notes">
                        <span className="flex flex-wrap items-center gap-1.5">
                          {e.mandatory ? (
                            <span className="rounded-full border border-red-200 bg-red-50 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-red-700">
                              Mandatory
                            </span>
                          ) : null}
                          {e.parent_volunteer_hours ? (
                            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-emerald-700">
                              {e.volunteer_hour_total || 0} vol hrs
                            </span>
                          ) : null}
                        </span>
                      </DetailLine>
                    ) : null}
                  </dl>
                </section>
              );
            })
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** One labelled row in the day sheet's event details — label column
 *  left, value right. */
function DetailLine({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[5.5rem_1fr] gap-3">
      <dt className="text-xs leading-5 text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

/** Loading skeleton mirroring the toolbar + month grid. */
function CalendarSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-16 rounded-md" />
          <Skeleton className="h-8 w-8 rounded-md" />
          <Skeleton className="h-8 w-8 rounded-md" />
          <Skeleton className="ml-2 h-6 w-40" />
        </div>
        <Skeleton className="h-8 w-36 rounded-md" />
      </div>
      <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
        <div className="grid grid-cols-7 border-b">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="flex justify-center py-2">
              <Skeleton className="h-3 w-8" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {Array.from({ length: 35 }).map((_, i) => (
            <div
              key={i}
              className={cn(
                "min-h-20 p-1.5 sm:min-h-28",
                i % 7 !== 6 && "border-r",
                i < 28 && "border-b"
              )}
            >
              <Skeleton className="size-5 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

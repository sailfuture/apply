"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import {
  Bell,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  List,
  Loader2,
  MapPin,
  Pencil,
  Plus,
  RefreshCw,
  Settings2,
  Trash2,
} from "lucide-react";
import {
  EventUpsertDialog,
  eventColor,
  parseDate,
} from "@/components/admin/event-upsert-dialog";
import { EventReminderDialog } from "@/components/admin/event-reminder-dialog";
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

  /** seasons_id → ordinal badge ("S1"…) + full name, in table order —
   *  shown on day cells for days assigned to a season. */
  const seasonBadge = useMemo(() => {
    const m = new Map<number, { code: string; name: string }>();
    seasons.forEach((s, i) =>
      m.set(s.id, { code: `S${i + 1}`, name: s.name })
    );
    return m;
  }, [seasons]);

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
  const [syncingGoogle, setSyncingGoogle] = useState(false);

  /** Backfill/repair push of every event onto the shared school
   *  Google Calendar. Idempotent server-side (deterministic Google
   *  event ids), so clicking twice can't duplicate anything. */
  async function syncGoogle() {
    if (syncingGoogle) return;
    setSyncingGoogle(true);
    try {
      const res = await fetch("/api/admin/school-calendar/events/sync", {
        method: "POST",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error ?? `Sync failed (${res.status})`);
      }
      const pushed = Number(data?.pushed) || 0;
      const failedCount = Number(data?.failed) || 0;
      const skipped = Number(data?.skipped) || 0;
      if (failedCount > 0) {
        // Google's own words, not "check the server logs" — the
        // reason is almost always one fixable thing (calendar shared
        // read-only, wrong calendar id) and the admin can only act on
        // it if they can see it.
        toast.warning(
          `Pushed ${pushed} event${pushed === 1 ? "" : "s"}, ${failedCount} failed${
            data?.aborted ? " (stopped early — same error repeating)" : ""
          }.`,
          {
            description: data?.firstError ?? undefined,
            duration: 15000,
          }
        );
      } else {
        toast.success(
          `Google Calendar is up to date — ${pushed} event${pushed === 1 ? "" : "s"} pushed.`,
          {
            description:
              skipped > 0
                ? `${skipped} event${skipped === 1 ? "" : "s"} skipped — their calendar day no longer exists.`
                : undefined,
          }
        );
      }
    } catch (err) {
      console.error("Google Calendar sync failed:", err);
      toast.error("Couldn't sync to Google Calendar.", {
        description:
          err instanceof Error ? err.message : "Unknown error.",
        duration: 15000,
      });
    } finally {
      setSyncingGoogle(false);
    }
  }
  /** Event picked for an SMS reminder (from the day sheet or the
   *  events sheet) — the event plus its day's date. */
  const [remindTarget, setRemindTarget] = useState<{
    event: XanoSchoolCalendarEvent;
    date: string;
  } | null>(null);

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
      {/* Toolbar — Today · ‹ › · month title on the left; actions on
          the right. The month label doubles as the page heading,
          calendar-app style. */}
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
        {/* Actions stay pinned to the right edge — `ml-auto` +
            `justify-end` so they hold that edge even when the row
            wraps on a narrow viewport. */}
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            // Fixed width: the label swaps to "Syncing…" mid-request,
            // and letting the button resize shunted every control to
            // its right sideways on each click.
            className="w-[122px] shrink-0 bg-white"
            disabled={syncingGoogle}
            onClick={() => void syncGoogle()}
            title="Push every event to the school Google Calendar"
          >
            <RefreshCw
              className={cn("size-3.5 mr-1.5", syncingGoogle && "animate-spin")}
            />
            {syncingGoogle ? "Syncing…" : "Sync Google"}
          </Button>
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
                  season={
                    cell.day && cell.day.seasons_id > 0
                      ? (seasonBadge.get(cell.day.seasons_id) ?? null)
                      : null
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
          days={days}
          events={eventsByDay.get(selectedDay.id) ?? []}
          termLabel={termLabel.get(selectedDay.terms_id) ?? ""}
          seasonName={
            selectedDay.seasons_id > 0
              ? (seasonBadge.get(selectedDay.seasons_id)?.name ?? "")
              : ""
          }
          onClose={() => setSelectedDayId(null)}
          onChanged={() => void mutate()}
          onRemind={(event) =>
            setRemindTarget({ event, date: selectedDay.date })
          }
        />
      ) : null}

      {/* All-events stream — right-hand sheet; clicking a row opens
          a details modal with prev/next navigation. */}
      {eventsOpen ? (
        <EventsSheet
          days={days}
          events={events}
          terms={terms}
          termLabel={termLabel}
          onClose={() => setEventsOpen(false)}
          onChanged={() => void mutate()}
          onRemind={(event, date) => setRemindTarget({ event, date })}
        />
      ) : null}

      {/* Event SMS reminder (shared with the Volunteer Hours page) */}
      {remindTarget ? (
        <EventReminderDialog
          key={remindTarget.event.id}
          yearId={Number(yearId) || 0}
          event={{ ...remindTarget.event, date: remindTarget.date }}
          onDone={() => setRemindTarget(null)}
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
  showRanges = true,
}: {
  terms: XanoAcademicTerm[];
  value: number | "all";
  onAll: () => void;
  onTerm: (t: XanoAcademicTerm) => void;
  className?: string;
  /** The events sheet hides the date ranges (names only). */
  showRanges?: boolean;
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
          showRanges && t.start_date && t.end_date
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
  onChanged,
  onRemind,
}: {
  days: XanoSchoolCalendarDay[];
  events: XanoSchoolCalendarEvent[];
  terms: XanoAcademicTerm[];
  termLabel: Map<number, string>;
  onClose: () => void;
  onChanged: () => void;
  onRemind: (event: XanoSchoolCalendarEvent, date: string) => void;
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

  /** Flattened display-ordered rows — the detail modal's prev/next
   *  arrows walk this list. */
  const flat = useMemo(
    () => groups.flatMap((g) => g.items.map((e) => ({ e, day: g.day }))),
    [groups]
  );
  const idxById = useMemo(
    () => new Map(flat.map((r, i) => [r.e.id, i])),
    [flat]
  );
  const [detailIdx, setDetailIdx] = useState<number | null>(null);
  const detail = detailIdx !== null ? (flat[detailIdx] ?? null) : null;
  const [editTarget, setEditTarget] = useState<{
    event: XanoSchoolCalendarEvent;
    date: string;
  } | null>(null);

  return (
    <>
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl"
      >
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle className="text-base">Events</SheetTitle>
          <SheetDescription className="text-xs">
            Every event on this year&rsquo;s calendar. Click one for its
            details.
          </SheetDescription>
        </SheetHeader>
        {terms.length > 0 ? (
          <TermChipRow
            terms={terms}
            value={filter}
            onAll={() => setFilter("all")}
            onTerm={(t) => setFilter(t.id)}
            className="border-b px-4 py-2.5"
            showRanges={false}
          />
        ) : null}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
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
                          onClick={() =>
                            setDetailIdx(idxById.get(e.id) ?? null)
                          }
                          className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/40"
                        >
                          <span
                            className={cn(
                              "size-2.5 shrink-0 rounded-full",
                              c ? c.dot : "bg-slate-300"
                            )}
                          />
                          {/* Fixed-width, nowrap time so ranges never
                              break onto a second line. */}
                          <span className="w-40 shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                            {e.start_time
                              ? `${fmtTime(e.start_time)}${
                                  e.end_time
                                    ? ` – ${fmtTime(e.end_time)}`
                                    : ""
                                }`
                              : "All day"}
                          </span>
                          {/* Title · location on ONE truncating line. */}
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
      </SheetContent>
    </Sheet>

    {/* Event details modal — ← → (buttons or arrow keys) walk the
        filtered list without leaving the modal. */}
    {detail ? (
      <Dialog open onOpenChange={(o) => !o && setDetailIdx(null)}>
        <DialogContent
          className="sm:max-w-md"
          onKeyDown={(ev) => {
            if (ev.key === "ArrowLeft" && detailIdx !== null && detailIdx > 0) {
              setDetailIdx(detailIdx - 1);
            }
            if (
              ev.key === "ArrowRight" &&
              detailIdx !== null &&
              detailIdx < flat.length - 1
            ) {
              setDetailIdx(detailIdx + 1);
            }
          }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 pr-6">
              <span
                className={cn(
                  "size-2.5 shrink-0 rounded-full",
                  eventColor(detail.e.color)?.dot ?? "bg-slate-300"
                )}
                aria-hidden
              />
              <span className="min-w-0 truncate">{detail.e.title}</span>
            </DialogTitle>
            <DialogDescription>
              {termLabel.get(detail.day.terms_id) ?? "—"} · event{" "}
              {(detailIdx ?? 0) + 1} of {flat.length}
            </DialogDescription>
          </DialogHeader>
          {/* Keyed by event so arrow navigation fades the body in. */}
          <div
            key={detail.e.id}
            className="animate-in fade-in-0 space-y-2 duration-150"
          >
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <CalendarDays className="size-3.5 shrink-0" />
              {fmtMedDate(detail.day.date)}
            </p>
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Clock className="size-3.5 shrink-0" />
              {detail.e.start_time
                ? `${fmtTime(detail.e.start_time)}${
                    detail.e.end_time
                      ? ` – ${fmtTime(detail.e.end_time)}`
                      : ""
                  }`
                : "All day"}
            </p>
            {detail.e.location ? (
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <MapPin className="size-3.5 shrink-0" />
                <span className="truncate">{detail.e.location}</span>
              </p>
            ) : null}
            {detail.e.description ? (
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                {detail.e.description}
              </p>
            ) : null}
            {eventColor(detail.e.color) ||
            detail.e.mandatory ||
            detail.e.parent_volunteer_hours ? (
              <p className="flex flex-wrap items-center gap-1.5 pt-0.5">
                {(() => {
                  const c = eventColor(detail.e.color);
                  return c ? (
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-medium",
                        c.chip
                      )}
                    >
                      {c.label}
                    </span>
                  ) : null;
                })()}
                {detail.e.mandatory ? (
                  <span className="rounded-full border border-red-200 bg-red-50 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-red-700">
                    Mandatory
                  </span>
                ) : null}
                {detail.e.parent_volunteer_hours ? (
                  <span className="rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-emerald-700">
                    {detail.e.volunteer_hour_total || 0} vol hrs
                  </span>
                ) : null}
              </p>
            ) : null}
          </div>
          <DialogFooter className="flex-row items-center justify-between border-t pt-3 sm:justify-between">
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                className="size-8 bg-white p-0"
                disabled={detailIdx === null || detailIdx <= 0}
                onClick={() =>
                  detailIdx !== null && setDetailIdx(detailIdx - 1)
                }
                aria-label="Previous event"
              >
                <ChevronLeft className="size-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="size-8 bg-white p-0"
                disabled={
                  detailIdx === null || detailIdx >= flat.length - 1
                }
                onClick={() =>
                  detailIdx !== null && setDetailIdx(detailIdx + 1)
                }
                aria-label="Next event"
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="bg-white"
                onClick={() => onRemind(detail.e, detail.day.date)}
              >
                <Bell className="size-3.5 mr-1" />
                Remind
              </Button>
              <Button
                size="sm"
                onClick={() =>
                  setEditTarget({ event: detail.e, date: detail.day.date })
                }
              >
                <Pencil className="size-3.5 mr-1" />
                Edit
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    ) : null}

    {/* Edit from the details modal — shared upsert dialog. */}
    {editTarget ? (
      <EventUpsertDialog
        days={days}
        existing={editTarget}
        onDone={(saved) => {
          setEditTarget(null);
          if (saved) onChanged();
        }}
      />
    ) : null}
    </>
  );
}

function DayCell({
  date,
  day,
  events,
  termLabel,
  season,
  isToday,
  dimmed,
  className,
  onOpen,
}: {
  date: string;
  day: XanoSchoolCalendarDay | null;
  events: XanoSchoolCalendarEvent[];
  termLabel: string;
  /** Ordinal season badge ("S1") + full name when the day is assigned
   *  to a season. */
  season: { code: string; name: string } | null;
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
        `${day.day_of_week} · ${day.type}${workType ? ` · ${workType}` : ""}`,
        season ? season.name : "",
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
          ? "bg-sky-100/60 hover:bg-sky-100"
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
          {season ? (
            <span
              title={season.name}
              className="rounded-full bg-teal-100 px-1 py-px text-[9px] font-semibold text-teal-700"
            >
              {season.code}
            </span>
          ) : null}
          {workType === "Externship" ? (
            <span className="rounded-full bg-indigo-100 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-indigo-700">
              Extern
            </span>
          ) : workType === "Internship" ? (
            <span className="rounded-full bg-orange-100 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-orange-700">
              Intern
            </span>
          ) : null}
        </span>
      </span>
      {/* Events — larger single-line chips; long titles truncate
          instead of wrapping so every chip stays one row. */}
      {shown.length > 0 ? (
        <span className="flex min-h-0 flex-col gap-1 overflow-hidden">
          {shown.map((e) => {
            const c = eventColor(e.color);
            return (
              <span
                key={e.id}
                className={cn(
                  "block shrink-0 truncate whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium leading-4",
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
      {/* Day notices (term/rotation boundaries) — footer bubbles
          styled like the event chips, pinned to the cell bottom so
          they never push events around. */}
      {boundaries.length > 0 ? (
        <span className="mt-auto flex min-h-0 shrink-0 flex-col gap-1 overflow-hidden pt-0.5">
          {boundaries.slice(0, 2).map((b) => (
            <span
              key={b}
              className="block shrink-0 truncate whitespace-nowrap rounded-md bg-emerald-100 px-2 py-1 text-xs font-medium leading-4 text-emerald-800"
            >
              {b}
            </span>
          ))}
        </span>
      ) : null}
    </button>
  );
}

/* ── New-event dialog ─────────────────────────────────────────────── */

/**
 * Toolbar "New event" button wrapping the shared EventUpsertDialog in
 * create mode. Default date: today when it's inside the school year,
 * else the first day of the month being viewed.
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
  const [defaultDate, setDefaultDate] = useState("");

  function openDialog() {
    let d = "";
    if (dayByDate.has(todayIso)) d = todayIso;
    else if (monthKey) {
      d = days.find((x) => monthKeyOf(x.date) === monthKey)?.date ?? "";
    }
    setDefaultDate(d || (days[0]?.date ?? ""));
    setOpen(true);
  }

  return (
    <>
      <Button size="sm" onClick={openDialog} disabled={days.length === 0}>
        <Plus className="size-4 mr-1" />
        New event
      </Button>
      {open ? (
        <EventUpsertDialog
          days={days}
          existing={null}
          defaultDate={defaultDate}
          onDone={(saved) => {
            setOpen(false);
            if (saved) onCreated();
          }}
        />
      ) : null}
    </>
  );
}

/* ── Day editor sheet ─────────────────────────────────────────────── */

function DaySheet({
  day,
  days,
  events,
  termLabel,
  seasonName,
  onClose,
  onChanged,
  onRemind,
}: {
  day: XanoSchoolCalendarDay;
  /** The whole year's days — the event modal clamps its date picker
   *  to this range. */
  days: XanoSchoolCalendarDay[];
  events: XanoSchoolCalendarEvent[];
  termLabel: string;
  seasonName: string;
  onClose: () => void;
  onChanged: () => void;
  /** Opens the SMS reminder dialog for one of this day's events. */
  onRemind: (event: XanoSchoolCalendarEvent) => void;
}) {
  const [type, setType] = useState(day.type);
  // Trimmed — a cleared rotation stores the " " sentinel (Xano edits
  // drop empty strings), which the Select must read as "None".
  const [workType, setWorkType] = useState((day.work_type ?? "").trim());
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
    workType !== (day.work_type ?? "").trim() ||
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
  // Starts closed even on an empty day: the editor is a modal now, so
  // auto-opening it would bury the day settings behind a dialog the
  // moment you click a date.
  const [editingId, setEditingId] = useState<number | null>(null);
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
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error ?? `Delete failed (${res.status})`);
      }
      onChanged();
      if (data?.warning) toast.warning(data.warning);
      else toast.success("Event deleted.");
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
          className="flex w-full flex-col gap-0 overflow-y-auto overscroll-contain p-0 sm:max-w-lg"
        >
          <SheetHeader className="border-b px-4 py-3">
            <SheetTitle className="text-base">{dateLabel}</SheetTitle>
            <SheetDescription className="text-xs">
              {termLabel || "—"}
              {seasonName ? ` · ${seasonName}` : ""} · {day.day_of_week}
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
                <Button
                  variant="outline"
                  size="sm"
                  className="bg-white"
                  onClick={() => setEditingId(0)}
                >
                  <Plus className="size-3.5 mr-1" />
                  Add event
                </Button>
              </div>

              {events.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No events on this day yet.
                </p>
              ) : null}

              <ul className="space-y-3">
                {events.map((e) => {
                  const c = eventColor(e.color);
                  return (
                    <li
                      key={e.id}
                      className="animate-in fade-in-0 slide-in-from-top-1 rounded-lg border bg-white p-4 duration-200"
                    >
                      {/* Header: dot · title · type chip */}
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            "size-2.5 shrink-0 rounded-full",
                            c ? c.dot : "bg-slate-300"
                          )}
                          aria-hidden
                        />
                        <p className="min-w-0 flex-1 truncate text-sm font-semibold">
                          {e.title}
                        </p>
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

                      {/* Details */}
                      <div className="mt-2.5 space-y-1.5">
                        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                          <Clock className="size-3.5 shrink-0" />
                          {e.start_time
                            ? `${fmtTime(e.start_time)}${
                                e.end_time
                                  ? ` – ${fmtTime(e.end_time)}`
                                  : ""
                              }`
                            : "All day"}
                        </p>
                        {e.location ? (
                          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                            <MapPin className="size-3.5 shrink-0" />
                            <span className="truncate">{e.location}</span>
                          </p>
                        ) : null}
                        {e.description ? (
                          <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                            {e.description}
                          </p>
                        ) : null}
                        {e.mandatory || e.parent_volunteer_hours ? (
                          <p className="flex flex-wrap items-center gap-1.5 pt-0.5">
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
                          </p>
                        ) : null}
                      </div>

                      {/* Actions — pinned to the card's bottom edge */}
                      <div className="mt-3 flex items-center justify-between gap-2 border-t pt-3">
                        <Button
                          variant="outline"
                          size="sm"
                          className="bg-white"
                          onClick={() => onRemind(e)}
                        >
                          <Bell className="size-3.5 mr-1" />
                          Remind
                        </Button>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="bg-white"
                            onClick={() => setEditingId(e.id)}
                          >
                            <Pencil className="size-3.5 mr-1" />
                            Edit
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="bg-white text-red-600 hover:bg-red-50 hover:text-red-700"
                            onClick={() => setDeleteTarget(e)}
                          >
                            <Trash2 className="size-3.5 mr-1" />
                            Delete
                          </Button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>

            </section>
          </div>
        </SheetContent>
      </Sheet>

      {/* Add/Edit open the shared modal over the sheet — the same
          editor the Events sheet and the Volunteer Hours page use, so
          every surface offers the full field set (parent sign-up
          spots, needs, all-day) instead of the trimmed inline form
          that used to render inside the sheet. Sibling of the Sheet,
          not a child, matching EventsSheet. */}
      {editingId !== null ? (
        <EventUpsertDialog
          key={editingId}
          days={days}
          existing={
            editingEvent ? { event: editingEvent, date: day.date } : null
          }
          defaultDate={day.date}
          onDone={(saved) => {
            setEditingId(null);
            if (saved) onChanged();
          }}
        />
      ) : null}

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

          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-6 py-5">
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

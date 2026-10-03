"use client";

import { Fragment, useCallback, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import {
  CalendarDays,
  ChevronRight,
  Loader2,
  MapPin,
  Plus,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { adminFetcher } from "@/lib/admin-fetcher";
import {
  eventColor,
  isSignUpEvent,
  parseDate,
  SCHOOL_TIME_ZONE,
} from "@/lib/school-calendar";
import { cn } from "@/lib/utils";
import { EventUpsertDialog } from "@/components/admin/event-upsert-dialog";
import { EventReminderDialog } from "@/components/admin/event-reminder-dialog";
import {
  EventDetailSheet,
  eventTimeLabel,
} from "@/components/admin/event-detail-sheet";
import type {
  AdminEvent,
  AdminEventsResponse,
} from "@/app/api/admin/events/route";

type View = "all" | "upcoming" | "past";

/** The time-window choices, in button order — the default first. */
const VIEWS = [
  ["upcoming", "Upcoming"],
  ["past", "Past"],
  ["all", "All"],
] as const;

/** Today on the school's clock — an event is "past" once its day is
 *  over in St. Petersburg, not wherever the admin's laptop is. */
function schoolTodayIso(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: SCHOOL_TIME_ZONE });
}

/** "2026-10" → "October 2026". */
function monthHeading(iso: string): string {
  return parseDate(`${iso.slice(0, 7)}-01`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

/** "2026-10-17" → "Sat, Oct 17". */
function shortDate(iso: string): string {
  return parseDate(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** An event parents can sign up for, or one that has sign-ups from
 *  before admin closed it — either way there's an RSVP list to read. */
function hasSignups(e: AdminEvent): boolean {
  return isSignUpEvent(e.parent_spots) || e.signups.length > 0;
}

/**
 * Parents → Events. Every event on the selected year's calendar as one
 * table, grouped by month. A row opens the event's sheet: its details,
 * every family's RSVP with what they're bringing, and each need with
 * the families covering it.
 *
 * Events are authored on the calendar (Operations → Calendar) and here
 * through the same shared dialog, so both write identically.
 */
export default function AdminEventsPage() {
  const searchParams = useSearchParams();
  const yearId = Number(searchParams.get("yearId")) || 0;

  const { data, error, isLoading, mutate } = useSWR<AdminEventsResponse>(
    yearId ? `/api/admin/events?yearId=${yearId}` : null,
    adminFetcher
  );
  // The refresh that follows an edit: not the first load (that shows a
  // spinner), and not SWR's background refreshes on returning to the
  // page or refocusing the window, which greyed the table for the few
  // seconds the fetch takes on every visit.
  const [refreshing, setRefreshing] = useState(false);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await mutate();
    } finally {
      setRefreshing(false);
    }
  }, [mutate]);
  const events = useMemo(() => data?.events ?? [], [data]);
  const days = useMemo(() => data?.days ?? [], [data]);
  const todayIso = schoolTodayIso();

  // Upcoming by default — what staff are usually preparing for.
  const [view, setView] = useState<View>("upcoming");
  const [signupsOnly, setSignupsOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);
  const [editTarget, setEditTarget] = useState<AdminEvent | "new" | null>(
    null
  );
  const [remindTarget, setRemindTarget] = useState<AdminEvent | null>(null);

  // Search and the sign-ups toggle narrow first, so the view buttons
  // count what they'd actually show.
  const narrowed = useMemo(() => {
    const q = query.trim().toLowerCase();
    return events.filter((e) => {
      if (signupsOnly && !hasSignups(e)) return false;
      if (!q) return true;
      return [
        e.title,
        e.location ?? "",
        // Families and parents too — "which events are the Smiths
        // doing?" is a question this page should answer.
        ...e.signups.flatMap((s) => [s.family_name, ...s.parents]),
      ]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [events, query, signupsOnly]);

  const counts = useMemo(
    () => ({
      all: narrowed.length,
      upcoming: narrowed.filter((e) => e.date >= todayIso).length,
      past: narrowed.filter((e) => e.date < todayIso).length,
    }),
    [narrowed, todayIso]
  );

  const visible = useMemo(
    () =>
      narrowed.filter((e) =>
        view === "upcoming"
          ? e.date >= todayIso
          : view === "past"
            ? e.date < todayIso
            : true
      ),
    [narrowed, view, todayIso]
  );

  const months = useMemo(() => {
    const out: Array<{ key: string; events: AdminEvent[] }> = [];
    for (const e of visible) {
      const key = e.date.slice(0, 7);
      const last = out[out.length - 1];
      if (last && last.key === key) last.events.push(e);
      else out.push({ key, events: [e] });
    }
    // Past events read newest first — the one that just happened is
    // the one being reviewed.
    return view === "past" ? out.reverse().map((m) => ({
      ...m,
      events: [...m.events].reverse(),
    })) : out;
  }, [visible, view]);

  // The sheet reads the live row, so an edit re-renders it fresh.
  const openEvent =
    openId !== null ? (events.find((e) => e.id === openId) ?? null) : null;

  const firstDay = days[0]?.date;
  const lastDay = days[days.length - 1]?.date;
  const newEventDate =
    firstDay && lastDay && todayIso >= firstDay && todayIso <= lastDay
      ? todayIso
      : undefined;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Events</h1>
          <p className="text-sm text-muted-foreground">
            Every event on this year&rsquo;s calendar. Open one to review
            or edit its RSVPs and see who&rsquo;s bringing what.
          </p>
        </div>
        <Button
          size="sm"
          className="shrink-0"
          disabled={days.length === 0}
          onClick={() => setEditTarget("new")}
        >
          <Plus className="size-4" />
          New event
        </Button>
      </div>

      {error ? (
        <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
          Failed to load events:{" "}
          {error instanceof Error ? error.message : "unknown error"}
        </div>
      ) : null}

      {!yearId ? (
        <div className="rounded-lg border bg-white px-6 py-12 text-center text-sm text-muted-foreground">
          Pick a school year above to view its events.
        </div>
      ) : isLoading && !data ? (
        <div className="flex justify-center rounded-lg border bg-white px-6 py-16">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : data && events.length === 0 ? (
        <Card className="bg-white">
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <CalendarDays className="size-6 text-muted-foreground" />
            <p className="text-sm font-medium">No events yet</p>
            <p className="text-sm text-muted-foreground">
              Nothing is on this year&rsquo;s calendar.
            </p>
            <Button
              className="mt-2"
              disabled={days.length === 0}
              onClick={() => setEditTarget("new")}
            >
              <Plus className="size-3.5" />
              New event
            </Button>
          </CardContent>
        </Card>
      ) : data ? (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-56 flex-1">
              <Search
                className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search events, locations, families…"
                type="search"
                autoComplete="off"
                className="w-full bg-white pl-8"
              />
            </div>
            {/* Two different kinds of control, kept visibly apart: a
                segmented pick of ONE time window, then a divider, then
                an on/off filter that applies on top of it. As a row of
                identical buttons they read as four choices of the same
                thing. */}
            <div className="flex flex-wrap items-center gap-3">
              <div
                role="group"
                aria-label="Which events"
                className="inline-flex h-9 items-center rounded-lg bg-muted p-[3px]"
              >
                {VIEWS.map(([value, label]) => {
                  const on = view === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setView(value)}
                      className={cn(
                        "inline-flex h-full items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors",
                        on
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {label}
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {counts[value]}
                      </span>
                    </button>
                  );
                })}
              </div>
              <span className="h-6 w-px bg-border" aria-hidden />
              <div className="flex items-center gap-2">
                <Switch
                  id="events-signups-only"
                  checked={signupsOnly}
                  onCheckedChange={setSignupsOnly}
                />
                <Label
                  htmlFor="events-signups-only"
                  className="cursor-pointer text-sm font-normal"
                >
                  Sign-up events only
                </Label>
              </div>
            </div>
          </div>

          <Card className="gap-0 overflow-hidden bg-white py-0">
            <CardContent
              aria-busy={refreshing}
              className={cn(
                "p-0 transition-opacity",
                refreshing && "opacity-50 animate-pulse"
              )}
            >
              <Table className="min-w-[640px] table-fixed text-sm">
                <TableHeader className="bg-muted/40">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-[112px] pl-4 text-xs font-semibold text-muted-foreground">
                      Date
                    </TableHead>
                    <TableHead className="text-xs font-semibold text-muted-foreground">
                      Event
                    </TableHead>
                    <TableHead className="w-[168px] text-xs font-semibold text-muted-foreground">
                      Time
                    </TableHead>
                    <TableHead className="w-[120px] text-xs font-semibold text-muted-foreground">
                      RSVPs
                    </TableHead>
                    <TableHead className="w-10 pr-4">
                      <span className="sr-only">Open</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {months.length === 0 ? (
                    <TableRow className="hover:bg-transparent">
                      <TableCell
                        colSpan={5}
                        className="py-10 text-center text-sm text-muted-foreground"
                      >
                        {query.trim()
                          ? `No events match “${query.trim()}”.`
                          : view === "upcoming"
                            ? "Nothing coming up."
                            : view === "past"
                              ? "No past events yet."
                              : "No events match these filters."}
                      </TableCell>
                    </TableRow>
                  ) : (
                    months.map((m) => (
                      <Fragment key={m.key}>
                        <TableRow className="border-y bg-muted/30 hover:bg-muted/30">
                          <TableCell
                            colSpan={5}
                            className="py-1.5 pl-4 text-xs font-semibold"
                          >
                            {monthHeading(m.key)}
                            <span className="ml-1.5 font-normal tabular-nums text-muted-foreground">
                              {m.events.length}
                            </span>
                          </TableCell>
                        </TableRow>
                        {m.events.map((e) => (
                          <EventRow
                            key={e.id}
                            event={e}
                            todayIso={todayIso}
                            onOpen={() => setOpenId(e.id)}
                          />
                        ))}
                      </Fragment>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      ) : null}

      <EventDetailSheet
        event={openEvent}
        yearId={yearId}
        isPast={openEvent ? openEvent.date < todayIso : false}
        refreshing={refreshing}
        onOpenChange={(open) => {
          if (!open) setOpenId(null);
        }}
        onEdit={(e) => setEditTarget(e)}
        onRemind={(e) => setRemindTarget(e)}
        onChanged={() => refresh()}
      />

      {/* Create / edit — the calendar's shared dialog. It waits on the
          refetch before closing, so its spinner runs until the change
          is actually on screen. */}
      {editTarget ? (
        <EventUpsertDialog
          key={editTarget === "new" ? "new" : editTarget.id}
          days={days}
          existing={
            editTarget === "new"
              ? null
              : { event: editTarget, date: editTarget.date }
          }
          defaultDate={newEventDate}
          onDone={async (saved) => {
            if (saved) await refresh().catch(() => undefined);
            setEditTarget(null);
          }}
        />
      ) : null}

      {remindTarget ? (
        <EventReminderDialog
          key={remindTarget.id}
          yearId={yearId}
          event={remindTarget}
          onDone={() => setRemindTarget(null)}
        />
      ) : null}
    </div>
  );
}

function EventRow({
  event: e,
  todayIso,
  onOpen,
}: {
  event: AdminEvent;
  todayIso: string;
  onOpen: () => void;
}) {
  const color = eventColor(e.color);
  const isPast = e.date < todayIso;
  const isToday = e.date === todayIso;
  const location = (e.location ?? "").trim();

  return (
    <TableRow
      tabIndex={0}
      className="cursor-pointer hover:bg-muted/30 focus-visible:bg-muted/40 focus-visible:outline-none"
      onClick={onOpen}
      onKeyDown={(ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          onOpen();
        }
      }}
    >
      <TableCell
        className={cn(
          "pl-4 tabular-nums",
          isPast ? "text-muted-foreground" : "font-medium"
        )}
      >
        {shortDate(e.date)}
        {isToday ? (
          <span className="ml-1.5 rounded-full bg-foreground px-1.5 py-px text-[10px] font-medium text-background">
            Today
          </span>
        ) : null}
      </TableCell>
      <TableCell>
        <span className="flex min-w-0 items-center gap-1.5">
          <span
            className={cn(
              "size-2 shrink-0 rounded-full",
              color ? color.dot : "bg-slate-300"
            )}
            aria-hidden
          />
          <span className="truncate font-medium">{e.title}</span>
          {e.mandatory ? (
            <span className="shrink-0 rounded-full border border-red-200 bg-red-50 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-red-700">
              Mandatory
            </span>
          ) : null}
          {e.parent_volunteer_hours ? (
            <span className="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-emerald-700">
              {e.volunteer_hour_total || 0} vol hrs
            </span>
          ) : null}
        </span>
        {location ? (
          <span className="mt-0.5 flex items-center gap-1 truncate pl-3.5 text-xs text-muted-foreground">
            <MapPin className="size-3 shrink-0" aria-hidden />
            <span className="truncate">{location}</span>
          </span>
        ) : null}
      </TableCell>
      <TableCell className="tabular-nums text-muted-foreground">
        {eventTimeLabel(e)}
      </TableCell>
      <TableCell>
        <RsvpCell event={e} />
      </TableCell>
      <TableCell className="pr-4">
        <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
      </TableCell>
    </TableRow>
  );
}

/** How many families signed up — just the count; spots and limits
 *  live in the event's sheet. */
function RsvpCell({ event: e }: { event: AdminEvent }) {
  const families = e.signups.length;
  if (!isSignUpEvent(e.parent_spots) && families === 0) {
    return <span className="text-xs text-muted-foreground">Sign-ups off</span>;
  }
  return (
    <span
      className={cn(
        "tabular-nums",
        families > 0 ? "font-medium" : "text-muted-foreground"
      )}
    >
      {families} {families === 1 ? "family" : "families"}
    </span>
  );
}

"use client";

import { Fragment, useCallback, useMemo, useState } from "react";
import useSWR from "swr";
import {
  CalendarDays,
  Check,
  ChevronRight,
  Loader2,
  Plus,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { adminFetcher } from "@/lib/admin-fetcher";
import { parseDate, SCHOOL_TIME_ZONE } from "@/lib/school-calendar";
import {
  eventTypeOption,
  formatHours,
  type RecruitmentEvent,
} from "@/lib/recruitment-events";
import { cn } from "@/lib/utils";
import { RecruitmentEventUpsertDialog } from "@/components/admin/recruitment-event-upsert-dialog";
import {
  RecruitmentEventDetailSheet,
  recruitmentTimeLabel,
} from "@/components/admin/recruitment-event-detail-sheet";
import type { AdminRecruitmentEventsResponse } from "@/app/api/admin/recruitment-events/route";

type View = "upcoming" | "past" | "all";

/** The time-window choices, in button order — the default first. */
const VIEWS = [
  ["upcoming", "Upcoming"],
  ["past", "Past"],
  ["all", "All"],
] as const;

const ALL_STAFF = "__all__";

/** Today on the school's clock — an event is "past" once its day is
 *  over in St. Petersburg, not wherever the admin's laptop is. */
function schoolTodayIso(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: SCHOOL_TIME_ZONE });
}

/** "2026-03" → "March 2026". */
function monthHeading(ym: string): string {
  return parseDate(`${ym}-01`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

/** "2026-03-28" → "Sat, Mar 28". */
function shortDate(iso: string): string {
  return parseDate(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

const sumHours = (list: RecruitmentEvent[]) =>
  Math.round(list.reduce((s, e) => s + (e.hours || 0), 0) * 100) / 100;

/**
 * Recruitment → Events. Every outreach event staff attend — festivals,
 * tabling, church visits, school fairs — as one table grouped by
 * month, with the hours logged. Upcoming by default; a staff filter
 * answers "what has Tessa done this spring". A row opens the event's
 * sheet (details, links, files); New event / Edit share one dialog.
 *
 * Not scoped to the top bar's school year: recruiting for next fall
 * happens during this school year, so events are a date-ordered
 * stream and the view buttons pick the window.
 */
export default function AdminRecruitmentEventsPage() {
  const { data, error, isLoading, mutate } = useSWR<AdminRecruitmentEventsResponse>(
    "/api/admin/recruitment-events",
    adminFetcher
  );
  // The refresh that follows a save: not the first load (spinner),
  // and not SWR's background refreshes on refocus.
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
  const staffOptions = useMemo(() => data?.staff ?? [], [data]);
  const todayIso = schoolTodayIso();

  const [view, setView] = useState<View>("upcoming");
  const [staffFilter, setStaffFilter] = useState<string>(ALL_STAFF);
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);
  const [editTarget, setEditTarget] = useState<RecruitmentEvent | "new" | null>(
    null
  );

  // Only names that appear on an event — the filter is for reading
  // what happened, not the whole staff directory.
  const staffOnEvents = useMemo(() => {
    const names = new Map<string, string>();
    for (const e of events) {
      for (const n of e.staff) {
        const k = n.toLowerCase();
        if (!names.has(k)) names.set(k, n);
      }
    }
    return [...names.values()].sort((a, b) => a.localeCompare(b));
  }, [events]);

  // Search and the staff filter narrow first, so the view buttons
  // count what they'd actually show.
  const narrowed = useMemo(() => {
    const q = query.trim().toLowerCase();
    const who = staffFilter === ALL_STAFF ? "" : staffFilter.toLowerCase();
    return events.filter((e) => {
      if (who && !e.staff.some((n) => n.toLowerCase() === who)) return false;
      if (!q) return true;
      return [e.name, e.location, e.description, ...e.staff]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [events, query, staffFilter]);

  const counts = useMemo(
    () => ({
      all: narrowed.length,
      upcoming: narrowed.filter((e) => e.event_date >= todayIso).length,
      past: narrowed.filter((e) => e.event_date < todayIso).length,
    }),
    [narrowed, todayIso]
  );

  const visible = useMemo(
    () =>
      narrowed.filter((e) =>
        view === "upcoming"
          ? e.event_date >= todayIso
          : view === "past"
            ? e.event_date < todayIso
            : true
      ),
    [narrowed, view, todayIso]
  );

  const months = useMemo(() => {
    const out: Array<{ key: string; events: RecruitmentEvent[] }> = [];
    for (const e of visible) {
      const key = e.event_date.slice(0, 7);
      const last = out[out.length - 1];
      if (last && last.key === key) last.events.push(e);
      else out.push({ key, events: [e] });
    }
    // Past reads newest first — the one that just happened is the one
    // being logged.
    return view === "past"
      ? out.reverse().map((m) => ({ ...m, events: [...m.events].reverse() }))
      : out;
  }, [visible, view]);

  const totalHours = sumHours(visible);

  // The sheet reads the live row, so an edit re-renders it fresh.
  const openEvent =
    openId !== null ? (events.find((e) => e.id === openId) ?? null) : null;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Recruitment Events</h1>
          <p className="text-sm text-muted-foreground">
            Festivals, tabling, church visits and school fairs staff attend
            to meet families. Open an event for its links and files.
          </p>
        </div>
        <Button
          size="sm"
          className="shrink-0"
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

      {isLoading && !data ? (
        <div className="flex justify-center rounded-lg border bg-white px-6 py-16">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : data && events.length === 0 ? (
        <Card className="bg-white">
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <CalendarDays className="size-6 text-muted-foreground" />
            <p className="text-sm font-medium">No recruitment events yet</p>
            <p className="text-sm text-muted-foreground">
              Add the first festival, tabling shift or visit.
            </p>
            <Button className="mt-2" onClick={() => setEditTarget("new")}>
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
                placeholder="Search events, locations, staff…"
                type="search"
                autoComplete="off"
                className="w-full bg-white pl-8"
              />
            </div>
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
              <Select value={staffFilter} onValueChange={setStaffFilter}>
                <SelectTrigger
                  className="h-9 w-44 bg-white"
                  aria-label="Filter by staff"
                >
                  <SelectValue placeholder="All staff" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_STAFF}>All staff</SelectItem>
                  {staffOnEvents.map((n) => (
                    <SelectItem key={n} value={n}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
              <Table className="min-w-[760px] table-fixed text-sm">
                <TableHeader className="bg-muted/40">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-[108px] pl-4 text-xs font-semibold text-muted-foreground">
                      Date
                    </TableHead>
                    <TableHead className="w-[150px] text-xs font-semibold text-muted-foreground">
                      Time
                    </TableHead>
                    <TableHead className="text-xs font-semibold text-muted-foreground">
                      Event
                    </TableHead>
                    <TableHead className="w-[170px] text-xs font-semibold text-muted-foreground">
                      Staff
                    </TableHead>
                    <TableHead className="w-[64px] text-right text-xs font-semibold text-muted-foreground">
                      Hours
                    </TableHead>
                    <TableHead className="w-[92px] text-xs font-semibold text-muted-foreground">
                      Type
                    </TableHead>
                    <TableHead className="w-[56px] text-xs font-semibold text-muted-foreground">
                      Paid
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
                        colSpan={8}
                        className="py-10 text-center text-sm text-muted-foreground"
                      >
                        {query.trim()
                          ? `No events match “${query.trim()}”.`
                          : staffFilter !== ALL_STAFF
                            ? `No ${view === "all" ? "" : `${view} `}events for ${staffFilter}.`
                            : view === "upcoming"
                              ? "Nothing coming up."
                              : view === "past"
                                ? "No past events yet."
                                : "No events match these filters."}
                      </TableCell>
                    </TableRow>
                  ) : (
                    <>
                      {months.map((m) => (
                        <Fragment key={m.key}>
                          <TableRow className="border-y bg-muted/30 hover:bg-muted/30">
                            <TableCell
                              colSpan={8}
                              className="py-1.5 pl-4 text-xs font-semibold"
                            >
                              {monthHeading(m.key)}
                              <span className="ml-1.5 font-normal tabular-nums text-muted-foreground">
                                {m.events.length}
                                {sumHours(m.events) > 0
                                  ? ` · ${formatHours(sumHours(m.events))} hrs`
                                  : ""}
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
                      ))}
                      <TableRow className="border-t bg-muted/20 hover:bg-muted/20">
                        <TableCell
                          colSpan={4}
                          className="py-2 pl-4 text-xs font-semibold text-muted-foreground"
                        >
                          Total · {visible.length}{" "}
                          {visible.length === 1 ? "event" : "events"}
                        </TableCell>
                        <TableCell className="py-2 text-right text-xs font-semibold tabular-nums">
                          {formatHours(totalHours)}
                        </TableCell>
                        <TableCell colSpan={3} className="py-2 pr-4" />
                      </TableRow>
                    </>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      ) : null}

      <RecruitmentEventDetailSheet
        event={openEvent}
        isPast={openEvent ? openEvent.event_date < todayIso : false}
        refreshing={refreshing}
        onOpenChange={(open) => {
          if (!open) setOpenId(null);
        }}
        onEdit={(e) => setEditTarget(e)}
        onChanged={() => refresh()}
        onDeleted={async () => {
          setOpenId(null);
          await refresh();
        }}
      />

      {editTarget ? (
        <RecruitmentEventUpsertDialog
          key={editTarget === "new" ? "new" : editTarget.id}
          existing={editTarget === "new" ? null : editTarget}
          staffOptions={staffOptions}
          defaultDate={todayIso}
          onDone={async (saved) => {
            if (saved) await refresh().catch(() => undefined);
            setEditTarget(null);
          }}
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
  event: RecruitmentEvent;
  todayIso: string;
  onOpen: () => void;
}) {
  const isPast = e.event_date < todayIso;
  const isToday = e.event_date === todayIso;
  const type = eventTypeOption(e.event_type);
  const time = recruitmentTimeLabel(e);
  const staff = e.staff.join(", ");

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
        {shortDate(e.event_date)}
        {isToday ? (
          <span className="ml-1.5 rounded-full bg-foreground px-1.5 py-px text-[10px] font-medium text-background">
            Today
          </span>
        ) : null}
      </TableCell>
      <TableCell className="tabular-nums text-muted-foreground">
        {time || "—"}
      </TableCell>
      <TableCell>
        <span className="block truncate font-medium" title={e.name}>
          {e.name}
        </span>
      </TableCell>
      <TableCell>
        <span
          className={cn("block truncate", !staff && "text-muted-foreground")}
          title={staff}
        >
          {staff || "—"}
        </span>
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {e.hours > 0 ? (
          formatHours(e.hours)
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell>
        {type ? (
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[11px] font-medium",
              type.chip
            )}
          >
            {type.label}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">Set type</span>
        )}
      </TableCell>
      <TableCell>
        {e.paid ? (
          <Check className="size-4 text-emerald-600" aria-label="Paid" />
        ) : (
          <span className="sr-only">Not paid</span>
        )}
      </TableCell>
      <TableCell className="pr-4">
        <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
      </TableCell>
    </TableRow>
  );
}

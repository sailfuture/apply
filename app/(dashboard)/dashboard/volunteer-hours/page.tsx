"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import {
  CalendarDays,
  CheckCircle2,
  Clock,
  Loader2,
  MapPin,
  Minus,
  Plus,
  Users,
} from "lucide-react";
import { DashboardPageHeader } from "@/components/dashboard-page-header";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useApplications, useSchoolYears, apiFetcher } from "@/hooks/use-api";
import { cn } from "@/lib/utils";
import {
  eventColor,
  itemHeadroom,
  parseDate,
  type EventItemAvailability,
} from "@/lib/school-calendar";
import type {
  ParentVolunteerEvent,
  VolunteerEventsResponse,
} from "@/app/api/volunteer-events/route";

/** Annual goal — kept in lockstep with the constant on the dashboard
 *  summary card so the two surfaces show the same target. */
const VOLUNTEER_HOURS_GOAL = 40;

interface VolunteerHoursEntry {
  id: number;
  registration_families_id: number;
  registration_school_years_id: number;
  entry_date: string;
  hours: number;
  activity_description: string;
  activity_category: string;
  is_approved: boolean;
  approved_time: number | null;
  is_approved_admin: string;
}

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
  return res.json();
};

/** Trim trailing zeros so whole hours read as "12" not "12.00". */
function formatHours(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2).replace(/\.?0+$/, "");
}

/** Volunteer-hour entries are stored as ISO date strings (YYYY-MM-DD)
 *  with no timezone. Construct the date in local time so a 2026-04-29
 *  entry doesn't slide back a day in the user's locale. */
function formatEntryDate(iso: string): string {
  if (!iso) return "—";
  const [yearStr, monthStr, dayStr] = iso.split("-");
  const y = Number(yearStr);
  const m = Number(monthStr);
  const d = Number(dayStr);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Volunteer Hours detail page.
 *
 * Pulls admin-logged entries from `/api/volunteer-hours`, filters to the
 * dashboard's current academic year, and renders a running total + a
 * chronological history table. Read-only: parents can't add entries here
 * — admin records hours on the staff side as families volunteer at
 * Academy events.
 *
 * Two totals are surfaced separately because approval gates the canonical
 * count: only `is_approved=true` rows count toward the 40-hour goal, but
 * pending entries are still shown so families know admin has logged them.
 */
export default function VolunteerHoursPage() {
  const searchParams = useSearchParams();
  const yearIdParam = searchParams.get("yearId");

  // Defensive fallback if the parent lands here without `?yearId` (the
  // dashboard normally propagates it via URL, but stale links can drop
  // it). Picks the most recent year the family has an application for.
  const { data: applications } = useApplications();
  const yearId = useMemo<number | null>(() => {
    if (yearIdParam) {
      const n = Number(yearIdParam);
      return Number.isFinite(n) ? n : null;
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
  }, [yearIdParam, applications]);

  const dashboardHref = yearId
    ? `/dashboard?yearId=${yearId}`
    : "/dashboard";

  // Look up the year name so we can show it in the breadcrumb + title.
  const { data: yearsData } = useSchoolYears();
  const yearName = useMemo(() => {
    if (!yearId || !yearsData) return null;
    const found = (yearsData as { id: number; year_name: string }[]).find(
      (y) => y.id === yearId
    );
    return found?.year_name ?? null;
  }, [yearId, yearsData]);

  // Volunteer-hours entries (all years; filter below).
  const { data: entriesData, isLoading: entriesLoading } = useSWR<
    VolunteerHoursEntry[]
  >("/api/volunteer-hours", fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 10000,
  });

  // Filter to the year being viewed, then split by approval status so we
  // can show the canonical total (approved only) alongside any
  // pending-review entries.
  const { yearEntries, approvedHours, pendingHours } = useMemo(() => {
    const entries = (entriesData ?? []).filter(
      (e) => e.registration_school_years_id === yearId
    );
    let approved = 0;
    let pending = 0;
    for (const e of entries) {
      const hours = Number(e.hours) || 0;
      if (e.is_approved) approved += hours;
      else pending += hours;
    }
    // Most recent activity first.
    entries.sort((a, b) => (a.entry_date < b.entry_date ? 1 : -1));
    return {
      yearEntries: entries,
      approvedHours: approved,
      pendingHours: pending,
    };
  }, [entriesData, yearId]);

  const progressPct = Math.min(
    100,
    (approvedHours / VOLUNTEER_HOURS_GOAL) * 100
  );
  const remaining = Math.max(0, VOLUNTEER_HOURS_GOAL - approvedHours);

  const loading = entriesLoading || !yearsData;

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 sm:p-6 mx-auto w-full max-w-4xl">
      <DashboardPageHeader
        backHref={dashboardHref}
        backLabel="Back to Dashboard"
        breadcrumb={[
          { label: "Dashboard", href: dashboardHref },
          ...(yearName ? [{ label: yearName, href: dashboardHref }] : []),
          { label: "Volunteer Hours" },
        ]}
        title={
          yearName
            ? `${yearName} academic year — volunteer hours`
            : "Volunteer hours"
        }
        subtitle="40 hours per family per academic year, or 8 per term over 5 academic terms. Hours are logged by the admissions team as you volunteer at Academy events."
      />

      {/* Running total + progress bar — gives parents the at-a-glance
          answer to "how far am I from the 40-hour goal." Only approved
          entries count, so the bar reflects what admin has ratified.
          Pending hours are surfaced separately when present. */}
      {loading ? (
        <Skeleton className="h-32 w-full rounded-xl" />
      ) : (
        <div className="rounded-xl border bg-white p-6">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-sm font-medium text-muted-foreground">
              Approved hours this year
            </p>
            <p className="text-xs text-muted-foreground">
              Goal: {VOLUNTEER_HOURS_GOAL} hours
            </p>
          </div>
          <p className="mt-1 text-3xl font-semibold">
            {formatHours(approvedHours)}
            <span className="text-base font-normal text-muted-foreground">
              {" / "}
              {VOLUNTEER_HOURS_GOAL}
            </span>
          </p>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {remaining > 0 ? (
              <span>{formatHours(remaining)} hours to goal</span>
            ) : (
              <span className="text-emerald-700 font-medium">
                Goal met for the year.
              </span>
            )}
            {pendingHours > 0 ? (
              <span>
                {formatHours(pendingHours)} hours pending admin review
              </span>
            ) : null}
          </div>
        </div>
      )}

      {/* Upcoming sign-up events — events admin opened parent spots
          on. Families RSVP (spots + a note about who's coming) right
          here; volunteering at these events is how hours get logged. */}
      <UpcomingEventsSection yearId={yearId} />

      {/* Entry history — every admin-logged row for the year, newest
          first. Pending entries get a status pill so parents can tell at
          a glance which ones still need ratification. */}
      <div>
        <h2 className="text-sm font-semibold mb-3">Entry history</h2>
        <div className="rounded-xl bg-background p-1.5 shadow-sm border">
          <div className="overflow-hidden rounded-lg border bg-white">
            {loading ? (
              <Skeleton className="h-32 w-full" />
            ) : yearEntries.length === 0 ? (
              <p className="px-4 py-8 text-sm text-muted-foreground text-center">
                No volunteer hours logged for this academic year yet.
              </p>
            ) : (
              <Table className="text-sm">
                <TableHeader>
                  <TableRow>
                    <TableHead className="px-4 py-2">Date</TableHead>
                    <TableHead className="px-4 py-2">Activity</TableHead>
                    <TableHead className="px-4 py-2 text-right whitespace-nowrap">
                      Hours
                    </TableHead>
                    <TableHead className="hidden px-4 py-2 text-right whitespace-nowrap sm:table-cell">
                      Status
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {yearEntries.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="px-4 py-3 whitespace-nowrap">
                        {formatEntryDate(entry.entry_date)}
                      </TableCell>
                      <TableCell className="px-4 py-3 whitespace-normal">
                        <p className="font-medium">
                          {entry.activity_description || "—"}
                        </p>
                        {entry.activity_category ? (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {entry.activity_category}
                          </p>
                        ) : null}
                        {/* Mobile stand-in for the hidden Status column. */}
                        <p className="mt-1 sm:hidden">
                          {entry.is_approved ? (
                            <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-700">
                              Approved
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                              Pending
                            </span>
                          )}
                        </p>
                      </TableCell>
                      <TableCell className="px-4 py-3 text-right font-medium whitespace-nowrap">
                        {formatHours(Number(entry.hours) || 0)}
                      </TableCell>
                      <TableCell className="hidden px-4 py-3 text-right whitespace-nowrap sm:table-cell">
                        {entry.is_approved ? (
                          <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
                            Approved
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                            Pending
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </div>
      </div>

      <p className="text-xs text-muted-foreground text-center pt-4 border-t">
        Hours are logged by the admissions team. If something looks off,{" "}
        <a
          href="mailto:dean@sailfuture.org?subject=Volunteer%20hours%20question"
          className="text-primary underline underline-offset-2"
        >
          contact the office
        </a>
        .
      </p>
    </div>
  );
}

/* ─────────────────── Upcoming events + RSVP ─────────────────── */

function fmtEventTime(ms: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Upcoming events with parent sign-up spots. Each row shows the live
 * spot count and the family's own reservation; Sign up / Edit opens
 * the RSVP dialog (spots + who's-coming comment). Hidden entirely
 * when no upcoming events offer sign-ups.
 */
function UpcomingEventsSection({ yearId }: { yearId: number | null }) {
  const { data, mutate } = useSWR<VolunteerEventsResponse>(
    yearId ? `/api/volunteer-events?yearId=${yearId}` : null,
    apiFetcher,
    { revalidateOnFocus: true, dedupingInterval: 10000 }
  );
  const [rsvpTarget, setRsvpTarget] = useState<ParentVolunteerEvent | null>(
    null
  );
  // `?eventId=` — the RSVP deep link carried in every calendar event's
  // description (see `parentRsvpUrl`). A parent arriving from their
  // calendar app gets that event's sign-up dialog straight away
  // instead of having to find the row again.
  const searchParams = useSearchParams();
  const deepLinkId = Number(searchParams.get("eventId")) || 0;
  const [deepLinkDismissed, setDeepLinkDismissed] = useState(false);

  const events = data?.events ?? [];

  // Derived rather than pushed into state from an effect: the events
  // arrive async, so an effect would mean a setState-on-load, and
  // reopening the dialog every time the list revalidates. `dismissed`
  // latches once the parent closes it.
  const deepLinkTarget =
    deepLinkId && !deepLinkDismissed
      ? (events.find((e) => e.id === deepLinkId) ?? null)
      : null;
  const activeRsvp = rsvpTarget ?? deepLinkTarget;

  const past = data?.past ?? [];

  // Render if EITHER half has something — a family late in the year
  // may have no upcoming events left but still wants their record.
  if (!data || (events.length === 0 && past.length === 0)) return null;

  return (
    <div className="space-y-6">
      {events.length > 0 ? (
        <div>
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-sm font-semibold">Upcoming events</h2>
        <p className="text-xs text-muted-foreground">
          Reserve your spot — volunteering here earns your hours.
        </p>
      </div>
      <div className="rounded-xl bg-background p-1.5 shadow-sm border">
        <div className="overflow-hidden rounded-lg border bg-white divide-y">
          {events.map((ev) => {
            const c = eventColor(ev.color);
            const needs = ev.items ?? [];
            // Uncapped events are never "Full" — `left` only governs
            // capped ones.
            const left = ev.unlimited
              ? Number.POSITIVE_INFINITY
              : Math.max(ev.spots_total - ev.spots_taken, 0);
            const dateObj = parseDate(ev.date);
            return (
              <div
                key={ev.id}
                className="px-4 py-4 sm:flex sm:items-center sm:gap-4"
              >
                <div className="flex min-w-0 gap-4 sm:flex-1">
                {/* Date block */}
                <div className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-lg border bg-muted/30">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {dateObj.toLocaleDateString("en-US", { month: "short" })}
                  </span>
                  <span className="text-lg font-semibold leading-tight tabular-nums">
                    {dateObj.getDate()}
                  </span>
                </div>

                {/* Details */}
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
                    <span
                      className={cn(
                        "size-2 shrink-0 rounded-full",
                        c ? c.dot : "bg-slate-300"
                      )}
                      aria-hidden
                    />
                    {ev.title}
                    {ev.parent_volunteer_hours ? (
                      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-emerald-700">
                        {ev.volunteer_hour_total || 0} vol hrs
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Clock className="size-3" />
                      {ev.start_time
                        ? `${fmtEventTime(ev.start_time)}${
                            ev.end_time
                              ? ` – ${fmtEventTime(ev.end_time)}`
                              : ""
                          }`
                        : "All day"}
                    </span>
                    {ev.location ? (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="size-3" />
                        {ev.location}
                      </span>
                    ) : null}
                    <span className="inline-flex items-center gap-1">
                      <Users className="size-3" />
                      {ev.unlimited
                        ? ev.spots_taken > 0
                          ? `${ev.spots_taken} signed up`
                          : "Open to all families"
                        : left > 0
                          ? `${left} of ${ev.spots_total} spots open`
                          : "Full"}
                    </span>
                  </p>
                  {ev.description ? (
                    <p className="mt-1.5 text-xs text-muted-foreground whitespace-pre-wrap">
                      {ev.description}
                    </p>
                  ) : null}
                  {needs.length > 0 ? (
                    <div className="mt-2">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Event needs
                      </p>
                      {/* Live counts as wrapping chips rather than a
                          bullet list — one row across on desktop
                          instead of a tall left-hugging column, and a
                          parent can still see what's uncovered before
                          opening the dialog. Covered items go green. */}
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {needs.map((n) => {
                          const covered = n.claimed >= n.quantity;
                          return (
                            <span
                              key={n.id}
                              className={cn(
                                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                                covered
                                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                  : "border-border bg-muted/40 text-foreground"
                              )}
                            >
                              {covered ? (
                                <CheckCircle2 className="size-3 shrink-0" />
                              ) : null}
                              {n.label}
                              <span
                                className={
                                  covered
                                    ? "font-normal"
                                    : "font-normal text-muted-foreground"
                                }
                              >
                                {covered
                                  ? "covered"
                                  : `${n.claimed} of ${n.quantity}`}
                              </span>
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                  {ev.my_rsvp ? (
                    <p className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-200">
                      <CheckCircle2 className="size-3" />
                      You reserved {ev.my_rsvp.spots} spot
                      {ev.my_rsvp.spots === 1 ? "" : "s"}
                    </p>
                  ) : null}
                </div>
                </div>

                {/* Action — full-width button below the details on
                    phones (so the title never fights the button for
                    width); right-aligned beside them from sm up. */}
                <div className="mt-3 sm:mt-0 sm:shrink-0 sm:self-center">
                  {ev.my_rsvp ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full bg-white sm:w-auto"
                      onClick={() => setRsvpTarget(ev)}
                    >
                      Edit RSVP
                    </Button>
                  ) : left > 0 ? (
                    <Button
                      size="sm"
                      className="w-full sm:w-auto"
                      onClick={() => setRsvpTarget(ev)}
                    >
                      <CalendarDays className="size-3.5 mr-1.5" />
                      Sign up
                    </Button>
                  ) : (
                    <span className="block rounded-full bg-muted px-2.5 py-1 text-center text-xs font-medium text-muted-foreground sm:inline-block">
                      Full
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
        </div>
      ) : null}

      {/* Past events — the family's record of what they signed up
          for. A table rather than the card list above: there's
          nothing to act on here, so the rows only need to be
          scannable, and a year's worth of cards would bury the
          upcoming ones. */}
      {past.length > 0 ? (
        <div>
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-sm font-semibold">Past events</h2>
            <p className="text-xs text-muted-foreground">
              Events that have already happened.
            </p>
          </div>
          <div className="rounded-xl bg-background p-1.5 shadow-sm border">
            <div className="overflow-x-auto rounded-lg border bg-white">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/30">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">
                      Date
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">
                      Event
                    </th>
                    <th className="hidden px-4 py-2 text-left text-xs font-medium text-muted-foreground sm:table-cell">
                      You signed up
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">
                      Hours
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {past.map((ev) => {
                    const c = eventColor(ev.color);
                    const dateObj = parseDate(ev.date);
                    return (
                      <tr key={ev.id} className="hover:bg-muted/20">
                        <td className="whitespace-nowrap px-4 py-2 text-xs tabular-nums text-muted-foreground">
                          {dateObj.toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </td>
                        <td className="px-4 py-2">
                          <span className="flex items-center gap-1.5">
                            <span
                              className={cn(
                                "size-2 shrink-0 rounded-full",
                                c ? c.dot : "bg-slate-300"
                              )}
                              aria-hidden
                            />
                            <span className="font-medium">{ev.title}</span>
                          </span>
                          {ev.location ? (
                            <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                              <MapPin className="size-3 shrink-0" />
                              {ev.location}
                            </span>
                          ) : null}
                          {/* Mobile stand-in for the hidden "You signed
                              up" column. */}
                          {ev.my_rsvp ? (
                            <span className="mt-0.5 flex items-center gap-1 text-xs text-emerald-700 sm:hidden">
                              <CheckCircle2 className="size-3 shrink-0" />
                              You signed up · {ev.my_rsvp.spots}{" "}
                              {ev.my_rsvp.spots === 1 ? "spot" : "spots"}
                            </span>
                          ) : null}
                        </td>
                        <td className="hidden whitespace-nowrap px-4 py-2 text-xs sm:table-cell">
                          {ev.my_rsvp ? (
                            <span className="inline-flex items-center gap-1.5 text-emerald-700">
                              <CheckCircle2 className="size-3.5 shrink-0" />
                              {ev.my_rsvp.spots}{" "}
                              {ev.my_rsvp.spots === 1 ? "spot" : "spots"}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2 text-xs text-muted-foreground">
                          {ev.parent_volunteer_hours &&
                          ev.volunteer_hour_total > 0
                            ? `${formatHours(ev.volunteer_hour_total)} hrs`
                            : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}

      {activeRsvp ? (
        <RsvpDialog
          key={activeRsvp.id}
          event={activeRsvp}
          onDone={(changed) => {
            setRsvpTarget(null);
            // Latch the deep link closed too, or closing the dialog
            // would immediately re-derive it from the still-present
            // `?eventId=` and pop straight back open.
            setDeepLinkDismissed(true);
            if (changed) void mutate();
          }}
        />
      ) : null}
    </div>
  );
}

/** Tap-friendly − / + number stepper — replaces bare `type="number"`
 *  inputs whose tiny native spin arrows are hard to hit, especially on
 *  touch screens. Clamping lives in the caller; the buttons simply
 *  disable at the bounds. */
function Stepper({
  value,
  min,
  max,
  onChange,
  label,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
  /** What's being counted — used for the buttons' aria-labels. */
  label: string;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="size-8 bg-white"
        disabled={value <= min}
        onClick={() => onChange(Math.max(value - 1, min))}
        aria-label={`Fewer ${label}`}
      >
        <Minus className="size-3.5" />
      </Button>
      <span
        className="w-8 text-center text-sm font-medium tabular-nums"
        aria-live="polite"
      >
        {value}
      </span>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="size-8 bg-white"
        disabled={value >= max}
        onClick={() => onChange(Math.min(value + 1, max))}
        aria-label={`More ${label}`}
      >
        <Plus className="size-3.5" />
      </Button>
    </div>
  );
}

/** Reserve / edit / cancel the family's RSVP for one event. */
function RsvpDialog({
  event,
  onDone,
}: {
  event: ParentVolunteerEvent;
  onDone: (changed: boolean) => void;
}) {
  const existing = event.my_rsvp;
  // Spots still available to this family = open spots + what they
  // already hold (editing down releases, editing up consumes).
  // Uncapped events allow the full per-request maximum.
  const maxSpots = event.unlimited
    ? 20
    : Math.min(
        Math.max(event.spots_total - event.spots_taken, 0) +
          (existing?.spots ?? 0),
        20
      );
  const [spots, setSpots] = useState(existing?.spots ?? 1);
  const [comment, setComment] = useState(existing?.comment ?? "");
  const [saving, setSaving] = useState(false);
  const [canceling, setCanceling] = useState(false);

  const eventItems = event.items ?? [];

  // What this family is bringing, keyed by item id. Seeded from the
  // server's `mine` count so reopening shows what they committed to.
  const [claims, setClaims] = useState<Record<number, number>>(() => {
    const seed: Record<number, number> = {};
    for (const it of event.items ?? []) {
      if (it.mine > 0) seed[it.id] = it.mine;
    }
    return seed;
  });

  const spotsNum = spots;
  const valid =
    Number.isInteger(spotsNum) && spotsNum >= 1 && spotsNum <= maxSpots;

  function setClaim(item: EventItemAvailability, next: number) {
    const capped = Math.max(0, Math.min(next, itemHeadroom(item)));
    setClaims((prev) => {
      const copy = { ...prev };
      if (capped <= 0) delete copy[item.id];
      else copy[item.id] = capped;
      return copy;
    });
  }

  async function save() {
    if (!valid || saving || canceling) return;
    setSaving(true);
    try {
      const res = await fetch("/api/volunteer-events/rsvp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId: event.id,
          spots: spotsNum,
          comment: comment.trim(),
          items: eventItems
            .map((it) => ({ itemId: it.id, quantity: claims[it.id] ?? 0 }))
            .filter((c) => c.quantity > 0),
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(body?.error ?? `Sign-up failed (${res.status})`);
      }
      toast.success(
        existing ? "RSVP updated." : "You're signed up — see you there!"
      );
      onDone(true);
    } catch (err) {
      console.error("RSVP failed:", err);
      toast.error(err instanceof Error ? err.message : "Couldn't sign up.");
      setSaving(false);
    }
  }

  async function cancelRsvp() {
    if (saving || canceling) return;
    setCanceling(true);
    try {
      const res = await fetch(
        `/api/volunteer-events/rsvp?eventId=${event.id}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Cancel failed (${res.status})`);
      }
      toast.success("RSVP canceled.");
      onDone(true);
    } catch (err) {
      console.error("RSVP cancel failed:", err);
      toast.error(
        err instanceof Error ? err.message : "Couldn't cancel the RSVP."
      );
      setCanceling(false);
    }
  }

  const dateLabel = parseDate(event.date).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <Dialog open onOpenChange={(o) => !o && !saving && !canceling && onDone(false)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="leading-snug">
            {existing ? "Edit your RSVP" : `Sign up — ${event.title}`}
          </DialogTitle>
          <DialogDescription>
            {dateLabel}
            {event.start_time ? ` · ${fmtEventTime(event.start_time)}` : ""}
            {event.location ? ` · ${event.location}` : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Parent spots to reserve</Label>
            <Stepper
              value={spots}
              min={1}
              max={maxSpots}
              onChange={setSpots}
              label="parent spots"
            />
            <p className="text-[11px] text-muted-foreground">
              {maxSpots} available to your family.
            </p>
          </div>

          {/* What the event still needs. Each row shows how many are
              wanted and how many are already spoken for across all
              families, so a parent can see at a glance where they'd
              actually help. Fully-covered items stay visible but
              locked — hiding them reads as "nothing needed". */}
          {eventItems.length > 0 ? (
            <div className="space-y-1.5">
              <Label>Can you bring anything? (optional)</Label>
              <ul className="divide-y rounded-md border">
                {eventItems.map((it) => {
                  const claimedByMe = claims[it.id] ?? 0;
                  const max = itemHeadroom(it);
                  const othersHave = it.claimed - it.mine;
                  const covered = max <= 0;
                  return (
                    <li
                      key={it.id}
                      className="flex items-center gap-3 px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {it.label}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {covered
                            ? "Fully covered — thank you!"
                            : `${othersHave + claimedByMe} of ${it.quantity} claimed`}
                        </p>
                      </div>
                      <Stepper
                        value={claimedByMe}
                        min={0}
                        max={max}
                        onChange={(next) => setClaim(it, next)}
                        label={it.label}
                      />
                    </li>
                  );
                })}
              </ul>
              <p className="text-[11px] text-muted-foreground">
                Use the + button on anything you can bring.
              </p>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="rsvp-comment">Who&rsquo;s coming? (optional)</Label>
            <Textarea
              id="rsvp-comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder="Names of the adults attending, or anything we should know."
            />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          {existing ? (
            <Button
              variant="outline"
              className="bg-white text-red-600 hover:bg-red-50 hover:text-red-700"
              disabled={saving || canceling}
              onClick={() => void cancelRsvp()}
            >
              {canceling ? (
                <>
                  <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                  Canceling
                </>
              ) : (
                "Cancel RSVP"
              )}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="bg-white"
              disabled={saving || canceling}
              onClick={() => onDone(false)}
            >
              Close
            </Button>
            <Button
              disabled={!valid || saving || canceling}
              onClick={() => void save()}
            >
              {saving ? (
                <>
                  <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                  Saving
                </>
              ) : existing ? (
                "Save changes"
              ) : (
                "Reserve spots"
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

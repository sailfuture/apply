"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { DashboardPageHeader } from "@/components/dashboard-page-header";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useApplications, useSchoolYears } from "@/hooks/use-api";

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
    <div className="flex flex-1 flex-col gap-6 p-6 mx-auto w-full max-w-4xl">
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
                    <TableHead className="px-4 py-2 text-right whitespace-nowrap">
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
                      <TableCell className="px-4 py-3">
                        <p className="font-medium">
                          {entry.activity_description || "—"}
                        </p>
                        {entry.activity_category ? (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {entry.activity_category}
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell className="px-4 py-3 text-right font-medium whitespace-nowrap">
                        {formatHours(Number(entry.hours) || 0)}
                      </TableCell>
                      <TableCell className="px-4 py-3 text-right whitespace-nowrap">
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
          href="mailto:tward@sailfuture.org?subject=Volunteer%20hours%20question"
          className="text-primary underline underline-offset-2"
        >
          contact the office
        </a>
        .
      </p>
    </div>
  );
}

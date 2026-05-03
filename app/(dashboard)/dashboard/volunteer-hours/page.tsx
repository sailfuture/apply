"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { DashboardPageHeader } from "@/components/dashboard-page-header";
import { useApplications, useSchoolYears } from "@/hooks/use-api";

/**
 * Volunteer Hours detail page.
 *
 * Stub for now — admin-managed volunteer hours table (40/yr, 8/term over
 * 5 terms) lands in the Phase 3 work. Route exists so the dashboard's
 * "View Volunteer Hours" button has a destination today.
 */
export default function VolunteerHoursPage() {
  const searchParams = useSearchParams();
  const yearIdParam = searchParams.get("yearId");

  // Defensive fallback if the parent lands here without `?yearId` (the
  // dashboard normally propagates it via URL, but stale links can drop
  // it). Picks the most recent year the family has an application for.
  const { data: applications } = useApplications();
  const yearId = useMemo<string | null>(() => {
    if (yearIdParam) return yearIdParam;
    if (!applications) return null;
    const ids = Array.from(
      new Set(
        (applications as { registration_school_years_id: number }[]).map(
          (a) => a.registration_school_years_id
        )
      )
    );
    if (ids.length === 0) return null;
    return String(ids.reduce((max, yid) => (yid > max ? yid : max)));
  }, [yearIdParam, applications]);

  const dashboardHref = yearId ? `/dashboard?yearId=${yearId}` : "/dashboard";

  // Look up the year name so we can show it in the breadcrumb + title.
  const { data: yearsData } = useSchoolYears();
  const yearName = useMemo(() => {
    if (!yearId || !yearsData) return null;
    const found = (yearsData as { id: number; year_name: string }[]).find(
      (y) => y.id === Number(yearId)
    );
    return found?.year_name ?? null;
  }, [yearId, yearsData]);

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
            : "Hours logged this year"
        }
        subtitle="40 hours per family per academic year, or 8 per term over 5 academic terms. Your logged hours will appear here as the admissions team confirms them."
      />

      <div className="rounded-xl border bg-white p-12 text-center">
        <p className="text-sm font-medium">Coming soon</p>
        <p className="text-xs text-muted-foreground mt-2 max-w-md mx-auto">
          We&rsquo;re finishing the volunteer-hours tracker. As you and your
          family log time on Academy events, your running total and
          per-term breakdown will show up here.
        </p>
        <Button asChild variant="outline" className="mt-6 bg-white">
          <a href="mailto:tward@sailfuture.org?subject=Volunteer%20hours%20question">
            Contact the office
          </a>
        </Button>
      </div>
    </div>
  );
}

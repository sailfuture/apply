"use client";

import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { MessageSquare, FileText, CheckCircle, ClipboardList } from "lucide-react";
import { StatsCard } from "@/components/admin/stats-card";
import { StatusBadge } from "@/components/admin/status-badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { adminFetcher as fetcher } from "@/lib/admin-fetcher";
import type { ApplicationStatus } from "@/lib/application-status";

interface StatsResponse {
  inquiries: { total: number; recent: number };
  applications: {
    total: number;
    draft: number;
    submitted: number;
    offered: number;
    accepted: number;
    denied: number;
  };
  registrations: { total: number; completed: number; inProgress: number };
  students: { total: number };
}

interface Inquiry {
  id: number;
  created_at: number;
  primary_first_name: string;
  primary_last_name: string;
  primary_email: string;
  student_first_name: string;
  student_last_name: string;
}

// Matches the per-family application progress row returned by
// `/api/admin/applications` — one row per family per year, carrying
// section completion + submitted state. Used by the dashboard's
// "Recent Applications" card to surface families that recently
// touched their application.
interface Application {
  id: number;
  family_id: number;
  family_name: string;
  primary_name: string;
  primary_email: string;
  student_count: number;
  isSubmitted: boolean;
  sections_complete: number;
  sections_total: number;
  submitted_at: number | null;
  last_edited: number | null;
}

export default function AdminDashboardPage() {
  const searchParams = useSearchParams();
  const yearId = searchParams.get("yearId");

  const {
    data: stats,
    isLoading: statsLoading,
    error: statsError,
  } = useSWR<StatsResponse>(
    yearId ? `/api/admin/stats?yearId=${yearId}` : `/api/admin/stats`,
    fetcher
  );

  const { data: inquiries } = useSWR<Inquiry[]>(
    "/api/admin/inquiries",
    fetcher
  );

  const { data: applications } = useSWR<Application[]>(
    yearId ? `/api/admin/applications?yearId=${yearId}` : null,
    fetcher
  );

  // Loading skeleton ONLY during the initial in-flight fetch — once the
  // request settles (success or error) we render the page so the chrome
  // + per-card error states show. Returning the skeleton on every error
  // would lock the page in a loading state forever.
  if (statsLoading && !stats && !statsError) {
    return (
      <div className="space-y-6 p-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-lg" />
          ))}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-64 rounded-lg" />
          <Skeleton className="h-64 rounded-lg" />
        </div>
      </div>
    );
  }

  // Defensive defaults so the cards render even when stats fails. Each
  // count falls back to 0 with the error surfaced as a banner above —
  // the chrome (top nav, etc.) keeps working regardless.
  const safeStats: StatsResponse = stats ?? {
    inquiries: { total: 0, recent: 0 },
    applications: {
      total: 0,
      draft: 0,
      submitted: 0,
      offered: 0,
      accepted: 0,
      denied: 0,
    },
    registrations: { total: 0, completed: 0, inProgress: 0 },
    students: { total: 0 },
  };

  // Defensive `Array.isArray` guards — even with the throwing fetcher
  // in place, a stale `data` shape (e.g. during a hot-reload mid-deploy)
  // shouldn't crash the dashboard. Falling back to an empty list is a
  // strictly better UX than the white-screen-of-death.
  const recentInquiries = (Array.isArray(inquiries) ? inquiries : [])
    .slice()
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, 5);

  // Sort by most-recently-edited so the dashboard surfaces families
  // that just touched their application — the per-family endpoint
  // doesn't have a `created_at`, so we fall through to `submitted_at`
  // and `last_edited` instead.
  const recentApps = (Array.isArray(applications) ? applications : [])
    .slice()
    .sort((a, b) => {
      const aT = a.last_edited ?? a.submitted_at ?? 0;
      const bT = b.last_edited ?? b.submitted_at ?? 0;
      return bT - aT;
    })
    .slice(0, 5);


  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">Overview of admissions activity.</p>
      </div>

      {statsError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Stats failed to load:{" "}
          {statsError instanceof Error ? statsError.message : "unknown error"}.
          Counts shown below default to 0 until the next refresh.
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatsCard
          title="Inquiries"
          value={safeStats.inquiries.total}
          icon={<MessageSquare className="size-5" />}
          description={`${safeStats.inquiries.recent} this month`}
        />
        <StatsCard
          title="Applications"
          value={safeStats.applications.submitted}
          icon={<FileText className="size-5" />}
          description={`${safeStats.applications.draft} drafts, ${safeStats.applications.total} total`}
        />
        <StatsCard
          title="Accepted"
          value={safeStats.applications.accepted}
          icon={<CheckCircle className="size-5" />}
          description={`${safeStats.applications.offered} offered`}
        />
        <StatsCard
          title="Registered"
          value={safeStats.registrations.completed}
          icon={<ClipboardList className="size-5" />}
          description={`${safeStats.registrations.inProgress} in progress`}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent Inquiries</CardTitle>
          </CardHeader>
          <CardContent>
            {recentInquiries.length === 0 ? (
              <p className="text-sm text-muted-foreground">No inquiries yet.</p>
            ) : (
              <div className="space-y-3">
                {recentInquiries.map((inq) => (
                  <div
                    key={inq.id}
                    className="flex items-center justify-between rounded-md border px-3 py-2"
                  >
                    <div>
                      <p className="text-sm font-medium">
                        {inq.primary_first_name} {inq.primary_last_name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {inq.student_first_name} {inq.student_last_name} &middot; {inq.primary_email}
                      </p>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {new Date(inq.created_at).toLocaleDateString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent Applications</CardTitle>
          </CardHeader>
          <CardContent>
            {recentApps.length === 0 ? (
              <p className="text-sm text-muted-foreground">No applications yet.</p>
            ) : (
              <div className="space-y-3">
                {recentApps.map((app) => {
                  const status: ApplicationStatus = app.isSubmitted
                    ? "submitted"
                    : app.sections_complete > 0
                      ? "draft"
                      : "draft";
                  return (
                    <div
                      key={app.id}
                      className="flex items-center justify-between rounded-md border px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">
                          {app.family_name || `Family #${app.family_id}`}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {app.student_count}{" "}
                          {app.student_count === 1 ? "student" : "students"}
                          {" · "}
                          {app.sections_complete}/{app.sections_total} sections
                        </p>
                      </div>
                      <StatusBadge status={status} />
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

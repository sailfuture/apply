"use client";

import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { MessageSquare, FileText, CheckCircle, ClipboardList } from "lucide-react";
import { StatsCard } from "@/components/admin/stats-card";
import { StatusBadge } from "@/components/admin/status-badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface StatsResponse {
  inquiries: { total: number; recent: number };
  applications: { total: number; draft: number; submitted: number; offered: number; accepted: number };
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

interface Application {
  id: number;
  created_at: number;
  registration_students_id: number;
  registration_families_id: number;
  isSubmitted: boolean;
  isOffered: boolean;
  isAccepted: boolean;
}

export default function AdminDashboardPage() {
  const searchParams = useSearchParams();
  const yearId = searchParams.get("yearId");

  const { data: stats, isLoading: statsLoading } = useSWR<StatsResponse>(
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

  if (statsLoading || !stats) {
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

  const recentInquiries = (inquiries ?? [])
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, 5);

  const recentApps = (applications ?? [])
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, 5);

  function getAppStatus(app: Application) {
    if (app.isAccepted) return "accepted" as const;
    if (app.isOffered) return "offered" as const;
    if (app.isSubmitted) return "submitted" as const;
    return "draft" as const;
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">Overview of admissions activity.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatsCard
          title="Inquiries"
          value={stats.inquiries.total}
          icon={<MessageSquare className="size-5" />}
          description={`${stats.inquiries.recent} this month`}
        />
        <StatsCard
          title="Applications"
          value={stats.applications.submitted}
          icon={<FileText className="size-5" />}
          description={`${stats.applications.draft} drafts, ${stats.applications.total} total`}
        />
        <StatsCard
          title="Accepted"
          value={stats.applications.accepted}
          icon={<CheckCircle className="size-5" />}
          description={`${stats.applications.offered} offered`}
        />
        <StatsCard
          title="Registered"
          value={stats.registrations.completed}
          icon={<ClipboardList className="size-5" />}
          description={`${stats.registrations.inProgress} in progress`}
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
                {recentApps.map((app) => (
                  <div
                    key={app.id}
                    className="flex items-center justify-between rounded-md border px-3 py-2"
                  >
                    <div>
                      <p className="text-sm font-medium">
                        Application #{app.id}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Family #{app.registration_families_id}
                      </p>
                    </div>
                    <StatusBadge status={getAppStatus(app)} />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

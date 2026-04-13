"use client";

import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { MessageSquare, FileText, CheckCircle, ClipboardList } from "lucide-react";
import { StatsCard } from "@/components/admin/stats-card";
import { StatusBadge, type ApplicationStatus } from "@/components/admin/status-badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface StatsData {
  inquiries: number;
  applications: number;
  accepted: number;
  registered: number;
  recentInquiries: {
    id: number;
    parent_name: string;
    email: string;
    student_name: string;
    created_at: string;
  }[];
  recentApplications: {
    id: number;
    family_name: string;
    student_name: string;
    status: ApplicationStatus;
    submitted_at: string;
  }[];
}

export default function AdminDashboardPage() {
  const searchParams = useSearchParams();
  const yearId = searchParams.get("yearId");

  const { data, isLoading } = useSWR<StatsData>(
    yearId ? `/api/admin/stats?yearId=${yearId}` : null,
    fetcher
  );

  if (!yearId) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <p className="text-muted-foreground">Select a school year to view the dashboard.</p>
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="p-6 space-y-6">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[120px]" />
          ))}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-[300px]" />
          <Skeleton className="h-[300px]" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatsCard
          title="Inquiries"
          value={data.inquiries}
          icon={<MessageSquare className="size-4" />}
          description="Total inquiries this year"
        />
        <StatsCard
          title="Applications"
          value={data.applications}
          icon={<FileText className="size-4" />}
          description="Total applications submitted"
        />
        <StatsCard
          title="Accepted"
          value={data.accepted}
          icon={<CheckCircle className="size-4" />}
          description="Students accepted"
        />
        <StatsCard
          title="Registered"
          value={data.registered}
          icon={<ClipboardList className="size-4" />}
          description="Completed registration"
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent Inquiries</CardTitle>
          </CardHeader>
          <CardContent>
            {data.recentInquiries.length === 0 ? (
              <p className="text-sm text-muted-foreground">No recent inquiries.</p>
            ) : (
              <div className="space-y-3">
                {data.recentInquiries.map((inq) => (
                  <div
                    key={inq.id}
                    className="flex items-center justify-between rounded-md border px-3 py-2"
                  >
                    <div>
                      <p className="text-sm font-medium">{inq.parent_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {inq.student_name} &middot; {inq.email}
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
            {data.recentApplications.length === 0 ? (
              <p className="text-sm text-muted-foreground">No recent applications.</p>
            ) : (
              <div className="space-y-3">
                {data.recentApplications.map((app) => (
                  <div
                    key={app.id}
                    className="flex items-center justify-between rounded-md border px-3 py-2"
                  >
                    <div>
                      <p className="text-sm font-medium">{app.family_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {app.student_name}
                      </p>
                    </div>
                    <StatusBadge status={app.status} />
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

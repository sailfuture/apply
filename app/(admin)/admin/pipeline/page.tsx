"use client";

import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import {
  StatusBadge,
  type ApplicationStatus,
} from "@/components/admin/status-badge";
import { Skeleton } from "@/components/ui/skeleton";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface PipelineItem {
  id: number;
  student_name: string;
  family_name: string;
  status: ApplicationStatus;
  date: string;
}

interface PipelineData {
  inquiry: PipelineItem[];
  applied: PipelineItem[];
  offered: PipelineItem[];
  accepted: PipelineItem[];
  registered: PipelineItem[];
}

const stageConfig: {
  key: keyof PipelineData;
  label: string;
  status: ApplicationStatus;
}[] = [
  { key: "inquiry", label: "Inquiry", status: "inquiry" },
  { key: "applied", label: "Applied", status: "submitted" },
  { key: "offered", label: "Offered", status: "offered" },
  { key: "accepted", label: "Accepted", status: "accepted" },
  { key: "registered", label: "Registered", status: "registered" },
];

function PipelineCard({ item }: { item: PipelineItem }) {
  return (
    <div className="rounded-lg border bg-card p-3 shadow-sm">
      <p className="text-sm font-medium">{item.student_name}</p>
      <p className="text-xs text-muted-foreground">{item.family_name}</p>
      <div className="mt-2 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {new Date(item.date).toLocaleDateString()}
        </span>
        <StatusBadge status={item.status} />
      </div>
    </div>
  );
}

export default function PipelinePage() {
  const searchParams = useSearchParams();
  const yearId = searchParams.get("yearId");

  const { data, isLoading } = useSWR<PipelineData>(
    yearId ? `/api/admin/pipeline?yearId=${yearId}` : null,
    fetcher
  );

  if (!yearId) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <p className="text-muted-foreground">
          Select a school year to view the pipeline.
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Pipeline</h1>
        <p className="text-sm text-muted-foreground">
          Visual overview of the admissions pipeline.
        </p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-[400px]" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3 lg:grid-cols-5">
          {stageConfig.map((stage) => {
            const items = data?.[stage.key] ?? [];
            return (
              <Card key={stage.key} className="flex flex-col">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-medium">
                      {stage.label}
                    </CardTitle>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                      {items.length}
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="flex-1 space-y-2 overflow-y-auto max-h-[500px]">
                  {items.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-8">
                      No students
                    </p>
                  ) : (
                    items.map((item) => (
                      <PipelineCard key={item.id} item={item} />
                    ))
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

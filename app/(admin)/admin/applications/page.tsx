"use client";

import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { DataTable, type ColumnDef } from "@/components/admin/data-table";
import {
  StatusBadge,
  type ApplicationStatus,
} from "@/components/admin/status-badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useState } from "react";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Application {
  id: number;
  family_id: number;
  family_name: string;
  student_name: string;
  status: ApplicationStatus;
  submitted_at: string | null;
  financial_aid: boolean;
  sufs_type: string;
  [key: string]: unknown;
}

export default function ApplicationsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const yearId = searchParams.get("yearId");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const { data, isLoading } = useSWR<Application[]>(
    yearId
      ? `/api/admin/applications?yearId=${yearId}`
      : `/api/admin/applications`,
    fetcher
  );

  const filtered =
    statusFilter === "all"
      ? data ?? []
      : (data ?? []).filter((a) => a.status === statusFilter);

  const columns: ColumnDef<Application>[] = [
    {
      key: "family_name",
      header: "Family",
      sortable: true,
      searchable: true,
    },
    {
      key: "student_name",
      header: "Student",
      sortable: true,
      searchable: true,
    },
    {
      key: "status",
      header: "Status",
      sortable: true,
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: "submitted_at",
      header: "Submitted",
      sortable: true,
      render: (row) =>
        row.submitted_at
          ? new Date(row.submitted_at).toLocaleDateString()
          : "—",
    },
    {
      key: "financial_aid",
      header: "Financial Aid",
      render: (row) => (row.financial_aid ? "Yes" : "No"),
    },
    {
      key: "sufs_type",
      header: "SUFS Type",
    },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Applications</h1>
          <p className="text-sm text-muted-foreground">
            All student applications for the selected school year.
          </p>
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="submitted">Submitted</SelectItem>
            <SelectItem value="offered">Offered</SelectItem>
            <SelectItem value="accepted">Accepted</SelectItem>
            <SelectItem value="registered">Registered</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <DataTable<Application>
        columns={columns}
        data={filtered}
        isLoading={isLoading}
        searchPlaceholder="Search by family or student name..."
        onRowClick={(row) => {
          const params = yearId ? `?yearId=${yearId}` : "";
          router.push(`/admin/families/${row.family_id}${params}`);
        }}
      />
    </div>
  );
}

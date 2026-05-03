"use client";

import useSWR from "swr";
import { useRouter, useSearchParams } from "next/navigation";
import { DataTable, type ColumnDef } from "@/components/admin/data-table";
import { StatusBadge } from "@/components/admin/status-badge";
import type { ApplicationStatus } from "@/lib/application-status";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface FamilyRow {
  id: number;
  family_name: string;
  created_at: number;
  parent_count: number;
  student_count: number;
  application_count: number;
  isAccepted: boolean;
  isSubmitted: boolean;
  top_status: ApplicationStatus | null;
  primary_email: string;
  primary_name: string;
  [key: string]: unknown;
}

/**
 * All families in the system. Backed by `/api/admin/families`, which now
 * pulls from Xano's enriched `/registration_families_all_details` endpoint
 * — so each row carries the parent/student counts, the worst-case
 * application status, and the primary parent's contact info without any
 * follow-up fetches.
 */
export default function AdminFamiliesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const yearId = searchParams.get("yearId");

  const { data, isLoading } = useSWR<FamilyRow[]>(
    yearId ? `/api/admin/families?yearId=${yearId}` : "/api/admin/families",
    fetcher
  );

  const rows = data ?? [];

  const columns: ColumnDef<FamilyRow>[] = [
    {
      key: "family_name",
      header: "Family",
      sortable: true,
      searchable: true,
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.family_name}</p>
          {row.primary_name ? (
            <p className="truncate text-xs text-muted-foreground">
              {row.primary_name}
              {row.primary_email ? ` · ${row.primary_email}` : ""}
            </p>
          ) : null}
        </div>
      ),
    },
    {
      key: "student_count",
      header: "Students",
      sortable: true,
      render: (row) => row.student_count,
    },
    {
      key: "parent_count",
      header: "Parents",
      sortable: true,
      render: (row) => row.parent_count,
    },
    {
      key: "application_count",
      header: yearId ? "Apps (year)" : "Apps (all)",
      sortable: true,
      render: (row) => row.application_count,
    },
    {
      key: "top_status",
      header: "Status",
      render: (row) =>
        row.top_status ? <StatusBadge status={row.top_status} /> : "—",
    },
  ];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Families</h1>
        <p className="text-sm text-muted-foreground">
          Every family on file. Click a row to open the family record, comms
          log, and applications.
        </p>
      </div>
      <DataTable
        columns={columns}
        data={rows}
        isLoading={isLoading}
        searchPlaceholder="Search families…"
        onRowClick={(row) => {
          const params = yearId ? `?yearId=${yearId}` : "";
          router.push(`/admin/families/${row.id}${params}`);
        }}
      />
    </div>
  );
}

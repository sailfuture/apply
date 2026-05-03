"use client";

import useSWR from "swr";
import { useRouter, useSearchParams } from "next/navigation";
import { DataTable, type ColumnDef } from "@/components/admin/data-table";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface StudentRow {
  id: number;
  first_name: string;
  last_name: string;
  date_of_birth: string;
  gender: string;
  ethnicity: string;
  isAccepted: boolean;
  registration_families_id: number;
  [key: string]: unknown;
}

/**
 * Cross-year student roster. Reads the family-wide students endpoint and
 * presents a sortable, searchable table. Click-through routes to the
 * canonical per-student admin record (history view) once that page lands;
 * for now we route to the family page with a hash so admins still have a
 * way to drill in.
 */
export default function AdminStudentsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const yearId = searchParams.get("yearId");

  const { data, isLoading } = useSWR<StudentRow[]>(
    "/api/admin/students",
    fetcher
  );

  const rows = (data ?? []).map((s) => ({
    ...s,
    full_name: `${s.first_name} ${s.last_name}`.trim(),
  }));

  const columns: ColumnDef<StudentRow & { full_name: string }>[] = [
    { key: "full_name", header: "Student", sortable: true, searchable: true },
    {
      key: "date_of_birth",
      header: "DOB",
      sortable: true,
      render: (row) =>
        row.date_of_birth
          ? new Date(`${row.date_of_birth}T00:00:00`).toLocaleDateString()
          : "—",
    },
    { key: "gender", header: "Gender" },
    { key: "ethnicity", header: "Ethnicity" },
    {
      key: "isAccepted",
      header: "Accepted",
      render: (row) => (row.isAccepted ? "Yes" : "No"),
    },
  ];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Students</h1>
        <p className="text-sm text-muted-foreground">
          Cross-year student roster. Click into a row to open the family record.
        </p>
      </div>
      <DataTable
        columns={columns}
        data={rows}
        isLoading={isLoading}
        searchPlaceholder="Search students…"
        onRowClick={(row) => {
          const params = yearId ? `?yearId=${yearId}` : "";
          router.push(`/admin/students/${row.id}${params}`);
        }}
      />
    </div>
  );
}

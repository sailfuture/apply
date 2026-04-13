"use client";

import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { DataTable, type ColumnDef } from "@/components/admin/data-table";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Inquiry {
  id: number;
  created_at: string;
  parent_name: string;
  email: string;
  phone: string;
  student_name: string;
  grade: string;
  source: string;
  [key: string]: unknown;
}

const columns: ColumnDef<Inquiry>[] = [
  {
    key: "created_at",
    header: "Date",
    sortable: true,
    render: (row) => new Date(row.created_at).toLocaleDateString(),
  },
  {
    key: "parent_name",
    header: "Parent Name",
    sortable: true,
    searchable: true,
  },
  {
    key: "email",
    header: "Email",
    searchable: true,
  },
  {
    key: "phone",
    header: "Phone",
  },
  {
    key: "student_name",
    header: "Student",
    sortable: true,
    searchable: true,
  },
  {
    key: "grade",
    header: "Grade",
    sortable: true,
  },
  {
    key: "source",
    header: "Source",
  },
];

export default function InquiriesPage() {
  const searchParams = useSearchParams();
  const yearId = searchParams.get("yearId");

  const { data, isLoading } = useSWR<Inquiry[]>(
    yearId ? `/api/admin/inquiries?yearId=${yearId}` : `/api/admin/inquiries`,
    fetcher
  );

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Inquiries</h1>
        <p className="text-sm text-muted-foreground">
          All inquiry submissions from prospective families.
        </p>
      </div>

      <DataTable<Inquiry>
        columns={columns}
        data={data ?? []}
        isLoading={isLoading}
        searchPlaceholder="Search by name or email..."
      />
    </div>
  );
}

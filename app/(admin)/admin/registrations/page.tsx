"use client";

import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { DataTable, type ColumnDef } from "@/components/admin/data-table";
import { cn } from "@/lib/utils";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Registration {
  id: number;
  family_name: string;
  student_name: string;
  documents_complete: boolean;
  health_forms_complete: boolean;
  waiver_signed: boolean;
  status: string;
  [key: string]: unknown;
}

function CompletionIndicator({ complete }: { complete: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium",
        complete ? "text-emerald-600" : "text-amber-600"
      )}
    >
      <span
        className={cn(
          "size-2 rounded-full",
          complete ? "bg-emerald-500" : "bg-amber-400"
        )}
      />
      {complete ? "Complete" : "Pending"}
    </span>
  );
}

const columns: ColumnDef<Registration>[] = [
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
    key: "documents_complete",
    header: "Documents",
    render: (row) => <CompletionIndicator complete={row.documents_complete} />,
  },
  {
    key: "health_forms_complete",
    header: "Health Forms",
    render: (row) => (
      <CompletionIndicator complete={row.health_forms_complete} />
    ),
  },
  {
    key: "waiver_signed",
    header: "Waiver",
    render: (row) => <CompletionIndicator complete={row.waiver_signed} />,
  },
  {
    key: "status",
    header: "Status",
    sortable: true,
    render: (row) => {
      const allDone =
        row.documents_complete &&
        row.health_forms_complete &&
        row.waiver_signed;
      return (
        <span
          className={cn(
            "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
            allDone
              ? "bg-green-50 text-green-800 border-green-200"
              : "bg-amber-50 text-amber-700 border-amber-200"
          )}
        >
          {allDone ? "Complete" : "In Progress"}
        </span>
      );
    },
  },
];

export default function RegistrationsPage() {
  const searchParams = useSearchParams();
  const yearId = searchParams.get("yearId");

  const { data, isLoading } = useSWR<Registration[]>(
    yearId
      ? `/api/admin/registrations?yearId=${yearId}`
      : `/api/admin/registrations`,
    fetcher
  );

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Registrations</h1>
        <p className="text-sm text-muted-foreground">
          Track registration document completion for accepted students.
        </p>
      </div>

      <DataTable<Registration>
        columns={columns}
        data={data ?? []}
        isLoading={isLoading}
        searchPlaceholder="Search by family or student name..."
      />
    </div>
  );
}

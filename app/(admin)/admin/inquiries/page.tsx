"use client";

import { useState } from "react";
import useSWR from "swr";
import {
  DataTable,
  type ColumnDef,
} from "@/components/admin/data-table";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Mail, Phone } from "lucide-react";
import { adminFetcher } from "@/lib/admin-fetcher";

/**
 * Real shape of `/api/admin/inquiries` rows. The earlier interface in
 * this file expected fields that never existed on the response (`email`,
 * `parent_name`, `grade`, `source`) — that mismatch is why the table was
 * empty/broken. This matches the actual `registration_inquiry` schema.
 */
interface Inquiry {
  id: number;
  created_at: number;
  primary_first_name: string;
  primary_last_name: string;
  primary_email: string;
  primary_phone: number;
  student_first_name: string;
  student_last_name: string;
  current_grade: string;
  starting_grade: string;
  previous_school: string;
  about_student: string;
  hear_about_us: string;
  messaging_opt_in: boolean;
  // Computed at parse time so the DataTable's sort + search can hit a flat
  // string instead of two separate name fields.
  parent_name: string;
  student_name: string;
  [key: string]: unknown;
}

/**
 * Format a phone number stored as `number` in Xano. We see three shapes
 * in real data:
 *   - 10 digits  → "(813) 505-3539"
 *   - 11 digits starting with 1 → "+1 (813) 505-3539"
 *   - garbage (too long, leading non-1) → render raw so we don't lose info
 */
function formatPhone(raw: number | string | null | undefined): string {
  if (raw === null || raw === undefined) return "";
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return digits || "";
}

/**
 * Defensive: if an email arrives wrapped in markdown link syntax
 * (`[email](mailto:email)` — common copy/paste artifact), pull the
 * plain email back out so links and display behave.
 */
function cleanEmail(raw: string | null | undefined): string {
  if (!raw) return "";
  const md = raw.match(/\[([^\]]+)\]\(mailto:[^)]+\)/i);
  return md?.[1] ?? raw;
}

export default function InquiriesPage() {
  const { data, isLoading, error } = useSWR<Inquiry[]>(
    "/api/admin/inquiries",
    adminFetcher
  );

  const rows: Inquiry[] = (Array.isArray(data) ? data : []).map((r) => ({
    ...r,
    primary_email: cleanEmail(r.primary_email),
    parent_name: `${r.primary_first_name ?? ""} ${r.primary_last_name ?? ""}`.trim(),
    student_name: `${r.student_first_name ?? ""} ${r.student_last_name ?? ""}`.trim(),
  }));

  const [active, setActive] = useState<Inquiry | null>(null);

  const columns: ColumnDef<Inquiry>[] = [
    {
      key: "created_at",
      header: "Date",
      sortable: true,
      render: (row) => new Date(row.created_at).toLocaleDateString(),
    },
    {
      key: "parent_name",
      header: "Parent",
      sortable: true,
      searchable: true,
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.parent_name || "—"}</p>
          {row.primary_email ? (
            <a
              href={`mailto:${row.primary_email}`}
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline truncate"
            >
              <Mail className="size-3" />
              {row.primary_email}
            </a>
          ) : null}
        </div>
      ),
    },
    {
      key: "primary_phone",
      header: "Phone",
      render: (row) => {
        const formatted = formatPhone(row.primary_phone);
        if (!formatted) return "—";
        return (
          <a
            href={`tel:${String(row.primary_phone).replace(/\D/g, "")}`}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 text-xs hover:text-foreground"
          >
            <Phone className="size-3" />
            {formatted}
          </a>
        );
      },
    },
    {
      key: "student_name",
      header: "Student",
      sortable: true,
      searchable: true,
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.student_name || "—"}</p>
          <p className="truncate text-xs text-muted-foreground">
            {row.current_grade ? `Grade ${row.current_grade}` : "—"}
            {row.starting_grade && row.starting_grade !== row.current_grade
              ? ` → ${row.starting_grade}`
              : ""}
          </p>
        </div>
      ),
    },
    {
      key: "previous_school",
      header: "Previous school",
      searchable: true,
      render: (row) => row.previous_school || "—",
    },
    {
      key: "hear_about_us",
      header: "Source",
      render: (row) => row.hear_about_us || "—",
    },
    {
      key: "messaging_opt_in",
      header: "SMS opt-in",
      render: (row) => (row.messaging_opt_in ? "Yes" : "No"),
    },
  ];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Inquiries</h1>
        <p className="text-sm text-muted-foreground">
          Inquiry submissions from prospective families. Click a row to read
          the parent&rsquo;s notes about the student.
        </p>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Failed to load inquiries:{" "}
          {error instanceof Error ? error.message : "unknown error"}
        </div>
      ) : null}

      <DataTable<Inquiry>
        columns={columns}
        data={rows}
        isLoading={isLoading}
        searchPlaceholder="Search by parent, student, or school…"
        onRowClick={(row) => setActive(row)}
      />

      <Sheet
        open={active !== null}
        onOpenChange={(open) => {
          if (!open) setActive(null);
        }}
      >
        <SheetContent className="w-full sm:max-w-lg">
          {active ? (
            <>
              <SheetHeader>
                <SheetTitle>{active.parent_name || "Inquiry"}</SheetTitle>
                <SheetDescription>
                  Submitted {new Date(active.created_at).toLocaleString()}
                </SheetDescription>
              </SheetHeader>
              <div className="px-4 pb-6 space-y-5 overflow-y-auto">
                <DetailRow label="Parent">{active.parent_name || "—"}</DetailRow>
                <DetailRow label="Email">
                  {active.primary_email ? (
                    <a
                      href={`mailto:${active.primary_email}`}
                      className="text-primary underline-offset-2 hover:underline"
                    >
                      {active.primary_email}
                    </a>
                  ) : (
                    "—"
                  )}
                </DetailRow>
                <DetailRow label="Phone">
                  {formatPhone(active.primary_phone) || "—"}
                </DetailRow>
                <DetailRow label="Student">
                  {active.student_name || "—"}
                </DetailRow>
                <DetailRow label="Grade">
                  {active.current_grade || "—"}
                  {active.starting_grade
                    ? ` → ${active.starting_grade}`
                    : ""}
                </DetailRow>
                <DetailRow label="Previous school">
                  {active.previous_school || "—"}
                </DetailRow>
                <DetailRow label="Source">
                  {active.hear_about_us || "—"}
                </DetailRow>
                <DetailRow label="SMS opt-in">
                  {active.messaging_opt_in ? "Yes" : "No"}
                </DetailRow>
                <DetailRow label="About the student">
                  {active.about_student ? (
                    <p className="whitespace-pre-wrap">
                      {active.about_student}
                    </p>
                  ) : (
                    "—"
                  )}
                </DetailRow>
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <div className="mt-1 text-sm">{children}</div>
    </div>
  );
}

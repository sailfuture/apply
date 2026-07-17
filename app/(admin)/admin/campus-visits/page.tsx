"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { ExternalLink, Mail, Phone } from "lucide-react";
import { DataTable, type ColumnDef } from "@/components/admin/data-table";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { adminFetcher } from "@/lib/admin-fetcher";
import { formatUSPhone } from "@/lib/phone";
import type { CampusVisitRow } from "@/app/api/admin/campus-visits/route";

/**
 * Campus Visits — the database of liability waivers signed on the
 * marketing site before a campus tour. Rows come pre-sorted
 * newest-first from `/api/admin/campus-visits`, each annotated with a
 * DERIVED academic year (the waiver table itself has no year column;
 * the API buckets the signing date against `registration_school_years`
 * windows). The year dropdown here filters on that derived label —
 * campus visits aren't tied to the global year selector because a
 * visitor isn't an applicant yet.
 */
export default function CampusVisitsPage() {
  const { data, isLoading, error } = useSWR<CampusVisitRow[]>(
    "/api/admin/campus-visits",
    adminFetcher,
    { refreshInterval: 60_000 }
  );
  const rows = useMemo(() => (Array.isArray(data) ? data : []), [data]);

  // Year filter options come from the data itself (derived labels),
  // newest year first — matches the newest-first row sort.
  const yearOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const r of rows) {
      if (!seen.has(r.academic_year)) {
        seen.add(r.academic_year);
        out.push(r.academic_year);
      }
    }
    return out;
  }, [rows]);
  const [year, setYear] = useState<string>("all");
  const visible = useMemo(
    () => (year === "all" ? rows : rows.filter((r) => r.academic_year === year)),
    [rows, year]
  );

  const columns: ColumnDef<CampusVisitRow>[] = useMemo(
    () => [
      {
        key: "signed_ts",
        header: "Signed",
        sortable: true,
        width: "w-[110px]",
        render: (r) => (
          <span
            className="whitespace-nowrap text-sm tabular-nums"
            title={new Date(r.signed_ts).toLocaleString()}
          >
            {new Date(r.signed_ts).toLocaleDateString([], {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </span>
        ),
      },
      {
        key: "parent_name",
        header: "Parent",
        sortable: true,
        searchable: true,
        render: (r) => (
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{r.parent_name}</p>
            <div className="mt-0.5 flex flex-col gap-0.5 text-xs text-muted-foreground">
              {r.parent_email ? (
                <a
                  href={`mailto:${r.parent_email}`}
                  className="inline-flex items-center gap-1 hover:text-foreground"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Mail className="size-3 shrink-0" />
                  <span className="truncate">{r.parent_email}</span>
                </a>
              ) : null}
              {r.parent_phone ? (
                <a
                  href={`tel:${r.parent_phone}`}
                  className="inline-flex items-center gap-1 hover:text-foreground"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Phone className="size-3 shrink-0" />
                  {formatUSPhone(r.parent_phone) || r.parent_phone}
                </a>
              ) : null}
            </div>
          </div>
        ),
      },
      {
        key: "student_name",
        header: "Student",
        sortable: true,
        searchable: true,
        render: (r) => (
          <div className="min-w-0">
            <p className="truncate text-sm">{r.student_name}</p>
            {r.student_grade ? (
              <p className="text-xs text-muted-foreground">
                Grade {r.student_grade}
              </p>
            ) : null}
          </div>
        ),
      },
      {
        key: "student_school",
        header: "Current School",
        sortable: true,
        searchable: true,
        render: (r) => (
          <span className="text-sm">{r.student_school || "—"}</span>
        ),
      },
      {
        key: "academic_year",
        header: "Academic Year",
        sortable: true,
        width: "w-[130px]",
        render: (r) => (
          <Badge variant="outline" className="font-normal">
            {r.academic_year}
          </Badge>
        ),
      },
      {
        key: "marketing_opt_in",
        header: "Marketing",
        width: "w-[100px]",
        accessor: (r) => (r.marketing_opt_in ? 1 : 0),
        render: (r) =>
          r.marketing_opt_in ? (
            <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
              Opted in
            </Badge>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          ),
      },
      {
        key: "signature_url",
        header: "Waiver",
        width: "w-[90px]",
        render: (r) =>
          r.signature_url ? (
            <a
              href={r.signature_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs font-medium text-foreground underline underline-offset-2 hover:no-underline"
              onClick={(e) => e.stopPropagation()}
            >
              View
              <ExternalLink className="size-3" />
            </a>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          ),
      },
    ],
    []
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Campus Visits</h1>
          <p className="text-sm text-muted-foreground">
            Liability waivers signed on the website before a campus tour.
          </p>
        </div>
        <div className="w-44">
          <Select value={year} onValueChange={setYear}>
            <SelectTrigger>
              <SelectValue placeholder="Academic year" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All years</SelectItem>
              {yearOptions.map((y) => (
                <SelectItem key={y} value={y}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card className="overflow-hidden bg-white py-0 gap-0">
        <CardHeader className="py-4 border-b bg-white">
          <CardTitle className="text-base">
            Signed waivers
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {visible.length}
              {year === "all" ? "" : ` in ${year}`}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {error && !data ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              Couldn&rsquo;t load campus visits. Refresh to try again.
            </div>
          ) : (
            <DataTable<CampusVisitRow>
              columns={columns}
              data={visible}
              isLoading={isLoading && !data}
              searchPlaceholder="Search by parent, student, or school…"
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

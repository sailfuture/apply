"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Bus, Car, Download, Loader2, Mail, Phone, Undo2, X } from "lucide-react";
import {
  DataTable,
  type ColumnDef,
} from "@/components/admin/data-table";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { adminFetcher } from "@/lib/admin-fetcher";
import { formatUSPhone, digitsOnly } from "@/lib/phone";
import { exportSummerCampXlsx } from "@/lib/summer-camp-export";
import { cn } from "@/lib/utils";

/**
 * Row shape of `/api/admin/summer-camp` — mirrors
 * `registration_summer_camp` in Xano. `student_name` / `parent_name`
 * are computed at parse time so the DataTable's sort/search hit flat
 * strings. `isNotAttending` is the archive flag that splits the two
 * sections.
 */
interface SummerCampRow {
  id: number;
  created_at: number;
  isNotAttending: boolean;
  student_first_name: string;
  student_last_name: string;
  gender: string;
  ethnicity: string;
  swim_level: string;
  transportation: string;
  bus_stop: string;
  current_school: string;
  last_grade_completed: string;
  describe_your_student_and_behavior: string;
  allergies: string;
  dietary_restrictions: string;
  health_conditions: string;
  hearing_or_visual_impairments: string;
  additional_health_information: string;
  carry_epi_pen: boolean;
  preferred_hospital: string;
  primary_parent_first_name: string;
  primary_parent_last_name: string;
  primary_parent_relationship: string;
  primary_phone: string;
  primary_email: string;
  // Computed at parse time
  student_name: string;
  parent_name: string;
  [key: string]: unknown;
}

/** Compact relative time for the Submitted column ("2w", "3d") —
 *  same buckets as the inquiries page; exact datetime is one hover
 *  away via the cell's title. */
function formatRelativeCompact(ts: number | null | undefined): string {
  if (!ts) return "—";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "now";
  const MIN = 60_000;
  const HOUR = 3_600_000;
  const DAY = 86_400_000;
  const WEEK = 7 * DAY;
  const MONTH = 30 * DAY;
  const YEAR = 365 * DAY;
  if (diff < HOUR) return `${Math.floor(diff / MIN)}m`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h`;
  if (diff < WEEK) return `${Math.floor(diff / DAY)}d`;
  if (diff < MONTH) return `${Math.floor(diff / WEEK)}w`;
  if (diff < YEAR) return `${Math.floor(diff / MONTH)}mo`;
  return `${Math.floor(diff / YEAR)}y`;
}

export default function SummerCampPage() {
  const { data, isLoading, error, mutate } = useSWR<SummerCampRow[]>(
    "/api/admin/summer-camp",
    adminFetcher
  );
  const [active, setActive] = useState<SummerCampRow | null>(null);
  // Per-row pending state for the attendance toggle so the button
  // spins while the PATCH is in flight.
  const [savingId, setSavingId] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);

  const rows: SummerCampRow[] = useMemo(
    () =>
      (Array.isArray(data) ? data : [])
        .map((r) => ({
          ...r,
          student_name: `${r.student_first_name ?? ""} ${
            r.student_last_name ?? ""
          }`.trim(),
          parent_name: `${r.primary_parent_first_name ?? ""} ${
            r.primary_parent_last_name ?? ""
          }`.trim(),
        }))
        .sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0)),
    [data]
  );

  const groups = useMemo(() => {
    const attending: SummerCampRow[] = [];
    const notAttending: SummerCampRow[] = [];
    for (const r of rows) {
      if (r.isNotAttending) notAttending.push(r);
      else attending.push(r);
    }
    return { attending, notAttending };
  }, [rows]);

  // Flip the attendance flag with an optimistic mutate so the row
  // jumps between sections immediately; reverts via re-fetch on
  // failure.
  async function setAttendance(row: SummerCampRow, isNotAttending: boolean) {
    setSavingId(row.id);
    try {
      mutate(
        (curr) =>
          (curr ?? []).map((r) =>
            r.id === row.id ? { ...r, isNotAttending } : r
          ),
        { revalidate: false }
      );
      // Keep the Sheet's snapshot in sync if it's open on this row.
      setActive((curr) =>
        curr && curr.id === row.id ? { ...curr, isNotAttending } : curr
      );
      const res = await fetch(`/api/admin/summer-camp/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isNotAttending }),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      toast.success(
        isNotAttending
          ? `${row.student_name || "Student"} marked not attending.`
          : `${row.student_name || "Student"} marked attending.`
      );
      mutate();
    } catch (err) {
      console.error("Failed to update attendance:", err);
      toast.error("Couldn't update attendance.");
      // Revert by re-fetching authoritative data.
      mutate();
    } finally {
      setSavingId(null);
    }
  }

  async function handleExport() {
    if (exporting || rows.length === 0) return;
    setExporting(true);
    try {
      await exportSummerCampXlsx(rows);
    } catch (err) {
      console.error("Failed to export summer camp roster:", err);
      toast.error("Couldn't export the roster.");
    } finally {
      setExporting(false);
    }
  }

  // Shared columns for both sections so they line up vertically when
  // stacked (same lesson as the inquiries page: identical column sets,
  // no per-section variation). Read-only — row click opens the detail
  // sheet, so no trailing action/chevron columns.
  const columns: ColumnDef<SummerCampRow>[] = [
    {
      key: "student_name",
      header: "Student",
      sortable: true,
      searchable: true,
      width: "w-[14%]",
      render: (row) => (
        <span className="block truncate font-medium">
          {row.student_name || "—"}
        </span>
      ),
    },
    {
      key: "parent_name",
      header: "Parent",
      sortable: true,
      searchable: true,
      width: "w-[13%]",
      render: (row) => (
        <span className="block truncate">{row.parent_name || "—"}</span>
      ),
    },
    {
      // Last grade completed, not current grade — the camp form asks
      // what the student just finished.
      key: "last_grade_completed",
      header: "Grade done",
      sortable: true,
      width: "w-[8%]",
      render: (row) => (
        <span className="block truncate">
          {row.last_grade_completed || "—"}
        </span>
      ),
    },
    {
      key: "swim_level",
      header: "Swim",
      sortable: true,
      width: "w-[9%]",
      render: (row) => (
        <span className="block truncate">{row.swim_level || "—"}</span>
      ),
    },
    {
      // Bus riders show their stop (the operationally interesting
      // part); drop-offs just show a car icon + short label.
      key: "transportation",
      header: "Transportation",
      sortable: true,
      width: "w-[14%]",
      render: (row) =>
        row.transportation?.startsWith("Bus") ? (
          <span className="flex min-w-0 items-center gap-1">
            <Bus className="size-3 shrink-0 text-muted-foreground" />
            <span className="truncate" title={row.bus_stop || undefined}>
              {row.bus_stop || "Bus"}
            </span>
          </span>
        ) : (
          <span className="flex min-w-0 items-center gap-1">
            <Car className="size-3 shrink-0 text-muted-foreground" />
            <span className="truncate">Drop off / pick up</span>
          </span>
        ),
    },
    {
      key: "primary_phone",
      header: "Phone",
      width: "w-[11%]",
      render: (row) => {
        const formatted = formatUSPhone(row.primary_phone);
        if (!formatted) return "—";
        return (
          <a
            href={`tel:${digitsOnly(String(row.primary_phone ?? ""))}`}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex max-w-full items-center gap-1 truncate hover:underline"
          >
            <Phone className="size-3 shrink-0" />
            <span className="truncate">{formatted}</span>
          </a>
        );
      },
    },
    {
      key: "primary_email",
      header: "Email",
      sortable: true,
      searchable: true,
      width: "w-[16%]",
      render: (row) =>
        row.primary_email ? (
          <a
            href={`mailto:${row.primary_email}`}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex max-w-full items-center gap-1 truncate hover:underline"
          >
            <Mail className="size-3 shrink-0" />
            <span className="truncate">{row.primary_email}</span>
          </a>
        ) : (
          <span>—</span>
        ),
    },
    {
      key: "created_at",
      header: "Submitted",
      sortable: true,
      width: "w-[7%]",
      accessor: (row) => row.created_at ?? 0,
      render: (row) => (
        <span
          className="block truncate"
          title={
            row.created_at
              ? new Date(row.created_at).toLocaleString()
              : undefined
          }
        >
          {formatRelativeCompact(row.created_at)}
        </span>
      ),
    },
    {
      // Single toggle action so both sections keep identical columns:
      // attending rows get an X ("mark not attending"), archived rows
      // get an undo ("mark attending"). Block-level flex wrapper so
      // the cell's truncate can't paint stray ellipsis dots.
      key: "attendance",
      header: "",
      width: "w-[48px]",
      align: "right",
      render: (row) => (
        <div
          onClick={(e) => e.stopPropagation()}
          className="flex items-center justify-end"
        >
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(
              "size-7 text-muted-foreground",
              row.isNotAttending
                ? "hover:text-green-700 hover:bg-green-50"
                : "hover:text-red-600 hover:bg-red-50"
            )}
            disabled={savingId === row.id}
            onClick={() => void setAttendance(row, !row.isNotAttending)}
            aria-label={
              row.isNotAttending
                ? `Mark ${row.student_name || "student"} attending`
                : `Mark ${row.student_name || "student"} not attending`
            }
            title={
              row.isNotAttending ? "Mark attending" : "Mark not attending"
            }
          >
            {savingId === row.id ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : row.isNotAttending ? (
              <Undo2 className="size-3.5" />
            ) : (
              <X className="size-3.5" />
            )}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Summer Camp</h1>
          <p className="text-sm text-muted-foreground">
            Summer camp registrations. Click a row to see the full student
            detail — health notes, transportation, and parent contact. Use
            ✕ to mark a student not attending (undo from the archived
            section).
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="shrink-0 bg-white"
          disabled={exporting || rows.length === 0}
          onClick={() => void handleExport()}
        >
          {exporting ? (
            <Loader2 className="size-4 mr-1.5 animate-spin" />
          ) : (
            <Download className="size-4 mr-1.5" />
          )}
          Export XLSX
        </Button>
      </div>

      {error ? (
        <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
          Failed to load summer camp registrations:{" "}
          {error instanceof Error ? error.message : "unknown error"}
        </div>
      ) : null}

      <div className="space-y-8">
        <SummerCampGroup
          title="Attending"
          description="Registered and expected at camp."
          dotColor="bg-green-500"
          rows={groups.attending}
          isLoading={isLoading}
          error={error}
          columns={columns}
          onRowClick={(row) => setActive(row)}
        />
        <SummerCampGroup
          title="Not Attending"
          description="Archived — family isn't attending camp."
          dotColor="bg-gray-400"
          rows={groups.notAttending}
          isLoading={isLoading}
          error={error}
          columns={columns}
          onRowClick={(row) => setActive(row)}
        />
      </div>

      <Sheet
        open={active !== null}
        onOpenChange={(open) => {
          if (!open) setActive(null);
        }}
      >
        <SheetContent className="w-full sm:max-w-xl flex flex-col p-0 gap-0">
          {active ? (
            <>
              <SheetHeader className="border-b px-6 py-4">
                <SheetTitle className="flex flex-wrap items-center gap-2">
                  {active.student_name || "Summer camp registration"}
                  {active.isNotAttending ? (
                    <Badge variant="secondary" className="font-normal">
                      Not attending
                    </Badge>
                  ) : null}
                  {active.carry_epi_pen ? (
                    // Epi-pen carriers get a loud badge up top — this
                    // is the one health fact staff must never miss.
                    <Badge className="bg-red-100 text-red-700 border-red-200 font-medium">
                      Carries EpiPen
                    </Badge>
                  ) : null}
                </SheetTitle>
                <SheetDescription>
                  Submitted {new Date(active.created_at).toLocaleString()}
                </SheetDescription>
              </SheetHeader>
              <div className="flex-1 overflow-y-auto overscroll-contain px-6 py-5 space-y-6">
                <SectionLabel>Student</SectionLabel>
                <div className="grid grid-cols-2 gap-5">
                  <DetailRow label="Gender">{active.gender || "—"}</DetailRow>
                  <DetailRow label="Ethnicity">
                    {active.ethnicity || "—"}
                  </DetailRow>
                  <DetailRow label="Last grade completed">
                    {active.last_grade_completed || "—"}
                  </DetailRow>
                  <DetailRow label="Current school">
                    {active.current_school || "—"}
                  </DetailRow>
                  <DetailRow label="Swim level">
                    {active.swim_level || "—"}
                  </DetailRow>
                </div>
                <DetailRow label="About the student">
                  {active.describe_your_student_and_behavior ? (
                    <p className="whitespace-pre-wrap">
                      {active.describe_your_student_and_behavior}
                    </p>
                  ) : (
                    "—"
                  )}
                </DetailRow>

                <SectionLabel>Logistics</SectionLabel>
                <div className="grid grid-cols-2 gap-5">
                  <DetailRow label="Transportation">
                    {active.transportation || "—"}
                  </DetailRow>
                  <DetailRow label="Bus stop">
                    {active.bus_stop || "—"}
                  </DetailRow>
                  <DetailRow label="Preferred hospital">
                    {active.preferred_hospital || "—"}
                  </DetailRow>
                  <DetailRow label="Carries EpiPen">
                    {active.carry_epi_pen ? "Yes" : "No"}
                  </DetailRow>
                </div>

                <SectionLabel>Health</SectionLabel>
                <div className="grid grid-cols-2 gap-5">
                  <DetailRow label="Allergies">
                    {active.allergies || "—"}
                  </DetailRow>
                  <DetailRow label="Dietary restrictions">
                    {active.dietary_restrictions || "—"}
                  </DetailRow>
                  <DetailRow label="Health conditions">
                    {active.health_conditions || "—"}
                  </DetailRow>
                  <DetailRow label="Hearing / visual impairments">
                    {active.hearing_or_visual_impairments || "—"}
                  </DetailRow>
                </div>
                <DetailRow label="Additional health information">
                  {active.additional_health_information ? (
                    <p className="whitespace-pre-wrap">
                      {active.additional_health_information}
                    </p>
                  ) : (
                    "—"
                  )}
                </DetailRow>

                <SectionLabel>Parent</SectionLabel>
                <div className="grid grid-cols-2 gap-5">
                  <DetailRow label="Name">
                    {active.parent_name || "—"}
                  </DetailRow>
                  <DetailRow label="Relationship">
                    {active.primary_parent_relationship || "—"}
                  </DetailRow>
                  <DetailRow label="Phone">
                    {formatUSPhone(active.primary_phone) ? (
                      <a
                        href={`tel:${digitsOnly(String(active.primary_phone ?? ""))}`}
                        className="text-primary underline-offset-2 hover:underline"
                      >
                        {formatUSPhone(active.primary_phone)}
                      </a>
                    ) : (
                      "—"
                    )}
                  </DetailRow>
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
                </div>
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function SummerCampGroup({
  title,
  description,
  rows,
  isLoading,
  error,
  columns,
  dotColor,
  onRowClick,
}: {
  title: string;
  description: string;
  rows: SummerCampRow[];
  isLoading: boolean;
  error: unknown;
  columns: ColumnDef<SummerCampRow>[];
  dotColor: string;
  onRowClick: (row: SummerCampRow) => void;
}) {
  if (!isLoading && !error && rows.length === 0) return null;
  return (
    <Card className="overflow-hidden bg-white py-0 gap-0">
      <CardHeader className="py-4 border-b bg-white">
        <div className="flex items-baseline gap-3">
          <span
            className={cn(
              "size-2.5 shrink-0 self-center rounded-full",
              dotColor
            )}
            aria-hidden
          />
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            {title}
          </CardTitle>
          <span className="text-xs tabular-nums text-muted-foreground">
            ({rows.length})
          </span>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </CardHeader>
      <CardContent className="p-4 bg-white">
        <DataTable<SummerCampRow>
          columns={columns}
          data={rows}
          isLoading={isLoading}
          // Camp roster is small (~40 rows) — show everything in one
          // scroll instead of paginating.
          pageSize={1000}
          searchPlaceholder={`Search ${title.toLowerCase()}…`}
          onRowClick={onRowClick}
        />
      </CardContent>
    </Card>
  );
}

/** Tiny section heading inside the sheet — groups the detail rows so
 *  staff can jump straight to Health when they need it. */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="border-b pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </p>
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

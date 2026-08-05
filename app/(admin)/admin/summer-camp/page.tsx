"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Bus, Car, Download, Loader2, Mail, Phone, Undo2, X } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { LeadSheet } from "@/components/admin/lead-sheet";
import { StarRating } from "@/components/admin/star-rating";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { adminFetcher } from "@/lib/admin-fetcher";
import { sortYearsOldestFirst } from "@/lib/school-years";
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
/** School-year row as the camp-year picker needs it. */
interface SchoolYearOption {
  id: number;
  year_name: string;
  isActive?: boolean;
  isNextYear?: boolean;
}

/** The camp-attended FK, coerced whether Xano hands back a raw id or
 *  an expanded relation object. 0 = not recorded. */
function campYearOf(row: { summer_camp_year_attended?: unknown }): number {
  const v = row.summer_camp_year_attended;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") return Number(v) || 0;
  if (v && typeof v === "object") {
    const id = (v as { id?: unknown }).id;
    return typeof id === "number" ? id : Number(id) || 0;
  }
  return 0;
}

interface SummerCampRow {
  id: number;
  created_at: number;
  isNotAttending: boolean;
  /** Admin flag — student actually showed up to camp. Optional
   *  because legacy rows predate the column. */
  attended_camp?: boolean;
  /** Which camp they attended, as an FK to `registration_school_years`
   *  (0/undefined = not recorded). Camp runs in June/July, inside the
   *  school year ending that summer. */
  summer_camp_year_attended?: number | null;
  /** Admin's 1–5 conversion stars; 0/undefined = unrated. */
  interest_level?: number | null;
  /** Admin's "we've reached out" flag. */
  isFollowedUp?: boolean;
  /** Server-stamped time of the most recent note. */
  last_reach_out?: number | null;
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
  const { data: yearData } = useSWR<SchoolYearOption[]>(
    "/api/admin/school-years",
    adminFetcher,
    { revalidateOnFocus: false }
  );
  const schoolYears = useMemo(
    () => sortYearsOldestFirst(Array.isArray(yearData) ? yearData : []),
    [yearData]
  );
  const yearNameOf = (row: SummerCampRow) =>
    schoolYears.find((y) => y.id === campYearOf(row))?.year_name ?? "";
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

  // Flip the attended-camp flag with the same optimistic-mutate shape
  // as the attendance toggle. Separate pending id so both controls on
  // one row can't wedge each other's spinner.
  const [attendSavingId, setAttendSavingId] = useState<number | null>(null);
  /** Record WHICH camp the student attended. Routed through the
   *  shared `/api/admin/leads` endpoint so the same echo check covers
   *  it as every other lead write — the camp-only PATCH route has no
   *  such verification. */
  async function setCampYear(row: SummerCampRow, yearId: number) {
    try {
      mutate(
        (curr) =>
          (curr ?? []).map((r) =>
            r.id === row.id
              ? { ...r, summer_camp_year_attended: yearId }
              : r
          ),
        { revalidate: false }
      );
      setActive((curr) =>
        curr && curr.id === row.id
          ? { ...curr, summer_camp_year_attended: yearId }
          : curr
      );
      const res = await fetch("/api/admin/leads", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "camp",
          id: row.id,
          camp_year_attended: yearId,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? `Save failed (${res.status})`);
      if (data?.warning) toast.warning(data.warning);
      mutate();
    } catch (err) {
      console.error("[SummerCamp.setCampYear]", err);
      toast.error(
        err instanceof Error ? err.message : "Couldn't save the camp year."
      );
      mutate();
    }
  }

  async function setAttendedCamp(row: SummerCampRow, attended: boolean) {
    setAttendSavingId(row.id);
    try {
      mutate(
        (curr) =>
          (curr ?? []).map((r) =>
            r.id === row.id ? { ...r, attended_camp: attended } : r
          ),
        { revalidate: false }
      );
      setActive((curr) =>
        curr && curr.id === row.id
          ? { ...curr, attended_camp: attended }
          : curr
      );
      const res = await fetch(`/api/admin/summer-camp/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attended_camp: attended }),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      mutate();
    } catch (err) {
      console.error("Failed to update attended-camp flag:", err);
      toast.error("Couldn't update the attended flag.");
      mutate();
    } finally {
      setAttendSavingId(null);
    }
  }

  // Inline star write — same endpoint every lead surface uses.
  async function setRating(row: SummerCampRow, rating: number) {
    try {
      mutate(
        (curr) =>
          (curr ?? []).map((r) =>
            r.id === row.id ? { ...r, interest_level: rating } : r
          ),
        { revalidate: false }
      );
      setActive((curr) =>
        curr && curr.id === row.id
          ? { ...curr, interest_level: rating }
          : curr
      );
      const res = await fetch("/api/admin/leads", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "camp",
          id: row.id,
          interest_level: rating,
        }),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      mutate();
    } catch (err) {
      console.error("Failed to save camp rating:", err);
      toast.error("Couldn't save the rating.");
      mutate();
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
      key: "interest_level",
      header: "Rating",
      sortable: true,
      width: "w-[10%]",
      accessor: (row) => row.interest_level ?? 0,
      render: (row) => (
        <StarRating
          value={row.interest_level ?? 0}
          onChange={(v) => void setRating(row, v)}
        />
      ),
    },
    {
      key: "student_name",
      header: "Student",
      sortable: true,
      searchable: true,
      width: "w-[12%]",
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
      // WHICH camp they attended. Sits beside the Attended checkbox
      // because the two are one thought: the box says it happened,
      // this says which summer. Editable in the row — recording camp
      // history is bulk work.
      key: "summer_camp_year_attended",
      header: "Camp year",
      sortable: true,
      width: "w-[10%]",
      accessor: (row) => yearNameOf(row),
      render: (row) => (
        <span onClick={(e) => e.stopPropagation()}>
          <Select
            value={campYearOf(row) > 0 ? String(campYearOf(row)) : "0"}
            onValueChange={(v) => void setCampYear(row, Number(v))}
          >
            <SelectTrigger
              size="sm"
              className={cn(
                "h-7 w-full border-transparent bg-transparent px-1.5 text-xs shadow-none hover:border-input hover:bg-white",
                !campYearOf(row) && "text-muted-foreground"
              )}
            >
              <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">—</SelectItem>
              {schoolYears.map((y) => (
                <SelectItem key={y.id} value={String(y.id)}>
                  {y.year_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </span>
      ),
    },
    {
      // Admin checkbox — did the student actually show up to camp?
      // Writes `attended_camp`; sortable so attendees group together.
      key: "attended_camp",
      header: "Attended",
      sortable: true,
      width: "w-[8%]",
      accessor: (row) => (row.attended_camp ? 1 : 0),
      render: (row) => (
        <div
          onClick={(e) => e.stopPropagation()}
          className="flex items-center"
        >
          {attendSavingId === row.id ? (
            <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
          ) : (
            <Checkbox
              checked={row.attended_camp === true}
              onCheckedChange={(v) =>
                void setAttendedCamp(row, v === true)
              }
              aria-label={`${row.student_name || "Student"} attended camp`}
            />
          )}
        </div>
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
      key: "isFollowedUp",
      header: "Follow-up",
      sortable: true,
      width: "w-[9%]",
      accessor: (row) => (row.isFollowedUp ? 1 : 0),
      render: (row) =>
        row.isFollowedUp ? (
          <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
            Followed up
          </Badge>
        ) : (
          <span
            className="text-xs text-muted-foreground"
            title={
              row.last_reach_out
                ? `Last contacted ${new Date(row.last_reach_out).toLocaleString()}`
                : undefined
            }
          >
            {row.last_reach_out
              ? formatRelativeCompact(row.last_reach_out)
              : "Needs"}
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

      {/* Detail sheet — the shared one every recruitment surface
          opens, so a camp registration reads identically here and on
          All Leads. Camp's own record (health, logistics, swim level)
          rides along as extra fields; the attendance and EpiPen flags
          stay pinned beside the title where staff can't miss them. */}
      <LeadSheet
        lead={active ? { source: "camp", id: active.id } : null}
        onOpenChange={(o) => !o && setActive(null)}
        headerBadges={
          active ? (
            <>
              {active.isNotAttending ? (
                <Badge variant="secondary" className="font-normal">
                  Not attending
                </Badge>
              ) : null}
              {active.attended_camp ? (
                <Badge className="bg-green-100 text-green-800 border-green-200 font-medium">
                  Attended camp
                </Badge>
              ) : null}
              {active.carry_epi_pen ? (
                <Badge className="bg-red-100 text-red-700 border-red-200 font-medium">
                  Carries EpiPen
                </Badge>
              ) : null}
            </>
          ) : null
        }
        extraFields={
          active
            ? [
                {
                  label: "Camp attended",
                  value: active.attended_camp
                    ? yearNameOf(active) || "Yes (year not recorded)"
                    : "",
                },
                { label: "Gender", value: active.gender ?? "" },
                { label: "Ethnicity", value: active.ethnicity ?? "" },
                { label: "Swim level", value: active.swim_level ?? "" },
                { label: "Relationship", value: active.primary_parent_relationship ?? "" },
                { label: "Transportation", value: active.transportation ?? "" },
                { label: "Bus stop", value: active.bus_stop ?? "" },
                { label: "Preferred hospital", value: active.preferred_hospital ?? "" },
                { label: "Carries EpiPen", value: active.carry_epi_pen ? "Yes" : "" },
                { label: "Allergies", value: active.allergies ?? "" },
                { label: "Dietary restrictions", value: active.dietary_restrictions ?? "" },
                { label: "Health conditions", value: active.health_conditions ?? "" },
                {
                  label: "Hearing / visual impairments",
                  value: active.hearing_or_visual_impairments ?? "",
                },
                {
                  label: "Additional health information",
                  value: active.additional_health_information ?? "",
                },
                {
                  label: "About the student",
                  value: active.describe_your_student_and_behavior ?? "",
                },
              ]
            : undefined
        }
        onChanged={() => void mutate()}
      />
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


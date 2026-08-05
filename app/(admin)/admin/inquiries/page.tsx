"use client";

import { useMemo, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { toast } from "sonner";
import { Check, Loader2, Trash2, Undo2, UserX, X } from "lucide-react";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { LeadSheet } from "@/components/admin/lead-sheet";
import { StarRating } from "@/components/admin/star-rating";
import { adminFetcher } from "@/lib/admin-fetcher";
import { sortYearsOldestFirst } from "@/lib/school-years";
import { cn } from "@/lib/utils";

/**
 * Real shape of `/api/admin/inquiries` rows. Mirrors `registration_inquiry`
 * in Xano. `parent_name` / `student_name` are computed here so the
 * DataTable's sort/search can hit a flat string instead of two separate
 * name fields.
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
  isFollowedUp?: boolean;
  /** Server-managed timestamp of the most recent note added — bumped
   *  by the notes POST endpoint when admin logs a communication. */
  last_reach_out?: number | null;
  /** Body of the most recent note logged on this inquiry, computed by
   *  the admin inquiries API route (not a Xano column). Rendered as a
   *  truncated one-line preview in the "Last note" column; null when
   *  no note has been logged yet. */
  last_note?: string | null;
  /** Creation timestamp of that most-recent note — drives the "Last
   *  note" column's sort (by recency) even though the cell shows the
   *  body text. */
  last_note_at?: number | null;
  /** Lifecycle bucket. ""/undefined/"active" = active pipeline;
   *  "not_interested" = family declined and the row moves to its own
   *  section off the default view. "active" (not "") is what restore
   *  writes because Xano's edit endpoint ignores empty inputs. */
  status?: string | null;
  /** Why the family declined — set alongside `status`, shown as the
   *  Reason column in the Not Interested section. May hold a stale
   *  value on restored rows (see restoreInquiry); only rendered when
   *  status === "not_interested". */
  status_reason?: string | null;
  /** 1–5 star gut-feel interest rating; 0/undefined = not rated.
   *  Clicking the current rating clears back to 0. */
  interest_level?: number | null;
  /** Academic year this family is asking about — a hand-assigned FK
   *  to `registration_school_years`; 0/undefined = not set (never
   *  guessed from the submission date). */
  registration_school_years_id?: number | null;
  /** Computed by the admin inquiries API route (not a Xano column):
   *  true when this inquiry's email matches a registered parent
   *  account. Rendered as an "applied?" hint badge — suggestion only;
   *  admin confirms by marking the inquiry converted. */
  hasParentAccount?: boolean;
  // Computed at parse time
  parent_name: string;
  student_name: string;
  [key: string]: unknown;
}

/**
 * Render a fully relative-time string. Default style is verbose
 * ("3 days ago", "2 weeks ago") for the detail Sheet; `compact`
 * yields dense table-cell forms ("3d", "2w", "5mo", "now"). Stays
 * relative all the way up rather than falling back to a locale date.
 * Inline because the table doesn't need a full date library — the
 * buckets are approximate (30-day months, 365-day years), which is
 * fine for triage.
 */
function formatRelative(
  ts: number | null | undefined,
  opts?: { compact?: boolean }
): string {
  if (!ts) return "—";
  const compact = opts?.compact ?? false;
  const diff = Date.now() - ts;
  if (diff < 60_000) return compact ? "now" : "just now";
  const MIN = 60_000;
  const HOUR = 3_600_000;
  const DAY = 86_400_000;
  const WEEK = 7 * DAY;
  const MONTH = 30 * DAY;
  const YEAR = 365 * DAY;
  const unit = (n: number, label: string, short: string) =>
    compact ? `${n}${short}` : `${n} ${label}${n === 1 ? "" : "s"} ago`;
  if (diff < HOUR) return unit(Math.floor(diff / MIN), "min", "m");
  if (diff < DAY) return unit(Math.floor(diff / HOUR), "hour", "h");
  if (diff < WEEK) return unit(Math.floor(diff / DAY), "day", "d");
  if (diff < MONTH) return unit(Math.floor(diff / WEEK), "week", "w");
  if (diff < YEAR) return unit(Math.floor(diff / MONTH), "month", "mo");
  return unit(Math.floor(diff / YEAR), "year", "y");
}

/** The inquiry's hand-assigned year FK, coerced whether Xano returns
 *  a raw id or an expanded relation object. 0 = not set. */
function yearIdOf(row: { registration_school_years_id?: unknown }): number {
  const v = row.registration_school_years_id;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") return Number(v) || 0;
  if (v && typeof v === "object") {
    const id = (v as { id?: unknown }).id;
    return typeof id === "number" ? id : Number(id) || 0;
  }
  return 0;
}

/** School-year row as the year filter + inline picker need it. */
interface SchoolYearOption {
  id: number;
  year_name: string;
  isActive?: boolean;
  isNextYear?: boolean;
}

/** When this inquiry was last contacted. `last_reach_out` is stamped
 *  server-side by the notes endpoint; rows predating that fall back
 *  to their newest note. 0 = never contacted. Same resolution the
 *  All Leads feed uses, so the two surfaces agree. */
function lastContactAt(row: {
  last_reach_out?: number | null;
  last_note_at?: number | null;
}): number {
  return Number(row.last_reach_out) || Number(row.last_note_at) || 0;
}

type InquiryFilter =
  | "all"
  | "not_followed_up"
  | "followed_up"
  | "converted"
  | "not_interested";

const FILTER_LABEL: Record<InquiryFilter, string> = {
  // "All" shows every section — the working pipeline, the Converted
  // wins, and declined families in their own section at the bottom —
  // so admin can find and restore a not-interested row without
  // switching filters. The dedicated "Not interested" option below
  // still isolates just those rows.
  all: "All",
  not_followed_up: "Not followed up",
  followed_up: "Followed up",
  converted: "Converted",
  not_interested: "Not interested",
};

/**
 * Preset reasons for the "mark not interested" dialog. Stored verbatim
 * into `status_reason` (a plain string column in Xano) so reporting can
 * group on the exact label. "Other" swaps in a free-text input.
 */
const NOT_INTERESTED_REASONS = [
  "Tuition / cost",
  "Chose another school",
  "Distance / transportation",
  "Program not the right fit",
  "Timing — may apply later",
  "Stopped responding",
  "Other",
] as const;

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
  const { data, isLoading, error, mutate } = useSWR<Inquiry[]>(
    "/api/admin/inquiries",
    adminFetcher
  );
  const { mutate: globalMutate } = useSWRConfig();
  const [active, setActive] = useState<Inquiry | null>(null);
  // null = any year; 0 = only the untagged ones (the working bucket).
  const [yearFilter, setYearFilter] = useState<number | null>(null);
  const { data: yearData } = useSWR<SchoolYearOption[]>(
    "/api/admin/school-years",
    adminFetcher,
    { revalidateOnFocus: false }
  );
  const schoolYears = useMemo(
    () => sortYearsOldestFirst(Array.isArray(yearData) ? yearData : []),
    [yearData]
  );

  const [filter, setFilter] = useState<InquiryFilter>("all");
  // Per-row pending state so the toggle UI is responsive while the
  // PATCH is in flight. We optimistically mutate the SWR cache, then
  // revert if the server says no.
  const [savingId, setSavingId] = useState<number | null>(null);
  // Row queued for deletion — drives the AlertDialog. `null` means the
  // dialog is closed. We carry the whole row so the modal can render
  // the parent / student name in its confirmation copy.
  const [pendingDelete, setPendingDelete] = useState<Inquiry | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Row queued for the "mark not interested" dialog, plus the reason
  // picker's state. `reasonChoice` holds the preset label; when it's
  // "Other" the free-text `customReason` becomes the stored reason.
  const [markingRow, setMarkingRow] = useState<Inquiry | null>(null);
  const [reasonChoice, setReasonChoice] = useState<string>("");
  const [customReason, setCustomReason] = useState("");

  const rows: Inquiry[] = useMemo(
    () =>
      (Array.isArray(data) ? data : [])
        .map((r) => ({
          ...r,
          primary_email: cleanEmail(r.primary_email),
          parent_name: `${r.primary_first_name ?? ""} ${
            r.primary_last_name ?? ""
          }`.trim(),
          student_name: `${r.student_first_name ?? ""} ${
            r.student_last_name ?? ""
          }`.trim(),
        }))
        .sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0)),
    [data]
  );

  const groups = useMemo(() => {
    const followedUp: Inquiry[] = [];
    const notFollowedUp: Inquiry[] = [];
    const converted: Inquiry[] = [];
    const notInterested: Inquiry[] = [];
    // 0 selects the still-untagged inquiries — the bucket to work
    // through, since the year is only ever set by hand.
    const yearMatched =
      yearFilter === null
        ? rows
        : rows.filter((r) => yearIdOf(r) === yearFilter);
    for (const r of yearMatched) {
      // Terminal statuses win over the follow-up split — a converted
      // or declined family leaves the working pipeline regardless of
      // whether we had already reached out.
      if (r.status === "not_interested") notInterested.push(r);
      else if (r.status === "converted") converted.push(r);
      else if (r.isFollowedUp) followedUp.push(r);
      else notFollowedUp.push(r);
    }
    // Order every section by MOST RECENT ACTIVITY — the later of the
    // last contact and the sign-up date — so conversations in flight
    // and brand-new inquiries both sit at the top. Sorting on last
    // contact alone would bury every inquiry nobody has called yet
    // (their `last_reach_out` is 0) below the handful that have been.
    // Same rule All Leads uses. The Last contact and Added headers
    // still re-sort on either column alone.
    const activity = (r: Inquiry) =>
      Math.max(lastContactAt(r), Number(r.created_at) || 0);
    for (const list of [followedUp, notFollowedUp, converted, notInterested]) {
      list.sort(
        (a, b) =>
          activity(b) - activity(a) ||
          (Number(b.created_at) || 0) - (Number(a.created_at) || 0)
      );
    }
    return { followedUp, notFollowedUp, converted, notInterested };
  }, [rows, yearFilter]);

  const visibleGroups = useMemo(() => {
    if (filter === "all") {
      // Default view shows every section, declined families included —
      // they render in their own section at the bottom so admin can
      // spot and restore them without switching filters.
      return groups;
    }
    return {
      followedUp: filter === "followed_up" ? groups.followedUp : [],
      notFollowedUp: filter === "not_followed_up" ? groups.notFollowedUp : [],
      converted: filter === "converted" ? groups.converted : [],
      notInterested: filter === "not_interested" ? groups.notInterested : [],
    };
  }, [filter, groups]);

  const counts = useMemo(
    () =>
      ({
        all:
          groups.followedUp.length +
          groups.notFollowedUp.length +
          groups.converted.length +
          groups.notInterested.length,
        followed_up: groups.followedUp.length,
        not_followed_up: groups.notFollowedUp.length,
        converted: groups.converted.length,
        not_interested: groups.notInterested.length,
      }) satisfies Record<InquiryFilter, number>,
    [groups]
  );

  // Hard-delete the inquiry row. Optimistically removes it from the
  // SWR cache so the table updates immediately; reverts via re-fetch
  // if the DELETE fails. Closes the modal + clears pending state in
  // both branches so admin isn't stuck on a hanging confirmation.
  async function confirmDelete() {
    if (!pendingDelete || deleting) return;
    const targetId = pendingDelete.id;
    const targetName =
      pendingDelete.parent_name || pendingDelete.student_name || `#${targetId}`;
    setDeleting(true);
    mutate(
      (curr) => (curr ?? []).filter((r) => r.id !== targetId),
      { revalidate: false }
    );
    try {
      const res = await fetch(`/api/admin/inquiries/${targetId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Delete failed (${res.status})`);
      }
      toast.success(`Inquiry from ${targetName} removed.`);
      // If admin had the detail sheet open on this row, close it.
      if (active?.id === targetId) setActive(null);
      // Revalidate so any server-side audit trail / counts re-sync.
      globalMutate("/api/admin/inquiries");
    } catch (err) {
      console.error("Failed to delete inquiry:", err);
      toast.error(
        err instanceof Error ? err.message : "Couldn't delete inquiry."
      );
      // Revert the optimistic remove by re-fetching the canonical list.
      mutate();
    } finally {
      setDeleting(false);
      setPendingDelete(null);
    }
  }

  // Toggle the follow-up flag with an optimistic SWR mutate so the row
  // jumps between sections immediately. Reverts on failure.
  async function toggleFollowedUp(row: Inquiry, next: boolean) {
    setSavingId(row.id);
    const optimistic = (curr: Inquiry[] | undefined) =>
      (curr ?? []).map((r) =>
        r.id === row.id ? { ...r, isFollowedUp: next } : r
      );
    try {
      mutate(optimistic, { revalidate: false });
      const res = await fetch(`/api/admin/inquiries/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isFollowedUp: next }),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      // Refresh from the server to pick up server-set timestamps.
      globalMutate("/api/admin/inquiries");
    } catch (err) {
      console.error("Failed to toggle isFollowedUp:", err);
      // Revert by re-fetching authoritative data.
      mutate();
    } finally {
      setSavingId(null);
    }
  }

  // Patch the inquiry's status fields with an optimistic mutate so the
  // row moves between sections immediately. Only the keys present in
  // `patch` are sent: Xano's edit endpoint ignores empty-string/null
  // inputs (its field mapping is conditional on "not empty"), so a
  // status can never be cleared back to "" — "active" is the sentinel
  // for leaving the not-interested bucket. Returns whether the save
  // landed so callers can gate their success toast.
  async function updateStatus(
    row: Inquiry,
    patch: { status: string; status_reason?: string }
  ): Promise<boolean> {
    setSavingId(row.id);
    const optimistic = (curr: Inquiry[] | undefined) =>
      (curr ?? []).map((r) => (r.id === row.id ? { ...r, ...patch } : r));
    try {
      mutate(optimistic, { revalidate: false });
      // The Sheet keeps its own snapshot of the row — patch it too so
      // the status section reflects the change while it's open.
      setActive((curr) =>
        curr && curr.id === row.id ? { ...curr, ...patch } : curr
      );
      const res = await fetch(`/api/admin/inquiries/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      globalMutate("/api/admin/inquiries");
      return true;
    } catch (err) {
      console.error("Failed to update inquiry status:", err);
      toast.error("Couldn't update inquiry status.");
      // Revert by re-fetching authoritative data.
      mutate();
      return false;
    } finally {
      setSavingId(null);
    }
  }

  // Set (or clear) the 0–5 interest rating with an optimistic mutate
  // so the stars fill in immediately. Clicking the current rating
  // again clears it to 0 — verified that the Xano edit endpoint
  // applies integer 0 (only empty strings / null get dropped).
  /** Assign the academic year from the row. Routed through the shared
   *  `/api/admin/leads` endpoint (not the inquiry-only PATCH) so the
   *  same echo verification covers it as every other lead write. */
  async function setYear(row: Inquiry, yearId: number) {
    try {
      mutate(
        (curr) =>
          (curr ?? []).map((r) =>
            r.id === row.id
              ? { ...r, registration_school_years_id: yearId }
              : r
          ),
        { revalidate: false }
      );
      const res = await fetch("/api/admin/leads", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "inquiry",
          id: row.id,
          school_year_id: yearId,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? `Save failed (${res.status})`);
      if (data?.warning) toast.warning(data.warning);
      mutate();
    } catch (err) {
      console.error("[Inquiries.setYear]", err);
      toast.error(
        err instanceof Error ? err.message : "Couldn't save the year."
      );
      mutate();
    }
  }

  async function updateInterest(row: Inquiry, level: number) {
    setSavingId(row.id);
    const optimistic = (curr: Inquiry[] | undefined) =>
      (curr ?? []).map((r) =>
        r.id === row.id ? { ...r, interest_level: level } : r
      );
    try {
      mutate(optimistic, { revalidate: false });
      // Keep the Sheet's snapshot in sync if it's open on this row.
      setActive((curr) =>
        curr && curr.id === row.id
          ? { ...curr, interest_level: level }
          : curr
      );
      const res = await fetch(`/api/admin/inquiries/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interest_level: level }),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      globalMutate("/api/admin/inquiries");
    } catch (err) {
      console.error("Failed to save interest rating:", err);
      toast.error("Couldn't save interest rating.");
      // Revert by re-fetching authoritative data.
      mutate();
    } finally {
      setSavingId(null);
    }
  }

  // Reset the reason picker every open — stale selections from the
  // last family shouldn't leak into a new one.
  function openNotInterestedDialog(row: Inquiry) {
    setReasonChoice("");
    setCustomReason("");
    setMarkingRow(row);
  }

  async function confirmNotInterested() {
    if (!markingRow) return;
    const reason =
      reasonChoice === "Other" ? customReason.trim() : reasonChoice;
    if (!reason) return;
    const row = markingRow;
    setMarkingRow(null);
    const ok = await updateStatus(row, {
      status: "not_interested",
      status_reason: reason,
    });
    if (ok) {
      toast.success(
        `${row.parent_name || "Inquiry"} moved to Not Interested.`
      );
    }
  }

  async function restoreInquiry(row: Inquiry) {
    // "active" sentinel, not "" — Xano's edit endpoint drops empty
    // inputs, so an empty status would never save. The old
    // status_reason intentionally stays on the row as history; nothing
    // renders it while the inquiry is active, and re-marking forces a
    // fresh reason that overwrites it.
    const ok = await updateStatus(row, { status: "active" });
    if (ok) {
      toast.success(`${row.parent_name || "Inquiry"} restored to active.`);
    }
  }

  // One-click win: the family applied, so the inquiry graduates into
  // the Converted section. No dialog — unlike "not interested" there's
  // no reason to capture, and it's reversible via restore.
  async function markConverted(row: Inquiry) {
    const ok = await updateStatus(row, { status: "converted" });
    if (ok) {
      toast.success(`${row.parent_name || "Inquiry"} marked as converted.`);
    }
  }

  // Shared column definitions across all sections — same widths so
  // headers line up vertically the same way the Applications page does.
  // The active / not-interested sections append their own status +
  // action columns below.
  const baseColumns: ColumnDef<Inquiry>[] = [
    {
      key: "parent_name",
      header: "Parent",
      sortable: true,
      searchable: true,
      width: "w-[16%]",
      // Accessor carries the contact info: email + phone left the
      // table (see below) but must stay searchable. Sorting still
      // orders by parent name — it's the string's prefix.
      accessor: (row) =>
        `${row.parent_name ?? ""} ${row.primary_email ?? ""} ${row.primary_phone ?? ""}`,
      // The "likely applied" auto-suggest hint is now a blue row tint
      // (see rowTint) rather than a per-cell icon.
      render: (row) => (
        <span className="block truncate font-medium">
          {row.parent_name || "—"}
        </span>
      ),
    },
    {
      key: "student_name",
      header: "Student",
      sortable: true,
      searchable: true,
      width: "w-[16%]",
      render: (row) => (
        <span className="block truncate font-medium">
          {row.student_name || "—"}
        </span>
      ),
    },
    {
      key: "current_grade",
      header: "Grade",
      sortable: true,
      width: "w-[7%]",
      render: (row) => (
        <span className="block truncate">
          {row.current_grade || "—"}
          {row.starting_grade && row.starting_grade !== row.current_grade
            ? ` → ${row.starting_grade}`
            : ""}
        </span>
      ),
    },
    // Email + phone are deliberately NOT columns: they crowded the
    // table and are one click away in the row's sheet, which also
    // offers call / mail / copy actions. Both stay searchable via the
    // Parent column's accessor above.
    {
      key: "hear_about_us",
      header: "Source",
      width: "w-[12%]",
      render: (row) => (
        <span className="block truncate" title={row.hear_about_us || undefined}>
          {row.hear_about_us || "—"}
        </span>
      ),
    },
    {
      // When the inquiry was submitted, as relative time ("3 days
      // ago"). Sorted on the raw timestamp via `accessor` so the
      // string label doesn't drive ordering — otherwise "2 days ago"
      // would sort after "2 weeks ago" alphabetically. The list is
      // already pre-sorted newest-first, and this column lets admin
      // re-sort oldest-first with a click.
      key: "created_at",
      header: "Added",
      sortable: true,
      width: "w-[7%]",
      accessor: (row) => row.created_at ?? 0,
      render: (row) => (
        <span
          className="block truncate"
          // Compact form ("2w") saves column width; the exact
          // submission datetime is one hover away.
          title={
            row.created_at
              ? new Date(row.created_at).toLocaleString()
              : undefined
          }
        >
          {formatRelative(row.created_at, { compact: true })}
        </span>
      ),
    },
    {
      // When we last actually spoke to this family. Relative, like
      // Added, because "3d" is what triage needs — the exact datetime
      // is one hover away. Falls back to the newest note's timestamp
      // for rows written before `last_reach_out` was server-stamped,
      // matching how the All Leads feed resolves it.
      key: "last_reach_out",
      header: "Last contact",
      sortable: true,
      width: "w-[8%]",
      accessor: (row) => lastContactAt(row),
      render: (row) => {
        const ts = lastContactAt(row);
        return (
          <span
            className="block truncate text-muted-foreground"
            title={ts ? new Date(ts).toLocaleString() : undefined}
          >
            {ts ? formatRelative(ts, { compact: true }) : "—"}
          </span>
        );
      },
    },
    {
      // Which year the family is asking about — editable in the row
      // so tagging a backlog doesn't mean opening every sheet. Only
      // ever set by hand, so an unset row reads "—", never a guess.
      key: "registration_school_years_id",
      header: "Year",
      sortable: true,
      width: "w-[10%]",
      accessor: (row) =>
        schoolYears.find((y) => y.id === yearIdOf(row))?.year_name ?? "",
      render: (row) => (
        <span onClick={(e) => e.stopPropagation()}>
          <Select
            value={yearIdOf(row) > 0 ? String(yearIdOf(row)) : "0"}
            onValueChange={(v) => void setYear(row, Number(v))}
          >
            <SelectTrigger
              size="sm"
              className={cn(
                "h-7 w-full border-transparent bg-transparent px-1.5 text-xs shadow-none hover:border-input hover:bg-white",
                !yearIdOf(row) && "text-muted-foreground"
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
      // 1–5 gut-feel interest rating, clickable right in the row —
      // rating is a quick triage action, not worth a dialog. Sorts
      // on the numeric value so the hottest leads bubble to the top.
      key: "interest_level",
      header: "Interest",
      sortable: true,
      // 5 stars (20px each) + gaps need ~108px of content; 132px
      // leaves room inside the cell padding so the fifth star isn't
      // clipped. Block-level wrapper so the cell's `truncate` can't
      // ellipsize the row of stars.
      width: "w-[132px]",
      accessor: (row) => row.interest_level ?? 0,
      render: (row) => (
        <div className="flex items-center">
          <StarRating
            value={row.interest_level ?? 0}
            disabled={savingId === row.id}
            onChange={(v) => void updateInterest(row, v)}
          />
        </div>
      ),
    },
  ];

  // Row-status helpers. Terminal = converted or not-interested; those
  // rows have left the working pipeline.
  const isConverted = (row: Inquiry) => row.status === "converted";
  const isNotInterested = (row: Inquiry) => row.status === "not_interested";
  const isTerminal = (row: Inquiry) => isConverted(row) || isNotInterested(row);

  // Icon action button used in the trailing columns. Cell wrapper is
  // `flex` (block-level), NOT `inline-flex` — the DataTable puts
  // `truncate` on every cell, and inline content that overflows gets
  // replaced with a literal "…" that renders as stray dots beside the
  // icon. `disabled` buttons stay in place (grayed) rather than being
  // removed, so every section's columns line up.
  function actionButton(opts: {
    key: string;
    icon: React.ReactNode;
    hoverClass: string;
    title: string;
    ariaLabel: (row: Inquiry) => string;
    disabled: (row: Inquiry) => boolean;
    spinning?: (row: Inquiry) => boolean;
    onClick: (row: Inquiry) => void;
  }): ColumnDef<Inquiry> {
    return {
      key: opts.key,
      header: "",
      width: "w-[44px]",
      align: "right",
      render: (row) => {
        const spinning = opts.spinning?.(row) ?? false;
        return (
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex items-center justify-end"
          >
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn("size-7 text-muted-foreground", opts.hoverClass)}
              disabled={opts.disabled(row) || spinning}
              onClick={() => opts.onClick(row)}
              aria-label={opts.ariaLabel(row)}
              title={opts.title}
            >
              {spinning ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                opts.icon
              )}
            </Button>
          </div>
        );
      },
    };
  }

  const rowName = (row: Inquiry) =>
    row.parent_name || row.student_name || "this family";

  // Auto-suggest hint: tint the whole row light blue when the
  // inquiry's email matches a registered parent account (so the
  // family likely applied). Skipped once the row is already marked
  // converted — the tint would be redundant there. Suggestion only;
  // admin still confirms with the ✓ button.
  const rowTint = (row: Inquiry) =>
    row.hasParentAccount && row.status !== "converted"
      ? "bg-blue-50 hover:bg-blue-100"
      : undefined;

  // One shared column set across all three sections so the columns
  // line up vertically when the section tables stack. Buttons that
  // don't apply to a row's status are disabled, not removed.
  const columns: ColumnDef<Inquiry>[] = [
    ...baseColumns,
    {
      key: "isFollowedUp",
      header: "Follow-up",
      sortable: true,
      width: "w-[112px]",
      align: "center",
      // Switch sits inside a click-stopping wrapper because the parent
      // row registers an onRowClick to open the detail Sheet. Disabled
      // once the inquiry reaches a terminal status — follow-up is moot
      // for converted / declined families — but kept visible.
      render: (row) => (
        <div
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center justify-center"
        >
          <Switch
            checked={!!row.isFollowedUp}
            disabled={savingId === row.id || isTerminal(row)}
            onCheckedChange={(v) => toggleFollowedUp(row, v)}
            aria-label={`Mark ${row.parent_name} followed up`}
          />
        </div>
      ),
    },
    {
      // Last note — a truncated one-line preview of the most recent
      // note logged on the inquiry, across every section (the decline
      // reason for not-interested rows still lives on the detail
      // Sheet). Full text on hover; sorts on the note's timestamp so
      // admin can surface the most- or least-recently touched families.
      key: "last_note",
      header: "Last note",
      sortable: true,
      width: "w-[200px]",
      accessor: (row) => row.last_note_at ?? 0,
      render: (row) =>
        row.last_note ? (
          <span
            className="block truncate text-muted-foreground"
            title={row.last_note}
          >
            {row.last_note}
          </span>
        ) : (
          <span className="text-muted-foreground/40">—</span>
        ),
    },
    actionButton({
      key: "mark_converted",
      icon: <Check className="size-3.5" />,
      hoverClass: "hover:text-blue-700 hover:bg-blue-50",
      title: "Mark converted (family applied)",
      ariaLabel: (row) => `Mark ${rowName(row)} converted to application`,
      // Disabled once already converted.
      disabled: (row) => isConverted(row),
      spinning: (row) => savingId === row.id && !isConverted(row),
      onClick: (row) => void markConverted(row),
    }),
    actionButton({
      key: "mark_not_interested",
      icon: <X className="size-3.5" />,
      hoverClass: "hover:text-amber-700 hover:bg-amber-50",
      title: "Mark not interested",
      ariaLabel: (row) => `Mark ${rowName(row)} not interested`,
      // Opens the reason dialog; disabled once already not-interested.
      disabled: (row) => isNotInterested(row) || savingId === row.id,
      onClick: (row) => openNotInterestedDialog(row),
    }),
    actionButton({
      key: "restore",
      icon: <Undo2 className="size-3.5" />,
      hoverClass: "hover:text-green-700 hover:bg-green-50",
      title: "Restore to active",
      ariaLabel: (row) => `Restore inquiry from ${rowName(row)} to active`,
      // Only meaningful for terminal rows — nothing to restore while
      // the inquiry is still active.
      disabled: (row) => !isTerminal(row),
      spinning: (row) => savingId === row.id && isTerminal(row),
      onClick: (row) => void restoreInquiry(row),
    }),
    actionButton({
      key: "delete",
      icon: <Trash2 className="size-3.5" />,
      hoverClass: "hover:text-red-600 hover:bg-red-50",
      title: "Delete inquiry",
      ariaLabel: (row) => `Delete inquiry from ${rowName(row)}`,
      // Routes through the confirmation modal via `pendingDelete`.
      disabled: () => false,
      spinning: (row) => deleting && pendingDelete?.id === row.id,
      onClick: (row) => setPendingDelete(row),
    }),
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Inquiries</h1>
          <p className="text-sm text-muted-foreground">
            Inquiry submissions from prospective families. Click a row to
            read the parent&rsquo;s notes about the student, flip the
            follow-up switch when admissions has reached out, then close
            the loop with ✓ (converted to application) or ✕ (not
            interested). A blue person icon next to a parent means an
            account with that email already exists — likely converted.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* Which year the family is asking about. "No year set" is
              the working bucket — everything still untagged. */}
          <Select
            value={yearFilter === null ? "any" : String(yearFilter)}
            onValueChange={(v) =>
              setYearFilter(v === "any" ? null : Number(v))
            }
          >
            <SelectTrigger className="w-[170px] bg-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any year</SelectItem>
              {schoolYears.map((y) => (
                <SelectItem key={y.id} value={String(y.id)}>
                  {y.year_name}
                  {y.isActive ? " (current)" : y.isNextYear ? " (next)" : ""}
                </SelectItem>
              ))}
              <SelectItem value="0">No year set</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={filter}
            onValueChange={(v) => setFilter(v as InquiryFilter)}
          >
            <SelectTrigger className="w-[200px] bg-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(
                [
                  "all",
                  "not_followed_up",
                  "followed_up",
                  "converted",
                  "not_interested",
                ] as const
              ).map((f) => (
                <SelectItem key={f} value={f}>
                  {FILTER_LABEL[f]} ({counts[f]})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
          Failed to load inquiries:{" "}
          {error instanceof Error ? error.message : "unknown error"}
        </div>
      ) : null}

      <div className="space-y-8">
        <InquiriesGroup
          title="Not Followed Up"
          description="Inquiry submitted — admissions hasn't reached out yet."
          // Yellow = in-progress / needs attention, but not a dead end.
          dotColor="bg-yellow-500"
          rows={visibleGroups.notFollowedUp}
          isLoading={
            isLoading && (filter === "all" || filter === "not_followed_up")
          }
          error={error}
          columns={columns}
          rowClassName={rowTint}
          onRowClick={(row) => setActive(row)}
        />
        <InquiriesGroup
          title="Followed Up"
          description="Admissions has contacted this family."
          // Green = parity with Submitted on Applications page.
          dotColor="bg-green-500"
          rows={visibleGroups.followedUp}
          isLoading={
            isLoading && (filter === "all" || filter === "followed_up")
          }
          error={error}
          columns={columns}
          rowClassName={rowTint}
          onRowClick={(row) => setActive(row)}
        />
        <InquiriesGroup
          title="Converted"
          description="Inquiry turned into an application — the family applied."
          // Blue = a win, distinct from green's "in-progress contact".
          dotColor="bg-blue-500"
          rows={visibleGroups.converted}
          isLoading={isLoading && (filter === "all" || filter === "converted")}
          error={error}
          columns={columns}
          rowClassName={rowTint}
          onRowClick={(row) => setActive(row)}
        />
        <InquiriesGroup
          title="Not Interested"
          description="Family declined — restore anytime with ↩, or open a row to see the decline reason."
          // Red = out of the pipeline / dead lead.
          dotColor="bg-red-500"
          rows={visibleGroups.notInterested}
          isLoading={
            isLoading && (filter === "all" || filter === "not_interested")
          }
          error={error}
          columns={columns}
          rowClassName={rowTint}
          onRowClick={(row) => setActive(row)}
        />
      </div>

      {/* Detail sheet — the SHARED LeadTriageSheet, the same one All
          Leads, Campus Tours, and the dashboard open, so an inquiry
          reads identically wherever an admin reaches it. Its data
          comes from the all-leads feed (fetched lazily on first open)
          rather than this page's row shape, so the conversion link,
          funnel stage, and lifecycle controls behave exactly as they
          do there. Inquiry-only facts ride along as extraFields. */}
      <LeadSheet
        lead={active ? { source: "inquiry", id: active.id } : null}
        onOpenChange={(o) => !o && setActive(null)}
        extraFields={
          active
            ? [
                {
                  label: "How they heard about us",
                  value: active.hear_about_us ?? "",
                },
                {
                  label: "About the student",
                  value: active.about_student ?? "",
                },
              ]
            : undefined
        }
        onChanged={() => void globalMutate("/api/admin/inquiries")}
      />

      {/* "Mark not interested" dialog — forces a reason to be picked
          (or typed, via "Other") before the status saves, so the Not
          Interested section always explains itself. */}
      <Dialog
        open={!!markingRow}
        onOpenChange={(open) => {
          if (!open) setMarkingRow(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Mark as not interested</DialogTitle>
            <DialogDescription>
              {markingRow ? (
                <>
                  Move the inquiry from{" "}
                  <span className="font-medium">
                    {markingRow.parent_name ||
                      markingRow.student_name ||
                      "this family"}
                  </span>{" "}
                  off the active list. It stays available under the
                  &ldquo;Not interested&rdquo; filter and can be restored
                  anytime.
                </>
              ) : (
                ""
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="not-interested-reason">Reason</Label>
              <Select value={reasonChoice} onValueChange={setReasonChoice}>
                <SelectTrigger
                  id="not-interested-reason"
                  className="w-full"
                >
                  <SelectValue placeholder="Why wasn't the family interested?" />
                </SelectTrigger>
                <SelectContent>
                  {NOT_INTERESTED_REASONS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {reasonChoice === "Other" ? (
              <div className="space-y-2">
                <Label htmlFor="not-interested-custom">Reason details</Label>
                <Input
                  id="not-interested-custom"
                  value={customReason}
                  onChange={(e) => setCustomReason(e.target.value)}
                  placeholder="Short reason…"
                  maxLength={120}
                  autoFocus
                />
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setMarkingRow(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={
                !reasonChoice ||
                (reasonChoice === "Other" && !customReason.trim())
              }
              onClick={() => void confirmNotInterested()}
            >
              <UserX className="size-3.5 mr-1.5" />
              Mark not interested
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation. Hard delete — there's no soft-delete
          flag on `registration_inquiry`, and pre-application inquiries
          don't carry downstream relations admin needs to preserve. The
          modal stays mounted at the page level so any row's Delete
          button can trigger it without worrying about portal context. */}
      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(open) => {
          if (!open && !deleting) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this inquiry?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete ? (
                <>
                  This will permanently remove the inquiry from{" "}
                  <span className="font-medium">
                    {pendingDelete.parent_name ||
                      pendingDelete.student_name ||
                      "this family"}
                  </span>
                  {pendingDelete.primary_email
                    ? ` (${pendingDelete.primary_email})`
                    : ""}
                  . Any notes logged on this inquiry will be deleted too.
                  This can&rsquo;t be undone.
                </>
              ) : (
                ""
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault();
                void confirmDelete();
              }}
            >
              {deleting ? (
                <>
                  <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                  Deleting…
                </>
              ) : (
                "Delete inquiry"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function InquiriesGroup({
  title,
  description,
  rows,
  isLoading,
  error,
  columns,
  dotColor,
  onRowClick,
  rowClassName,
}: {
  title: string;
  description: string;
  rows: Inquiry[];
  isLoading: boolean;
  error: unknown;
  columns: ColumnDef<Inquiry>[];
  dotColor: string;
  onRowClick: (row: Inquiry) => void;
  rowClassName?: (row: Inquiry) => string | undefined;
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
        <DataTable<Inquiry>
          columns={columns}
          data={rows}
          isLoading={isLoading}
          searchPlaceholder={`Search ${title.toLowerCase()}…`}
          onRowClick={onRowClick}
          rowClassName={rowClassName}
        />
      </CardContent>
    </Card>
  );
}


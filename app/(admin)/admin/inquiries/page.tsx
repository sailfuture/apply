"use client";

import { useMemo, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { toast } from "sonner";
import {
  Loader2,
  Mail,
  Phone,
  Star,
  Trash2,
  Undo2,
  UserX,
  X,
} from "lucide-react";
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
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
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
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  InquiryNoteComposer,
  InquiryNotes,
} from "@/components/admin/inquiry-notes";
import { adminFetcher } from "@/lib/admin-fetcher";
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
  // Computed at parse time
  parent_name: string;
  student_name: string;
  [key: string]: unknown;
}

/**
 * Render a fully relative-time string ("3 days ago", "2 weeks ago",
 * "5 months ago", "just now"). Stays relative all the way up rather
 * than falling back to a locale date, so the Submitted / Last-contact
 * columns read as elapsed time at every age. Inline because the table
 * doesn't need a full date library — the buckets are approximate
 * (30-day months, 365-day years), which is fine for triage.
 */
function formatRelative(ts: number | null | undefined): string {
  if (!ts) return "—";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  const MIN = 60_000;
  const HOUR = 3_600_000;
  const DAY = 86_400_000;
  const WEEK = 7 * DAY;
  const MONTH = 30 * DAY;
  const YEAR = 365 * DAY;
  const unit = (n: number, label: string) =>
    `${n} ${label}${n === 1 ? "" : "s"} ago`;
  if (diff < HOUR) return unit(Math.floor(diff / MIN), "min");
  if (diff < DAY) return unit(Math.floor(diff / HOUR), "hour");
  if (diff < WEEK) return unit(Math.floor(diff / DAY), "day");
  if (diff < MONTH) return unit(Math.floor(diff / WEEK), "week");
  if (diff < YEAR) return unit(Math.floor(diff / MONTH), "month");
  return unit(Math.floor(diff / YEAR), "year");
}

type InquiryFilter =
  | "all"
  | "not_followed_up"
  | "followed_up"
  | "not_interested";

const FILTER_LABEL: Record<InquiryFilter, string> = {
  // "All active" deliberately excludes not-interested rows — the whole
  // point of the status is to get declined families off the working
  // list. They're reachable through the "Not interested" option below.
  all: "All active",
  not_followed_up: "Not followed up",
  followed_up: "Followed up",
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
  const { data, isLoading, error, mutate } = useSWR<Inquiry[]>(
    "/api/admin/inquiries",
    adminFetcher
  );
  const { mutate: globalMutate } = useSWRConfig();
  const [active, setActive] = useState<Inquiry | null>(null);
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
    const notInterested: Inquiry[] = [];
    for (const r of rows) {
      // Not-interested wins over the follow-up split — a declined
      // family leaves the working pipeline regardless of whether we
      // had already reached out.
      if (r.status === "not_interested") notInterested.push(r);
      else if (r.isFollowedUp) followedUp.push(r);
      else notFollowedUp.push(r);
    }
    return { followedUp, notFollowedUp, notInterested };
  }, [rows]);

  const visibleGroups = useMemo(() => {
    if (filter === "all") {
      // Default view: active pipeline only. Declined families stay
      // hidden until admin explicitly picks the "Not interested"
      // filter.
      return { ...groups, notInterested: [] as Inquiry[] };
    }
    return {
      followedUp: filter === "followed_up" ? groups.followedUp : [],
      notFollowedUp: filter === "not_followed_up" ? groups.notFollowedUp : [],
      notInterested: filter === "not_interested" ? groups.notInterested : [],
    };
  }, [filter, groups]);

  const counts = useMemo(
    () =>
      ({
        all: groups.followedUp.length + groups.notFollowedUp.length,
        followed_up: groups.followedUp.length,
        not_followed_up: groups.notFollowedUp.length,
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
      width: "w-[14%]",
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
      width: "w-[13%]",
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
            // max-w-full bounds the inline-flex anchor to the cell so
            // the inner span ellipsizes ("…") instead of the cell
            // hard-clipping the text mid-character.
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
      key: "primary_phone",
      header: "Phone",
      width: "w-[13%]",
      render: (row) => {
        const formatted = formatPhone(row.primary_phone);
        if (!formatted) return "—";
        return (
          <a
            href={`tel:${String(row.primary_phone).replace(/\D/g, "")}`}
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
      key: "hear_about_us",
      header: "Source",
      width: "w-[7%]",
      render: (row) => (
        <span className="block truncate">{row.hear_about_us || "—"}</span>
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
      header: "Submitted",
      sortable: true,
      width: "w-[9%]",
      accessor: (row) => row.created_at ?? 0,
      render: (row) => (
        <span className="block truncate">{formatRelative(row.created_at)}</span>
      ),
    },
    // Last contact column stays dropped — it still shows in the detail
    // Sheet's header subtitle.
    {
      // 1–5 gut-feel interest rating, clickable right in the row —
      // rating is a quick triage action, not worth a dialog. Sorts
      // on the numeric value so the hottest leads bubble to the top.
      key: "interest_level",
      header: "Interest",
      sortable: true,
      width: "w-[110px]",
      accessor: (row) => row.interest_level ?? 0,
      render: (row) => (
        <StarRating
          value={row.interest_level ?? 0}
          disabled={savingId === row.id}
          onChange={(v) => void updateInterest(row, v)}
        />
      ),
    },
  ];

  // Inline row action buttons (with title tooltips). Dropping the
  // Submitted / Last contact columns freed enough width to put these
  // back in the row where they're one click instead of two.
  //
  // Cell anatomy note: the wrapper divs are `flex` (block-level), NOT
  // `inline-flex` — the DataTable puts `truncate` on every cell, and
  // inline-level content that overflows gets replaced with a literal
  // "…" that renders as stray dots next to the icons. Block children
  // are immune to text-overflow. Width is 48px so the 28px button +
  // 16px cell padding fit without overflowing at all.
  const markNotInterestedColumn: ColumnDef<Inquiry> = {
    // X button — opens the reason dialog rather than saving
    // immediately so a status never lands without its reason.
    key: "mark_not_interested",
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
          className="size-7 text-muted-foreground hover:text-amber-700 hover:bg-amber-50"
          disabled={savingId === row.id}
          onClick={() => openNotInterestedDialog(row)}
          aria-label={`Mark ${row.parent_name || row.student_name || "this family"} not interested`}
          title="Mark not interested"
        >
          <X className="size-3.5" />
        </Button>
      </div>
    ),
  };

  const restoreColumn: ColumnDef<Inquiry> = {
    // Undo button — puts a declined family back in the active
    // pipeline.
    key: "restore",
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
          className="size-7 text-muted-foreground hover:text-green-700 hover:bg-green-50"
          disabled={savingId === row.id}
          onClick={() => void restoreInquiry(row)}
          aria-label={`Restore inquiry from ${row.parent_name || row.student_name || "this family"} to active`}
          title="Restore to active"
        >
          {savingId === row.id ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Undo2 className="size-3.5" />
          )}
        </Button>
      </div>
    ),
  };

  const deleteColumn: ColumnDef<Inquiry> = {
    // Trash button routes through `pendingDelete` so the confirmation
    // modal catches the click before anything destructive lands.
    key: "delete",
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
          className="size-7 text-muted-foreground hover:text-red-600 hover:bg-red-50"
          disabled={deleting && pendingDelete?.id === row.id}
          onClick={() => setPendingDelete(row)}
          aria-label={`Delete inquiry from ${row.parent_name || row.student_name || "this family"}`}
          title="Delete inquiry"
        >
          {deleting && pendingDelete?.id === row.id ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Trash2 className="size-3.5" />
          )}
        </Button>
      </div>
    ),
  };

  // Columns for the two active sections: follow-up switch plus the
  // X (not interested) and delete buttons.
  const activeColumns: ColumnDef<Inquiry>[] = [
    ...baseColumns,
    {
      key: "isFollowedUp",
      header: "Followed up",
      sortable: true,
      width: "w-[110px]",
      align: "center",
      // Switch sits inside a click-stopping wrapper because the parent
      // row registers an onRowClick to open the detail Sheet — we don't
      // want toggling follow-up to also open the Sheet.
      render: (row) => (
        <div
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center justify-center"
        >
          <Switch
            checked={!!row.isFollowedUp}
            disabled={savingId === row.id}
            onCheckedChange={(v) => toggleFollowedUp(row, v)}
            aria-label={`Mark ${row.parent_name} followed up`}
          />
        </div>
      ),
    },
    markNotInterestedColumn,
    deleteColumn,
  ];

  // Columns for the Not Interested section: the follow-up switch is
  // replaced by the logged reason, and the action becomes "restore"
  // instead of "mark not interested".
  const notInterestedColumns: ColumnDef<Inquiry>[] = [
    ...baseColumns,
    {
      key: "status_reason",
      header: "Reason",
      sortable: true,
      width: "w-[130px]",
      render: (row) => (
        <Badge
          variant="secondary"
          className="max-w-full truncate font-normal"
          title={row.status_reason || undefined}
        >
          {row.status_reason || "No reason logged"}
        </Badge>
      ),
    },
    restoreColumn,
    deleteColumn,
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Inquiries</h1>
          <p className="text-sm text-muted-foreground">
            Inquiry submissions from prospective families. Click a row to
            read the parent&rsquo;s notes about the student, flip the
            follow-up switch when admissions has reached out, or mark a
            family not interested to move them off the active list.
          </p>
        </div>
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
          // Red dot mirrors the Applications page "Not Started" tone:
          // attention-getting, signals "pick this up next."
          dotColor="bg-red-500"
          rows={visibleGroups.notFollowedUp}
          isLoading={
            isLoading && (filter === "all" || filter === "not_followed_up")
          }
          error={error}
          columns={activeColumns}
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
          columns={activeColumns}
          onRowClick={(row) => setActive(row)}
        />
        <InquiriesGroup
          title="Not Interested"
          description="Family declined — kept here with the reason for reference. Restore anytime."
          // Gray = out of the pipeline, no action needed.
          dotColor="bg-gray-400"
          rows={visibleGroups.notInterested}
          isLoading={isLoading && filter === "not_interested"}
          error={error}
          columns={notInterestedColumns}
          onRowClick={(row) => setActive(row)}
        />
      </div>

      <Sheet
        open={active !== null}
        onOpenChange={(open) => {
          if (!open) setActive(null);
        }}
      >
        {/*  Wider Sheet — the Notes log + the inquiry summary share
             this drawer, and the previous `sm:max-w-lg` made the
             notes timeline cramped. Bumped to `xl` so the comms log
             is readable without horizontal compression while still
             leaving room on the left for the underlying table.
             Three-region flex column: header, scrollable middle
             (summary + timeline), fixed-bottom composer — same
             layout shape as the family-side `FamilyNotesSheet` so
             the comms log composer is always reachable while admin
             scrolls through the inquiry details. */}
        <SheetContent className="w-full sm:max-w-xl flex flex-col p-0 gap-0">
          {active ? (
            <>
              <SheetHeader className="border-b px-6 py-4">
                <SheetTitle>{active.parent_name || "Inquiry"}</SheetTitle>
                <SheetDescription>
                  Submitted {new Date(active.created_at).toLocaleString()}
                  {active.last_reach_out
                    ? ` · last contact ${formatRelative(active.last_reach_out)}`
                    : ""}
                </SheetDescription>
              </SheetHeader>
              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
                <DetailRow label="Followed up">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={!!active.isFollowedUp}
                      disabled={savingId === active.id}
                      onCheckedChange={(v) => {
                        // Sheet keeps its own snapshot of the row — flip
                        // it locally too so the toggle reflects the
                        // pending value while the PATCH is in flight.
                        setActive({ ...active, isFollowedUp: v });
                        toggleFollowedUp(active, v);
                      }}
                      aria-label="Mark inquiry followed up"
                    />
                    <span className="text-xs text-muted-foreground">
                      {active.isFollowedUp ? "Yes" : "Not yet"}
                    </span>
                  </div>
                </DetailRow>

                <DetailRow label="Interest level">
                  <div className="flex items-center gap-2">
                    <StarRating
                      value={active.interest_level ?? 0}
                      disabled={savingId === active.id}
                      onChange={(v) => void updateInterest(active, v)}
                    />
                    <span className="text-xs text-muted-foreground">
                      {active.interest_level
                        ? `${active.interest_level}/5`
                        : "Not rated"}
                    </span>
                  </div>
                </DetailRow>

                <DetailRow label="Status">
                  {active.status === "not_interested" ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        variant="secondary"
                        className="font-normal"
                        title={active.status_reason || undefined}
                      >
                        Not interested
                        {active.status_reason
                          ? ` — ${active.status_reason}`
                          : ""}
                      </Badge>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        disabled={savingId === active.id}
                        onClick={() => void restoreInquiry(active)}
                      >
                        <Undo2 className="size-3 mr-1" />
                        Restore to active
                      </Button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="font-normal">
                        Active
                      </Badge>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs text-muted-foreground"
                        disabled={savingId === active.id}
                        onClick={() => openNotInterestedDialog(active)}
                      >
                        <UserX className="size-3 mr-1" />
                        Mark not interested
                      </Button>
                    </div>
                  )}
                </DetailRow>

                <div className="grid grid-cols-1 gap-5">
                  <DetailRow label="Parent">
                    {active.parent_name || "—"}
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

                {/* Notes timeline — list only. The composer renders
                    below in the fixed-bottom region so it stays put
                    while admin scrolls through the timeline. */}
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                    Notes &amp; communication log
                  </p>
                  <InquiryNotes inquiryId={active.id} variant="timeline" />
                </div>
              </div>

              {/* Fixed-bottom composer. Submitting bumps the inquiry's
                  `last_reach_out` server-side; we revalidate the
                  inquiries list cache so the "Last contact" column
                  updates without a full refresh. */}
              <div className="border-t bg-muted/20 px-6 py-4 shrink-0">
                <InquiryNoteComposer
                  inquiryId={active.id}
                  onNoteAdded={() => {
                    globalMutate("/api/admin/inquiries");
                    // The Sheet's own row snapshot is independent of
                    // the SWR cache — patch it locally too so the
                    // header subtitle's "last contact" string
                    // updates immediately.
                    setActive((curr) =>
                      curr ? { ...curr, last_reach_out: Date.now() } : curr
                    );
                  }}
                />
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>

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
}: {
  title: string;
  description: string;
  rows: Inquiry[];
  isLoading: boolean;
  error: unknown;
  columns: ColumnDef<Inquiry>[];
  dotColor: string;
  onRowClick: (row: Inquiry) => void;
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
        />
      </CardContent>
    </Card>
  );
}

/**
 * 1–5 clickable star scale. Filled amber up to `value`; clicking a
 * star writes that value, and clicking the current rating again
 * clears it back to 0 (unrated).
 */
function StarRating({
  value,
  onChange,
  disabled,
  className,
}: {
  value: number;
  onChange?: (v: number) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className={cn("inline-flex items-center gap-0.5", className)}
      role="radiogroup"
      aria-label="Interest level"
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n === 1 ? "" : "s"}`}
          title={value === n ? "Click again to clear" : undefined}
          disabled={disabled || !onChange}
          onClick={() => onChange?.(n === value ? 0 : n)}
          className={cn(
            "p-0.5",
            onChange && !disabled
              ? "cursor-pointer transition-transform hover:scale-110"
              : "cursor-default"
          )}
        >
          <Star
            className={cn(
              "size-4",
              n <= value
                ? "fill-amber-400 text-amber-400"
                : "text-muted-foreground/30"
            )}
          />
        </button>
      ))}
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

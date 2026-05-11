"use client";

import { useMemo, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { ChevronRight, Mail, Phone } from "lucide-react";
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
  // Computed at parse time
  parent_name: string;
  student_name: string;
  [key: string]: unknown;
}

/**
 * Render a relative-time string for `last_reach_out` ("3 days ago",
 * "just now"). Inline because the comms log table doesn't need a
 * full date library — anything older than a week falls back to a
 * standard locale date.
 */
function formatRelative(ts: number | null | undefined): string {
  if (!ts) return "—";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) {
    const m = Math.floor(diff / 60_000);
    return `${m} min${m === 1 ? "" : "s"} ago`;
  }
  if (diff < 86_400_000) {
    const h = Math.floor(diff / 3_600_000);
    return `${h} hour${h === 1 ? "" : "s"} ago`;
  }
  if (diff < 7 * 86_400_000) {
    const d = Math.floor(diff / 86_400_000);
    return `${d} day${d === 1 ? "" : "s"} ago`;
  }
  return new Date(ts).toLocaleDateString();
}

type InquiryFilter = "all" | "not_followed_up" | "followed_up";

const FILTER_LABEL: Record<InquiryFilter, string> = {
  all: "All inquiries",
  not_followed_up: "Not followed up",
  followed_up: "Followed up",
};

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

  const rows: Inquiry[] = useMemo(
    () =>
      (Array.isArray(data) ? data : []).map((r) => ({
        ...r,
        primary_email: cleanEmail(r.primary_email),
        parent_name: `${r.primary_first_name ?? ""} ${
          r.primary_last_name ?? ""
        }`.trim(),
        student_name: `${r.student_first_name ?? ""} ${
          r.student_last_name ?? ""
        }`.trim(),
      })),
    [data]
  );

  const groups = useMemo(() => {
    const followedUp: Inquiry[] = [];
    const notFollowedUp: Inquiry[] = [];
    for (const r of rows) {
      if (r.isFollowedUp) followedUp.push(r);
      else notFollowedUp.push(r);
    }
    return { followedUp, notFollowedUp };
  }, [rows]);

  const visibleGroups = useMemo(() => {
    if (filter === "all") return groups;
    return {
      followedUp: filter === "followed_up" ? groups.followedUp : [],
      notFollowedUp: filter === "not_followed_up" ? groups.notFollowedUp : [],
    };
  }, [filter, groups]);

  const counts = useMemo(
    () =>
      ({
        all: rows.length,
        followed_up: groups.followedUp.length,
        not_followed_up: groups.notFollowedUp.length,
      }) satisfies Record<InquiryFilter, number>,
    [rows, groups]
  );

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

  // Shared column definitions across both sections — same widths so
  // headers line up vertically the same way the Applications page does.
  const columns: ColumnDef<Inquiry>[] = [
    {
      key: "parent_name",
      header: "Parent",
      sortable: true,
      searchable: true,
      width: "w-[15%]",
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
      width: "w-[8%]",
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
      width: "w-[17%]",
      render: (row) =>
        row.primary_email ? (
          <a
            href={`mailto:${row.primary_email}`}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 truncate hover:underline"
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
      width: "w-[11%]",
      render: (row) => {
        const formatted = formatPhone(row.primary_phone);
        if (!formatted) return "—";
        return (
          <a
            href={`tel:${String(row.primary_phone).replace(/\D/g, "")}`}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 truncate hover:underline"
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
      width: "w-[8%]",
      render: (row) => (
        <span className="block truncate">{row.hear_about_us || "—"}</span>
      ),
    },
    {
      // Relative time for recent inquiries ("3 days ago"), falling
      // back to an absolute date once the inquiry crosses the
      // one-week mark. The relative form makes the freshest items
      // pop visually so admin can triage them; older entries show
      // the date so admin can still anchor them to a real day
      // without doing the date math.
      key: "created_at",
      header: "Submitted",
      sortable: true,
      width: "w-[9%]",
      render: (row) => (
        <span className="block truncate">
          {formatRelative(row.created_at)}
        </span>
      ),
    },
    {
      // Sorted on the raw timestamp via `accessor` so "5 minutes
      // ago" sorts more recent than "yesterday" — without that
      // mapping the column would sort alphabetically and produce
      // gibberish ordering.
      key: "last_reach_out",
      header: "Last contact",
      sortable: true,
      width: "w-[12%]",
      accessor: (row) => row.last_reach_out ?? 0,
      render: (row) => (
        <span
          className={cn(
            "block truncate",
            !row.last_reach_out && "text-muted-foreground italic"
          )}
        >
          {formatRelative(row.last_reach_out)}
        </span>
      ),
    },
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
    {
      key: "id",
      header: "",
      width: "w-[40px]",
      align: "right",
      render: () => (
        <ChevronRight className="size-4 text-muted-foreground inline" />
      ),
    },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Inquiries</h1>
          <p className="text-sm text-muted-foreground">
            Inquiry submissions from prospective families. Click a row to
            read the parent&rsquo;s notes about the student, or flip the
            follow-up switch when admissions has reached out.
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
            {(["all", "not_followed_up", "followed_up"] as const).map((f) => (
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
          isLoading={isLoading && filter !== "followed_up"}
          error={error}
          columns={columns}
          onRowClick={(row) => setActive(row)}
        />
        <InquiriesGroup
          title="Followed Up"
          description="Admissions has contacted this family."
          // Green = parity with Submitted on Applications page.
          dotColor="bg-green-500"
          rows={visibleGroups.followedUp}
          isLoading={isLoading && filter !== "not_followed_up"}
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

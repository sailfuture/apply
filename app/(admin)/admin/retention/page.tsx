"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import {
  ChevronRight,
  FileSpreadsheet,
  FileText,
  Loader2,
  UserMinus,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { adminFetcher } from "@/lib/admin-fetcher";
import { cn } from "@/lib/utils";
import type {
  RetentionResponse,
  RetentionUnenrolledRow,
} from "@/app/api/admin/retention/route";

/**
 * Enrollment → Retention — how many students the year kept vs lost,
 * and why. Enrolled = confirmed, non-archived students registered for
 * the year; Unenrolled = students taken out through the official
 * Unenroll modal (which stamps reason / effective date / notes on the
 * student row). Application-stage archives don't count — retention
 * measures students the school lost, not applicants who never
 * started. Row click opens the family's detail page for the year.
 */
export default function RetentionPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const yearId = searchParams.get("yearId");

  const { data, isLoading, error, mutate } = useSWR<RetentionResponse>(
    yearId ? `/api/admin/retention?yearId=${yearId}` : null,
    adminFetcher
  );

  // All / Community / Residential — residential (foster) placements
  // churn by design, so their departures shouldn't drag the
  // community retention number (and vice versa).
  const [segment, setSegment] = useState<Segment>("all");
  const filteredUnenrolled = useMemo(() => {
    const rows = data?.unenrolled ?? [];
    if (segment === "all") return rows;
    return rows.filter((u) =>
      segment === "residential" ? u.residential : !u.residential
    );
  }, [data, segment]);
  // Exempt rows (student never actually attended, etc.) stay VISIBLE
  // — in their own "Not counted" card below the main table — but drop
  // out of every number: they weren't real enrollments, so they're
  // neither a keep nor a loss.
  const countedUnenrolled = filteredUnenrolled.filter(
    (u) => !u.retention_exempt
  );
  const notCounted = filteredUnenrolled.filter((u) => u.retention_exempt);
  // Community and residential departures get their OWN cards —
  // residential/foster placements churn by design (a placement ending
  // isn't a family choosing to leave), so reading them in one list
  // with community departures misrepresents both.
  const communityCounted = countedUnenrolled.filter((u) => !u.residential);
  const residentialCounted = countedUnenrolled.filter((u) => u.residential);
  const enrolledCount = data?.enrolled[segment] ?? 0;
  const ratePct = formatRate(enrolledCount, countedUnenrolled.length);

  /**
   * Toggle a departure's retention exemption. Optimistic — the
   * checkbox and the headline numbers move immediately, then a
   * revalidation confirms against the server (and reverts the box if
   * the write didn't stick, e.g. the Xano column is missing).
   */
  async function toggleExempt(row: RetentionUnenrolledRow, next: boolean) {
    await mutate(
      (prev) =>
        prev && {
          ...prev,
          unenrolled: prev.unenrolled.map((u) =>
            u.student_id === row.student_id
              ? { ...u, retention_exempt: next }
              : u
          ),
        },
      { revalidate: false }
    );
    try {
      const res = await fetch(`/api/admin/students/${row.student_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isRetentionExempt: next }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Save failed (${res.status})`);
      }
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Couldn't update the retention exemption"
      );
    } finally {
      // Converge on server truth either way.
      void mutate();
    }
  }

  /** Row click target — the family OVERVIEW surface (see
   *  UnenrolledTable's docblock for why not the registration page). */
  const openFamily = (row: RetentionUnenrolledRow) =>
    router.push(
      `/admin/families/${row.family_id}/overview?yearId=${yearId}`
    );

  // XLSX / PDF export of exactly what the page currently shows for
  // the selected segment. Libraries load on demand (dynamic import)
  // so the page bundle stays lean.
  const [exporting, setExporting] = useState<"xlsx" | "pdf" | null>(null);
  async function runExport(kind: "xlsx" | "pdf") {
    if (exporting || !data) return;
    setExporting(kind);
    try {
      const mod = await import("@/lib/retention-export");
      const input = {
        yearName: data.year.year_name,
        segmentLabel:
          SEGMENTS.find((s) => s.value === segment)?.label ?? "All",
        enrolledCount,
        communityCounted,
        residentialCounted,
        communityEnrolled: data.enrolled.community,
        residentialEnrolled: data.enrolled.residential,
        notCounted,
        ratePct,
      };
      if (kind === "xlsx") await mod.exportRetentionXlsx(input);
      else await mod.exportRetentionPdf(input);
    } catch (err) {
      console.error("Retention export failed:", err);
      toast.error("Export failed — please try again.");
    } finally {
      setExporting(null);
    }
  }

  if (!yearId) {
    return (
      <div className="p-6">
        <div className="rounded-lg border bg-white px-6 py-12 text-center text-sm text-muted-foreground">
          Pick a school year above to view retention.
        </div>
      </div>
    );
  }

  // The report is year-scoped, so the title says WHICH year — the
  // name comes back on the payload; while it loads (or if the id
  // doesn't resolve) the title stays a plain "Retention".
  const yearName = data?.year.year_name ?? "";

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">
          Retention{yearName ? ` — ${yearName}` : ""}
        </h1>
        <p className="text-sm text-muted-foreground">
          Enrolled vs unenrolled for the{" "}
          {yearName ? `${yearName} school year` : "selected school year"},
          with each departure&rsquo;s reason. Students count as unenrolled
          only when taken out through the official Unenroll flow —
          archived applicants who never enrolled aren&rsquo;t retention
          losses. Use the &ldquo;Don&rsquo;t count&rdquo; checkbox to
          leave a departure out of the numbers entirely (e.g. a student
          who never actually attended).
        </p>
      </div>

      {isLoading && !data ? (
        <div className="space-y-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : error || !data ? (
        <div className="rounded-lg border bg-white px-6 py-12 text-center text-sm text-muted-foreground">
          {error instanceof Error
            ? error.message
            : "Couldn't load the retention report."}
        </div>
      ) : (
        <>
          {/* Segment filter chips (left) + report exports (right). */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {SEGMENTS.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  aria-pressed={segment === s.value}
                  onClick={() => setSegment(s.value)}
                  className={cn(
                    "rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
                    segment === s.value
                      ? "border-foreground bg-foreground text-background"
                      : "border-border bg-white text-muted-foreground hover:border-foreground/40 hover:text-foreground"
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => runExport("xlsx")}
                disabled={exporting !== null}
                className={EXPORT_BUTTON}
                title="Download the report as an Excel spreadsheet"
              >
                {exporting === "xlsx" ? (
                  <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                ) : (
                  <FileSpreadsheet className="size-3" aria-hidden="true" />
                )}
                Export XLSX
              </button>
              <button
                type="button"
                onClick={() => runExport("pdf")}
                disabled={exporting !== null}
                className={EXPORT_BUTTON}
                title="Download the report as a printable PDF"
              >
                {exporting === "pdf" ? (
                  <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                ) : (
                  <FileText className="size-3" aria-hidden="true" />
                )}
                Export PDF
              </button>
            </div>
          </div>

          {/* Headline numbers — derived from the selected segment. */}
          <Card className="overflow-hidden gap-0 py-0 bg-white">
            <CardContent className="px-4 py-4 bg-white">
              <dl className="grid grid-cols-3 gap-4 text-sm">
                {/* The community/residential breakdown only means
                    something in the mixed view — the segmented views
                    are already one group, so the caption would just
                    restate the headline number. */}
                <Stat
                  label="Enrolled"
                  value={String(enrolledCount)}
                  tone="positive"
                  detail={
                    segment === "all"
                      ? `${data.enrolled.community} community · ${data.enrolled.residential} residential`
                      : undefined
                  }
                />
                <Stat
                  label="Unenrolled"
                  value={String(countedUnenrolled.length)}
                  tone={countedUnenrolled.length > 0 ? "negative" : "muted"}
                />
                <Stat label="Retention rate" value={ratePct} tone="muted" />
              </dl>
            </CardContent>
          </Card>

          {/* Community departures — the headline retention story. */}
          {segment !== "residential" ? (
            <DepartureCard
              title="Community students"
              count={communityCounted.length}
              caption={`${data.enrolled.community} enrolled · ${formatRate(
                data.enrolled.community,
                communityCounted.length
              )} retained`}
              emptyText="No community students have been unenrolled this year."
              rows={communityCounted}
              onOpenFamily={openFamily}
              onToggle={toggleExempt}
            />
          ) : null}

          {/* Residential/foster placements — separated because a
              placement ending is a case-management outcome, not a
              family choosing to leave the school. Hidden entirely when
              there are none (and the segment isn't asking for them) so
              a community-only year doesn't carry an empty card. */}
          {segment !== "community" &&
          (residentialCounted.length > 0 || segment === "residential") ? (
            <DepartureCard
              title="Residential students"
              count={residentialCounted.length}
              caption={`${data.enrolled.residential} enrolled · ${formatRate(
                data.enrolled.residential,
                residentialCounted.length
              )} retained`}
              emptyText="No residential students have been unenrolled this year."
              rows={residentialCounted}
              onOpenFamily={openFamily}
              onToggle={toggleExempt}
            />
          ) : null}

          {/* Retention-exempt departures — their own card so the main
              table (and its count) is exactly what the rate is built
              from. Unchecking a row here moves it back up. */}
          {notCounted.length > 0 ? (
            <Card className="overflow-hidden gap-0 py-0 bg-white">
              <CardHeader className="py-3 !pb-3 border-b">
                <div className="flex items-baseline gap-3">
                  <CardTitle className="text-base text-muted-foreground">
                    Not counted
                  </CardTitle>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    ({notCounted.length})
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Never really enrolled — excluded from the retention
                    numbers.
                  </span>
                </div>
              </CardHeader>
              <CardContent className="px-3 pb-3 bg-white">
                <UnenrolledTable
                  rows={notCounted}
                  muted
                  showResidentialBadge={segment === "all"}
                  onOpenFamily={openFamily}
                  onToggle={toggleExempt}
                />
              </CardContent>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}

type Segment = "all" | "community" | "residential";

const SEGMENTS: Array<{ value: Segment; label: string }> = [
  { value: "all", label: "All" },
  { value: "community", label: "Community" },
  { value: "residential", label: "Residential" },
];

/**
 * Retention rate for a group: kept ÷ (kept + lost), to one decimal
 * with a trailing ".0" trimmed. "—" when the group has nobody in it,
 * so an empty residential program reads as blank rather than 0%.
 */
function formatRate(enrolled: number, departures: number): string {
  const total = enrolled + departures;
  if (total <= 0) return "—";
  return `${((enrolled / total) * 100).toFixed(1).replace(/\.0$/, "")}%`;
}

/**
 * One card of counted departures (community or residential). Wraps
 * the shared table with a titled header, its own count + retention
 * caption, and an empty state, so the two groups render identically
 * apart from their data.
 */
function DepartureCard({
  title,
  count,
  caption,
  emptyText,
  rows,
  onOpenFamily,
  onToggle,
}: {
  title: string;
  count: number;
  /** "12 enrolled · 92% retained" for THIS group. */
  caption: string;
  emptyText: string;
  rows: RetentionUnenrolledRow[];
  onOpenFamily: (row: RetentionUnenrolledRow) => void;
  onToggle: (row: RetentionUnenrolledRow, next: boolean) => void;
}) {
  return (
    <Card className="overflow-hidden gap-0 py-0 bg-white">
      <CardHeader className="py-3 !pb-3 border-b">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <CardTitle className="text-base">{title}</CardTitle>
          <span className="text-xs tabular-nums text-muted-foreground">
            {count} unenrolled
          </span>
          <span className="text-xs tabular-nums text-muted-foreground">
            {caption}
          </span>
        </div>
      </CardHeader>
      <CardContent className="px-3 pb-3 bg-white">
        {rows.length === 0 ? (
          <div className="px-3 py-10 text-center text-sm text-muted-foreground">
            <UserMinus className="mx-auto mb-2 size-6 text-muted-foreground/50" />
            {emptyText}
          </div>
        ) : (
          <UnenrolledTable
            rows={rows}
            onOpenFamily={onOpenFamily}
            onToggle={onToggle}
          />
        )}
      </CardContent>
    </Card>
  );
}

/** Pill-style export button — matches the segment chips' vocabulary
 *  so the toolbar row reads as one unit. */
const EXPORT_BUTTON =
  "inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-border bg-white px-2.5 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground disabled:cursor-default disabled:opacity-60";

/**
 * The unenrolled-students table, shared by the counted card and the
 * "Not counted" card so their columns can never drift. Row click
 * opens the family OVERVIEW surface (not the per-year registration
 * page — that page only renders students with an active application
 * for the selected year, so a departed student whose paperwork sits
 * under another year is invisible there); the checkbox toggles the
 * retention exemption, which moves the row between the two cards.
 */
function UnenrolledTable({
  rows,
  muted = false,
  showResidentialBadge = false,
  onOpenFamily,
  onToggle,
}: {
  rows: RetentionUnenrolledRow[];
  /** "Not counted" card styling — rows render dimmed. */
  muted?: boolean;
  /** Tag residential rows inline. Only the mixed "Not counted" card
   *  needs it — the community/residential cards are homogeneous, so
   *  the badge would just repeat their titles on every row. */
  showResidentialBadge?: boolean;
  onOpenFamily: (row: RetentionUnenrolledRow) => void;
  onToggle: (row: RetentionUnenrolledRow, next: boolean) => void;
}) {
  return (
    <Table className="table-fixed">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="text-[10px] text-muted-foreground w-[17%]">
            Student
          </TableHead>
          <TableHead className="text-[10px] text-muted-foreground w-[7%]">
            Grade
          </TableHead>
          <TableHead className="text-[10px] text-muted-foreground w-[15%]">
            Family
          </TableHead>
          <TableHead className="text-[10px] text-muted-foreground w-[11%]">
            Unenrolled
          </TableHead>
          <TableHead className="text-[10px] text-muted-foreground w-[20%]">
            Reason
          </TableHead>
          <TableHead className="text-[10px] text-muted-foreground w-[20%]">
            Notes
          </TableHead>
          <TableHead
            className="text-[10px] text-muted-foreground w-[6%] text-center"
            title="Check to leave a departure out of the retention numbers — for students who never actually attended."
          >
            Don&rsquo;t count
          </TableHead>
          <TableHead className="w-[4%]" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((u) => (
          <TableRow
            key={u.student_id}
            onClick={() => onOpenFamily(u)}
            className={cn("cursor-pointer", muted && "opacity-60")}
          >
            <TableCell className="text-sm font-medium">
              <span className="block truncate">{u.student_name}</span>
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">
              {u.grade || "—"}
            </TableCell>
            <TableCell className="text-sm">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate">{u.family_name}</span>
                {u.residential && showResidentialBadge ? (
                  <span className="shrink-0 rounded-full border border-border bg-muted px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Residential
                  </span>
                ) : null}
              </span>
            </TableCell>
            <TableCell className="text-sm tabular-nums text-muted-foreground">
              {formatDate(u.date)}
            </TableCell>
            <TableCell className="text-sm" title={u.reason || undefined}>
              <span className="block truncate">{u.reason || "—"}</span>
            </TableCell>
            <TableCell
              className="text-sm text-muted-foreground"
              title={u.notes || undefined}
            >
              <span className="block truncate">{u.notes || "—"}</span>
            </TableCell>
            {/* stopPropagation on the CELL so a click that lands near
                (not on) the checkbox doesn't navigate away. */}
            <TableCell
              className="text-center"
              onClick={(e) => e.stopPropagation()}
            >
              <Checkbox
                checked={u.retention_exempt}
                onCheckedChange={(v) => onToggle(u, v === true)}
                aria-label={`Don't count ${u.student_name} toward retention`}
                title="Check to leave this departure out of the retention numbers — for students who never actually attended."
              />
            </TableCell>
            <TableCell className="text-right">
              <ChevronRight className="size-4 text-muted-foreground inline" />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function Stat({
  label,
  value,
  tone,
  detail,
}: {
  label: string;
  value: string;
  tone: "muted" | "positive" | "negative";
  /** Optional breakdown under the headline figure ("12 community ·
   *  3 residential"). Nested inside the <dd> rather than added as a
   *  sibling so the <dl> keeps a valid dt/dd structure. */
  detail?: string;
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
        {label}
      </dt>
      <dd
        className={cn(
          "text-lg font-semibold tabular-nums mt-1",
          tone === "positive" && "text-emerald-700",
          tone === "negative" && "text-red-700"
        )}
      >
        {value}
        {detail ? (
          <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
            {detail}
          </span>
        ) : null}
      </dd>
    </div>
  );
}

/** "Aug 18, 2026" from the Unenroll modal's `YYYY-MM-DD` date (UTC
 *  so the displayed day never drifts from the picked one). */
function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(ms)) return iso;
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { ChevronRight, UserMinus } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import type { RetentionResponse } from "@/app/api/admin/retention/route";

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

  const { data, isLoading, error } = useSWR<RetentionResponse>(
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
  const enrolledCount = data?.enrolled[segment] ?? 0;
  const total = enrolledCount + filteredUnenrolled.length;
  const ratePct =
    total > 0
      ? `${((enrolledCount / total) * 100).toFixed(1).replace(/\.0$/, "")}%`
      : "—";

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
          losses.
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
          {/* Segment filter — chips, single-select. */}
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

          {/* Headline numbers — derived from the selected segment. */}
          <Card className="overflow-hidden gap-0 py-0 bg-white">
            <CardContent className="px-4 py-4 bg-white">
              <dl className="grid grid-cols-3 gap-4 text-sm">
                <Stat
                  label="Enrolled"
                  value={String(enrolledCount)}
                  tone="positive"
                />
                <Stat
                  label="Unenrolled"
                  value={String(filteredUnenrolled.length)}
                  tone={filteredUnenrolled.length > 0 ? "negative" : "muted"}
                />
                <Stat label="Retention rate" value={ratePct} tone="muted" />
              </dl>
            </CardContent>
          </Card>

          {/* The departures themselves */}
          <Card className="overflow-hidden gap-0 py-0 bg-white">
            <CardHeader className="py-3 !pb-3 border-b">
              <div className="flex items-baseline gap-3">
                <CardTitle className="text-base">
                  Unenrolled students
                </CardTitle>
                <span className="text-xs tabular-nums text-muted-foreground">
                  ({filteredUnenrolled.length})
                </span>
              </div>
            </CardHeader>
            <CardContent className="px-3 pb-3 bg-white">
              {filteredUnenrolled.length === 0 ? (
                <div className="px-3 py-10 text-center text-sm text-muted-foreground">
                  <UserMinus className="mx-auto mb-2 size-6 text-muted-foreground/50" />
                  {segment === "all"
                    ? "No students have been unenrolled this year."
                    : `No ${segment} students have been unenrolled this year.`}
                </div>
              ) : (
                <Table className="table-fixed">
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="text-[10px] text-muted-foreground w-[18%]">
                        Student
                      </TableHead>
                      <TableHead className="text-[10px] text-muted-foreground w-[8%]">
                        Grade
                      </TableHead>
                      <TableHead className="text-[10px] text-muted-foreground w-[16%]">
                        Family
                      </TableHead>
                      <TableHead className="text-[10px] text-muted-foreground w-[12%]">
                        Unenrolled
                      </TableHead>
                      <TableHead className="text-[10px] text-muted-foreground w-[20%]">
                        Reason
                      </TableHead>
                      <TableHead className="text-[10px] text-muted-foreground w-[22%]">
                        Notes
                      </TableHead>
                      <TableHead className="w-[4%]" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredUnenrolled.map((u) => (
                      <TableRow
                        key={u.student_id}
                        // The OVERVIEW surface, not the per-year
                        // registration page — that page only renders
                        // students with an active application for the
                        // selected year, so a departed student whose
                        // paperwork sits under another year is invisible
                        // there. The overview lists unenrolled students
                        // in their own table, each clickable through to
                        // the student detail.
                        onClick={() =>
                          router.push(
                            `/admin/families/${u.family_id}/overview?yearId=${yearId}`
                          )
                        }
                        className="cursor-pointer"
                      >
                        <TableCell className="text-sm font-medium">
                          <span className="block truncate">
                            {u.student_name}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {u.grade || "—"}
                        </TableCell>
                        <TableCell className="text-sm">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span className="truncate">{u.family_name}</span>
                            {/* Only useful in the mixed view — the
                                segmented views are already homogeneous. */}
                            {u.residential && segment === "all" ? (
                              <span className="shrink-0 rounded-full border border-border bg-muted px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                Residential
                              </span>
                            ) : null}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm tabular-nums text-muted-foreground">
                          {formatDate(u.date)}
                        </TableCell>
                        <TableCell
                          className="text-sm"
                          title={u.reason || undefined}
                        >
                          <span className="block truncate">
                            {u.reason || "—"}
                          </span>
                        </TableCell>
                        <TableCell
                          className="text-xs text-muted-foreground"
                          title={u.notes || undefined}
                        >
                          <span className="block truncate">
                            {u.notes || "—"}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <ChevronRight className="size-4 text-muted-foreground inline" />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
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

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "muted" | "positive" | "negative";
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

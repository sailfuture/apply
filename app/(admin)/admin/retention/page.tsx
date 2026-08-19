"use client";

import { useMemo } from "react";
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

  const ratePct = useMemo(
    () =>
      data?.retentionRate != null
        ? `${(data.retentionRate * 100).toFixed(1).replace(/\.0$/, "")}%`
        : "—",
    [data]
  );

  if (!yearId) {
    return (
      <div className="p-6">
        <div className="rounded-lg border bg-white px-6 py-12 text-center text-sm text-muted-foreground">
          Pick a school year above to view retention.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Retention</h1>
        <p className="text-sm text-muted-foreground">
          Enrolled vs unenrolled for the year, with each departure&rsquo;s
          reason. Students count as unenrolled only when taken out
          through the official Unenroll flow — archived applicants who
          never enrolled aren&rsquo;t retention losses.
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
          {/* Headline numbers */}
          <Card className="overflow-hidden gap-0 py-0 bg-white">
            <CardContent className="px-4 py-4 bg-white">
              <dl className="grid grid-cols-3 gap-4 text-sm">
                <Stat label="Enrolled" value={String(data.enrolledCount)} tone="positive" />
                <Stat
                  label="Unenrolled"
                  value={String(data.unenrolledCount)}
                  tone={data.unenrolledCount > 0 ? "negative" : "muted"}
                />
                <Stat label="Retention rate" value={ratePct} tone="muted" />
              </dl>
            </CardContent>
          </Card>

          {/* Why students left — free-text reasons grouped verbatim. */}
          {data.reasons.length > 0 ? (
            <Card className="overflow-hidden gap-0 py-0 bg-white">
              <CardHeader className="py-3 !pb-3 border-b">
                <CardTitle className="text-base">
                  Unenrollment reasons
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 py-3 bg-white">
                <ul className="divide-y">
                  {data.reasons.map((r) => (
                    <li
                      key={r.reason.toLowerCase()}
                      className="flex items-center justify-between gap-3 py-2 text-sm"
                    >
                      <span className="min-w-0 truncate">{r.reason}</span>
                      <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums">
                        {r.count}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          {/* The departures themselves */}
          <Card className="overflow-hidden gap-0 py-0 bg-white">
            <CardHeader className="py-3 !pb-3 border-b">
              <div className="flex items-baseline gap-3">
                <CardTitle className="text-base">
                  Unenrolled students
                </CardTitle>
                <span className="text-xs tabular-nums text-muted-foreground">
                  ({data.unenrolled.length})
                </span>
              </div>
            </CardHeader>
            <CardContent className="px-3 pb-3 bg-white">
              {data.unenrolled.length === 0 ? (
                <div className="px-3 py-10 text-center text-sm text-muted-foreground">
                  <UserMinus className="mx-auto mb-2 size-6 text-muted-foreground/50" />
                  No students have been unenrolled this year.
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
                    {data.unenrolled.map((u) => (
                      <TableRow
                        key={u.student_id}
                        onClick={() =>
                          router.push(
                            `/admin/families/${u.family_id}?yearId=${yearId}`
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
                          <span className="block truncate">
                            {u.family_name}
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

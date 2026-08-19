"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import { Bus, Clipboard, Download, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { formatUSPhone } from "@/lib/phone";
import type {
  BusStopGroup,
  BusStopsResponse,
} from "@/app/api/admin/bus-stops/route";

/**
 * Operations → Bus Stops — one card per stop with its riders for the
 * year. Built for the morning-route workflow: each card copies as
 * TAB-separated rows (paste straight into Google Sheets and it lands
 * as real cells), and the whole page exports as CSV / copies in one
 * click with a Stop column added.
 */
export default function BusStopsPage() {
  const searchParams = useSearchParams();
  const yearId = searchParams.get("yearId");

  const { data, isLoading, error } = useSWR<BusStopsResponse>(
    yearId ? `/api/admin/bus-stops?yearId=${yearId}` : null,
    adminFetcher
  );
  const stops = useMemo(() => data?.stops ?? [], [data]);
  const ridingStops = useMemo(
    () => stops.filter((s) => s.riders.length > 0),
    [stops]
  );

  if (!yearId) {
    return (
      <div className="p-6">
        <div className="rounded-lg border bg-white px-6 py-12 text-center text-sm text-muted-foreground">
          Pick a school year above to view bus stops.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Bus Stops</h1>
          <p className="text-sm text-muted-foreground">
            Every stop with its riders for the year. Copy pastes as
            real cells into Google Sheets; Export downloads the same
            list as CSV.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="rounded-full border bg-white px-2.5 py-1 text-xs tabular-nums text-muted-foreground">
            {data?.totalRiders ?? 0} rider
            {(data?.totalRiders ?? 0) === 1 ? "" : "s"}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="bg-white"
            disabled={ridingStops.length === 0}
            onClick={() => copyTsv(buildAllTsv(ridingStops), "All stops")}
          >
            <Clipboard className="size-3.5 mr-1.5" aria-hidden="true" />
            Copy all
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="bg-white"
            disabled={ridingStops.length === 0}
            onClick={() => downloadCsv(ridingStops)}
          >
            <Download className="size-3.5 mr-1.5" aria-hidden="true" />
            Export CSV
          </Button>
        </div>
      </div>

      {isLoading && !data ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-56" />
          ))}
        </div>
      ) : error || !data ? (
        <div className="rounded-lg border bg-white px-6 py-12 text-center text-sm text-muted-foreground">
          {error instanceof Error
            ? error.message
            : "Couldn't load the bus-stop rosters."}
        </div>
      ) : stops.length === 0 ? (
        <div className="rounded-lg border bg-white px-6 py-16 text-center text-sm text-muted-foreground">
          <Bus className="mx-auto mb-2 size-6 text-muted-foreground/50" />
          No bus stops configured yet — add stops to the
          <span className="font-medium text-foreground">
            {" "}
            registration_bus{" "}
          </span>
          catalog and they&rsquo;ll appear here.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {stops.map((stop) => (
            <StopCard key={stop.id ?? `orphan-${stop.name}`} stop={stop} />
          ))}
        </div>
      )}
    </div>
  );
}

function StopCard({ stop }: { stop: BusStopGroup }) {
  const times = [
    stop.pick_up_time ? `Pickup ${formatTime(stop.pick_up_time)}` : null,
    stop.drop_off_time
      ? `Drop-off ${formatTime(stop.drop_off_time)}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Card className="overflow-hidden gap-0 py-0 bg-white">
      <CardHeader className="py-3 !pb-3 border-b">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-1.5 text-base">
              <Bus
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <span className="truncate">{stop.name}</span>
            </CardTitle>
            {times ? (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {times}
              </p>
            ) : null}
            {stop.address ? (
              <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin className="size-3 shrink-0" aria-hidden="true" />
                <span className="truncate">{stop.address}</span>
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums">
              {stop.riders.length}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 bg-white px-2 text-xs"
              disabled={stop.riders.length === 0}
              onClick={() => copyTsv(buildStopTsv(stop), stop.name)}
              title="Copy this stop's roster — pastes into Google Sheets as cells"
            >
              <Clipboard className="size-3 mr-1" aria-hidden="true" />
              Copy
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-3 pb-3 bg-white">
        {stop.riders.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            No riders assigned.
          </p>
        ) : (
          <Table className="table-fixed">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="text-[10px] text-muted-foreground w-[30%]">
                  Student
                </TableHead>
                <TableHead className="text-[10px] text-muted-foreground w-[12%]">
                  Grade
                </TableHead>
                <TableHead className="text-[10px] text-muted-foreground w-[28%]">
                  Family
                </TableHead>
                <TableHead className="text-[10px] text-muted-foreground w-[30%]">
                  Parent
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stop.riders.map((r) => (
                <TableRow key={r.student_id} className="hover:bg-muted/40">
                  <TableCell className="text-sm font-medium">
                    <span className="block truncate">{r.student_name}</span>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {r.grade || "—"}
                  </TableCell>
                  <TableCell className="text-sm">
                    <span className="block truncate">{r.family_name}</span>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    <span className="block truncate">
                      {[r.parent_name, formatUSPhone(r.parent_phone)]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

/* ─────────────────── copy / export helpers ─────────────────── */

const RIDER_HEADERS = [
  "Student",
  "Grade",
  "Family",
  "Parent",
  "Parent phone",
] as const;

function riderCells(r: BusStopGroup["riders"][number]): string[] {
  return [
    r.student_name,
    r.grade,
    r.family_name,
    r.parent_name,
    formatUSPhone(r.parent_phone) || r.parent_phone,
  ];
}

/** One stop as TSV — tabs/newlines are what make a paste land as
 *  cells in Google Sheets rather than one text blob. */
function buildStopTsv(stop: BusStopGroup): string {
  return [
    RIDER_HEADERS.join("\t"),
    ...stop.riders.map((r) => riderCells(r).map(tsvSafe).join("\t")),
  ].join("\n");
}

function buildAllTsv(stops: BusStopGroup[]): string {
  return [
    ["Stop", ...RIDER_HEADERS].join("\t"),
    ...stops.flatMap((s) =>
      s.riders.map((r) =>
        [s.name, ...riderCells(r)].map(tsvSafe).join("\t")
      )
    ),
  ].join("\n");
}

/** Cell text can't carry the delimiters — collapse them to spaces. */
function tsvSafe(v: string): string {
  return v.replace(/[\t\n\r]+/g, " ").trim();
}

function copyTsv(tsv: string, label: string): void {
  // navigator.clipboard is secure-context-only — undefined over plain
  // http, where the member access would throw synchronously.
  if (!navigator.clipboard?.writeText) {
    toast.error("Couldn't copy — use Export CSV instead.");
    return;
  }
  void navigator.clipboard.writeText(tsv).then(
    () =>
      toast.success(
        `${label} copied — paste into Google Sheets and it lands as cells.`
      ),
    () => toast.error("Couldn't copy — use Export CSV instead.")
  );
}

function downloadCsv(stops: BusStopGroup[]): void {
  const rows = [
    ["Stop", ...RIDER_HEADERS],
    ...stops.flatMap((s) =>
      s.riders.map((r) => [s.name, ...riderCells(r)])
    ),
  ];
  const csv = rows
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");
  const blob = new Blob([`﻿${csv}`], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "bus-stops.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function csvCell(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** "8:45 AM" from the catalog's unix-ms time (0/null = unset). */
function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

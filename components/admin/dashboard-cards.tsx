"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  MessageSquareText,
  NotebookPen,
  Phone,
} from "lucide-react";
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
import { formatRelativeShort } from "@/lib/format-note-time";
import { StarRating } from "@/components/admin/star-rating";
import { cn } from "@/lib/utils";
import type { LeadActivityResponse } from "@/app/api/admin/lead-activity/route";

type ActivityRow = LeadActivityResponse["rows"][number];

/** Rows per page on the activity card. Five keeps the card to one
 *  screen-height block under the charts; the pager walks the rest of
 *  the 25 the route returns. */
const ACTIVITY_PAGE_SIZE = 5;

/* ──────────────────── Lead activity ──────────────────── */

/** Icon per activity kind, so the stream is scannable without reading
 *  every label. Inbound texts get the accent — they're the ones that
 *  might need an answer. */
function activityIcon(kind: ActivityRow["kind"]) {
  if (kind === "note") {
    return <NotebookPen className="size-3.5 text-muted-foreground" />;
  }
  if (kind === "call") {
    return <Phone className="size-3.5 text-muted-foreground" />;
  }
  return (
    <MessageSquareText
      className={cn(
        "size-3.5",
        kind === "sms_in" ? "text-blue-600" : "text-muted-foreground"
      )}
    />
  );
}

/**
 * Leads with recent activity — one row per lead, showing its newest
 * note or text (the API dedupes to latest-per-lead). "Who has
 * something happening lately", and by absence, who has gone quiet.
 * Clicking a row deep-links to that lead's triage sheet on All Leads,
 * where the full activity history lives.
 *
 * Paged five at a time, client-side over the rows already fetched: the
 * pager costs no request, and a refresh that shortens the list clamps
 * the page back into range rather than showing an empty one.
 */
export function LeadActivityCard({
  rows,
  truncated,
  loading,
  onRowClick,
}: {
  rows: ActivityRow[];
  truncated: boolean;
  loading: boolean;
  onRowClick: (row: ActivityRow) => void;
}) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(rows.length / ACTIVITY_PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const first = current * ACTIVITY_PAGE_SIZE;
  const visible = rows.slice(first, first + ACTIVITY_PAGE_SIZE);
  return (
    <Card className="overflow-hidden bg-white py-0 gap-0">
      <CardHeader className="py-4 border-b bg-white">
        <div className="flex items-baseline justify-between gap-3">
          <div className="flex items-baseline gap-3">
            <CardTitle className="text-sm font-semibold text-muted-foreground">
              Recent Lead Activity
            </CardTitle>
            <span className="text-xs tabular-nums text-muted-foreground">
              ({rows.length}
              {truncated ? "+" : ""})
            </span>
          </div>
          <Link
            href="/admin/all-leads"
            className="text-xs text-primary hover:underline"
          >
            All leads
          </Link>
        </div>
      </CardHeader>
      <CardContent className="bg-white px-3 pb-3">
        {loading ? (
          <div className="space-y-2 p-1 pt-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full rounded-md" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm italic text-muted-foreground">
            No notes or texts logged on any lead yet.
          </p>
        ) : (
          <Table className="table-fixed">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[20%] text-[10px] text-muted-foreground">
                  Lead
                </TableHead>
                <TableHead className="w-[12%] text-[10px] text-muted-foreground">
                  Rating
                </TableHead>
                <TableHead className="w-[14%] text-[10px] text-muted-foreground">
                  Activity
                </TableHead>
                <TableHead className="w-[32%] text-[10px] text-muted-foreground">
                  Detail
                </TableHead>
                <TableHead className="w-[12%] text-[10px] text-muted-foreground">
                  By
                </TableHead>
                <TableHead className="w-[10%] text-right text-[10px] text-muted-foreground">
                  When
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((r) => (
                <TableRow
                  key={r.key}
                  onClick={() => onRowClick(r)}
                  className="cursor-pointer"
                >
                  <TableCell className="text-sm font-medium">
                    <span className="block truncate" title={r.name}>
                      {r.name}
                    </span>
                  </TableCell>
                  <TableCell>
                    {/* Read-only conversion stars (no onChange) — rate
                        from the sheet the row opens, not the table. */}
                    <StarRating value={r.rating} />
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
                      {activityIcon(r.kind)}
                      {r.label}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span
                      className="block truncate text-sm text-muted-foreground"
                      title={r.body}
                    >
                      {r.body || "—"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="block truncate text-xs text-muted-foreground">
                      {r.author || "—"}
                    </span>
                  </TableCell>
                  <TableCell
                    className="text-right text-xs tabular-nums text-muted-foreground"
                    title={new Date(r.ts).toLocaleString()}
                  >
                    {formatRelativeShort(r.ts)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {!loading && rows.length > ACTIVITY_PAGE_SIZE ? (
          <div className="flex items-center justify-between border-t px-2 pt-2 text-xs tabular-nums text-muted-foreground">
            <span>
              {first + 1}–{first + visible.length} of {rows.length}
              {truncated ? "+" : ""}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="Previous page"
                disabled={current === 0}
                onClick={() => setPage(current - 1)}
                className="rounded-md border p-1 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronLeft className="size-3.5" />
              </button>
              <span className="px-1">
                {current + 1} / {pageCount}
              </span>
              <button
                type="button"
                aria-label="Next page"
                disabled={current >= pageCount - 1}
                onClick={() => setPage(current + 1)}
                className="rounded-md border p-1 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronRight className="size-3.5" />
              </button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

"use client";

import Link from "next/link";
import { Inbox, MessageSquareText, NotebookPen } from "lucide-react";
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
import { cn } from "@/lib/utils";
import type { UnreadMessagesResponse } from "@/app/api/admin/messages/unread/route";
import type { LeadActivityResponse } from "@/app/api/admin/lead-activity/route";

type ActivityRow = LeadActivityResponse["rows"][number];

/* ──────────────────── Unread messages ──────────────────── */

/**
 * Threads whose newest message is inbound — parents waiting on a
 * reply.
 *
 * Deliberately the SERVER half of "unread" only: the per-browser
 * viewed state that grays the inbox dots isn't consulted here,
 * because on a dashboard a thread you've read but not answered is
 * still outstanding work.
 */
export function UnreadMessagesCard({
  rows,
  loading,
}: {
  rows: UnreadMessagesResponse["conversations"];
  loading: boolean;
}) {
  const sorted = [...rows].sort((a, b) => b.lastAt - a.lastAt);
  return (
    <Card className="overflow-hidden bg-white py-0 gap-0">
      <CardHeader className="py-4 border-b bg-white">
        <div className="flex items-baseline justify-between gap-3">
          <div className="flex items-baseline gap-3">
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Needs a reply
            </CardTitle>
            <span className="text-xs tabular-nums text-muted-foreground">
              ({sorted.length})
            </span>
          </div>
          <Link
            href="/admin/messages"
            className="text-xs text-primary hover:underline"
          >
            Open inbox
          </Link>
        </div>
      </CardHeader>
      <CardContent className="bg-white p-0">
        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full rounded-md" />
            ))}
          </div>
        ) : sorted.length === 0 ? (
          <div className="px-6 py-10 text-center">
            <Inbox className="mx-auto mb-2 size-6 text-muted-foreground/50" />
            <p className="text-sm font-medium">Nothing waiting on you</p>
            <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
              Every text thread has been answered. New replies show up
              here.
            </p>
          </div>
        ) : (
          <ul className="divide-y">
            {sorted.map((c) => (
              <li key={c.key}>
                <Link
                  href="/admin/messages"
                  className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
                >
                  <span
                    className="mt-1.5 size-2 shrink-0 rounded-full bg-blue-500"
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-medium">
                        {c.name}
                      </span>
                      <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                        {formatRelativeShort(c.lastAt)}
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {c.preview || "(no message text)"}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/* ──────────────────── Lead activity ──────────────────── */

/** Icon per activity kind, so the stream is scannable without reading
 *  every label. Inbound texts get the accent — they're the ones that
 *  might need an answer. */
function activityIcon(kind: ActivityRow["kind"]) {
  if (kind === "note") {
    return <NotebookPen className="size-3.5 text-muted-foreground" />;
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
 * Newest notes + texts across every recruitment lead, merged into one
 * stream — "what's happened lately", and by absence, who has gone
 * quiet. Clicking a row deep-links to that lead's triage sheet on All
 * Leads.
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
  return (
    <Card className="overflow-hidden bg-white py-0 gap-0">
      <CardHeader className="py-4 border-b bg-white">
        <div className="flex items-baseline justify-between gap-3">
          <div className="flex items-baseline gap-3">
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Recent lead activity
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
                <TableHead className="w-[22%] text-[10px] uppercase tracking-wider text-muted-foreground">
                  Lead
                </TableHead>
                <TableHead className="w-[16%] text-[10px] uppercase tracking-wider text-muted-foreground">
                  Activity
                </TableHead>
                <TableHead className="w-[38%] text-[10px] uppercase tracking-wider text-muted-foreground">
                  Detail
                </TableHead>
                <TableHead className="w-[14%] text-[10px] uppercase tracking-wider text-muted-foreground">
                  By
                </TableHead>
                <TableHead className="w-[10%] text-right text-[10px] uppercase tracking-wider text-muted-foreground">
                  When
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
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
      </CardContent>
    </Card>
  );
}

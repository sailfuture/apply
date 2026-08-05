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
import { StarRating } from "@/components/admin/star-rating";
import { useSmsViewedMap } from "@/components/admin/messages-unread-badge";
import { cn } from "@/lib/utils";
import type { UnreadMessagesResponse } from "@/app/api/admin/messages/unread/route";
import type { LeadActivityResponse } from "@/app/api/admin/lead-activity/route";

type ActivityRow = LeadActivityResponse["rows"][number];

/* ──────────────────── Unread messages ──────────────────── */

/**
 * Threads whose newest message is inbound — parents waiting on a
 * reply.
 *
 * Uses BOTH halves of "unread", exactly like the inbox list and the
 * nav badge: the server half (newest message is inbound) picks the
 * rows, and the per-browser viewed map decides blue ("Needs reply")
 * vs gray ("Viewed") — so this card, the badge count, and the inbox
 * dots can never disagree. Viewed-but-unanswered threads stay listed
 * (they're still outstanding work) but grayed and below the new ones.
 * Each row deep-links to its own thread via `?open=<key>`.
 */
export function UnreadMessagesCard({
  rows,
  loading,
}: {
  rows: UnreadMessagesResponse["conversations"];
  loading: boolean;
}) {
  const viewed = useSmsViewedMap();
  const isUnviewed = (c: UnreadMessagesResponse["conversations"][number]) =>
    (viewed[c.key] ?? 0) < c.lastAt;
  const sorted = [...rows].sort((a, b) => {
    const av = isUnviewed(a) ? 0 : 1;
    const bv = isUnviewed(b) ? 0 : 1;
    return av !== bv ? av - bv : b.lastAt - a.lastAt;
  });
  const unviewedCount = sorted.filter(isUnviewed).length;
  const viewedCount = sorted.length - unviewedCount;
  return (
    <Card className="overflow-hidden bg-white py-0 gap-0">
      <CardHeader className="py-4 border-b bg-white">
        <div className="flex items-baseline justify-between gap-3">
          <div className="flex items-baseline gap-3">
            <CardTitle className="text-sm font-semibold text-muted-foreground">
              Needs a Reply
            </CardTitle>
            {/* The headline number matches the nav badge (new only);
                viewed-but-unanswered threads are counted separately so
                the two surfaces never appear to disagree. */}
            <span className="text-xs tabular-nums text-muted-foreground">
              ({unviewedCount}
              {viewedCount > 0 ? ` new · ${viewedCount} viewed` : ""})
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
            {sorted.map((c) => {
              const unviewedRow = isUnviewed(c);
              return (
                <li key={c.key}>
                  <Link
                    href={`/admin/messages?open=${encodeURIComponent(c.key)}`}
                    className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
                  >
                    {/* Same dot vocabulary as the inbox list: blue =
                        needs reply, gray = viewed but unanswered. */}
                    <span
                      className={cn(
                        "mt-1.5 size-2 shrink-0 rounded-full",
                        unviewedRow ? "bg-blue-500" : "bg-slate-300"
                      )}
                      aria-label={unviewedRow ? "Needs reply" : "Viewed"}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span
                          className={cn(
                            "truncate text-sm",
                            unviewedRow
                              ? "font-medium"
                              : "text-muted-foreground"
                          )}
                        >
                          {c.name}
                        </span>
                        <span className="flex shrink-0 items-baseline gap-2">
                          {!unviewedRow ? (
                            <span className="text-[10px] text-muted-foreground">
                              Viewed
                            </span>
                          ) : null}
                          <span className="text-[10px] tabular-nums text-muted-foreground">
                            {formatRelativeShort(c.lastAt)}
                          </span>
                        </span>
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {c.preview || "(no message text)"}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
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
      </CardContent>
    </Card>
  );
}

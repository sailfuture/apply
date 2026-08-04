"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import {
  Check,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
} from "lucide-react";
import { DataTable, type ColumnDef } from "@/components/admin/data-table";
import { LeadTriageSheet } from "@/components/admin/lead-triage";
import { StarRating } from "@/components/admin/star-rating";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { adminFetcher } from "@/lib/admin-fetcher";
import { formatUSPhone } from "@/lib/phone";
import {
  copyTascoSummerVisitsTable,
  downloadTascoSummerVisitsCsv,
} from "@/lib/tasco-summer-visits-export";
import type { TascoSummerVisitRow } from "@/app/api/admin/tasco-summer-visits/route";

/**
 * TASCO Summer Visits — recruitment leads captured at St. Pete
 * recreation centers over the summer. Rows arrive newest-first from
 * `/api/admin/tasco-summer-visits`, each with its recreation center
 * normalized (the raw free-text field spells the same center several
 * ways; see the route).
 *
 * Shape follows the Campus Visits page: one filter select, a search
 * box lifted out of the DataTable so Copy / Export act on exactly
 * what's on screen, and single-line cells.
 */
export default function TascoSummerVisitsPage() {
  const { data, isLoading, error, mutate } = useSWR<TascoSummerVisitRow[]>(
    "/api/admin/tasco-summer-visits",
    adminFetcher,
    { refreshInterval: 60_000 }
  );
  const rows = useMemo(() => (Array.isArray(data) ? data : []), [data]);

  // Center options come from the data itself (normalized labels),
  // alphabetical so the dropdown is scannable.
  const centerOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const r of rows) {
      if (r.recreation_center) seen.add(r.recreation_center);
    }
    return [...seen].sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const [center, setCenter] = useState<string>("all");
  const visible = useMemo(
    () =>
      center === "all"
        ? rows
        : rows.filter((r) => r.recreation_center === center),
    [rows, center]
  );

  // Search is lifted out of the DataTable (via `externalSearch`) so the
  // Copy / Export actions can operate on exactly what's on screen —
  // otherwise they'd silently ignore the search box and hand back rows
  // the user had already filtered away. The fields listed here mirror
  // the `searchable` columns below so the counts always agree.
  const [search, setSearch] = useState("");
  const exportRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return visible;
    return visible.filter((r) =>
      [
        r.student_name,
        r.current_school,
        r.recreation_center,
        r.parent_email,
        r.parent_phone,
      ].some((v) => (v ?? "").toLowerCase().includes(q))
    );
  }, [visible, search]);

  const [copied, setCopied] = useState(false);
  const [selected, setSelected] = useState<TascoSummerVisitRow | null>(null);
  // Re-read the clicked row from the list so the sheet reflects
  // rating / follow-up / note writes after revalidation.
  const activeRow = selected
    ? (rows.find((r) => r.id === selected.id) ?? selected)
    : null;

  // Inline star write — same endpoint every lead surface uses.
  async function setRating(row: TascoSummerVisitRow, rating: number) {
    try {
      mutate(
        (curr) =>
          (curr ?? []).map((r) => (r.id === row.id ? { ...r, rating } : r)),
        { revalidate: false }
      );
      const res = await fetch("/api/admin/leads", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "tasco",
          id: row.id,
          interest_level: rating,
        }),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      mutate();
    } catch (err) {
      console.error("Failed to save TASCO rating:", err);
      toast.error("Couldn't save the rating.");
      mutate();
    }
  }

  function handleExport() {
    if (exportRows.length === 0) {
      toast.error("Nothing to export.");
      return;
    }
    downloadTascoSummerVisitsCsv(
      exportRows,
      center === "all" ? "all-centers" : center
    );
    toast.success(
      `Exported ${exportRows.length} visit${exportRows.length === 1 ? "" : "s"} to CSV.`
    );
  }

  async function handleCopy() {
    if (exportRows.length === 0) {
      toast.error("Nothing to copy.");
      return;
    }
    try {
      await copyTascoSummerVisitsTable(exportRows);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success(
        `Copied ${exportRows.length} visit${exportRows.length === 1 ? "" : "s"} to the clipboard.`
      );
    } catch (err) {
      console.error("[TascoSummerVisits.handleCopy]", err);
      toast.error("Couldn't copy to the clipboard.");
    }
  }

  // Defined inline (not memoized) — the rating cell's closure needs
  // `setRating`'s latest SWR bindings.
  const columns: ColumnDef<TascoSummerVisitRow>[] = [
      {
        key: "rating",
        header: "Rating",
        sortable: true,
        width: "w-[10%]",
        accessor: (r) => r.rating,
        render: (r) => (
          <StarRating
            value={r.rating}
            onChange={(v) => void setRating(r, v)}
          />
        ),
      },
      {
        key: "submitted_ts",
        header: "Submitted",
        sortable: true,
        width: "w-[8%]",
        render: (r) => (
          <span
            className="whitespace-nowrap text-sm tabular-nums text-muted-foreground"
            title={new Date(r.submitted_ts).toLocaleString()}
          >
            {relTime(r.submitted_ts)}
          </span>
        ),
      },
      {
        key: "student_name",
        header: "Student",
        sortable: true,
        searchable: true,
        width: "w-[16%]",
        render: (r) => (
          <span className="block truncate text-sm font-medium">
            {r.student_name || "—"}
          </span>
        ),
      },
      {
        key: "current_grade",
        header: "Grade",
        sortable: true,
        width: "w-[8%]",
        render: (r) => (
          <span className="whitespace-nowrap text-sm">
            {r.current_grade || "—"}
          </span>
        ),
      },
      {
        key: "current_school",
        header: "Current School",
        sortable: true,
        searchable: true,
        width: "w-[16%]",
        render: (r) => (
          <span className="block truncate text-sm" title={r.current_school}>
            {r.current_school || "—"}
          </span>
        ),
      },
      {
        key: "recreation_center",
        header: "Rec Center",
        sortable: true,
        searchable: true,
        width: "w-[16%]",
        render: (r) => (
          <span
            className="block truncate text-sm"
            // Surface the original text when it differs from the
            // normalized label, so admin can see what was written.
            title={
              r.recreation_center_raw &&
              r.recreation_center_raw !== r.recreation_center
                ? `Entered as: ${r.recreation_center_raw}`
                : r.recreation_center
            }
          >
            {r.recreation_center || "—"}
          </span>
        ),
      },
      {
        key: "parent_phone",
        header: "Phone",
        searchable: true,
        width: "w-[12%]",
        render: (r) =>
          r.parent_phone ? (
            <a
              href={`tel:${r.parent_phone}`}
              className="text-sm tabular-nums hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              {formatUSPhone(r.parent_phone) || r.parent_phone}
            </a>
          ) : (
            <span className="text-sm text-muted-foreground">—</span>
          ),
      },
      {
        key: "parent_email",
        header: "Email",
        sortable: true,
        searchable: true,
        width: "w-[14%]",
        render: (r) =>
          r.parent_email ? (
            <a
              href={`mailto:${r.parent_email}`}
              className="block truncate text-sm hover:underline"
              title={r.parent_email}
              onClick={(e) => e.stopPropagation()}
            >
              {r.parent_email}
            </a>
          ) : (
            <span className="text-sm text-muted-foreground">—</span>
          ),
      },
      {
        key: "marketing_opt_in",
        header: "Marketing",
        width: "w-[7%]",
        accessor: (r) => (r.marketing_opt_in ? 1 : 0),
        render: (r) =>
          r.marketing_opt_in ? (
            <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
              Opted in
            </Badge>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          ),
      },
      {
        key: "followed_up",
        header: "Follow-up",
        sortable: true,
        width: "w-[9%]",
        accessor: (r) => (r.followed_up ? 1 : 0),
        render: (r) =>
          r.followed_up ? (
            <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
              Followed up
            </Badge>
          ) : (
            <span
              className="text-xs text-muted-foreground"
              title={
                r.last_reach_out
                  ? `Last contacted ${new Date(r.last_reach_out).toLocaleString()}`
                  : undefined
              }
            >
              {r.last_reach_out ? relTime(r.last_reach_out) : "Needs"}
            </span>
          ),
      },
      {
        key: "chevron",
        header: "",
        width: "w-[36px]",
        align: "right",
        render: () => (
          <ChevronRight className="size-4 text-muted-foreground inline" />
        ),
      },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">TASCO Summer Visits</h1>
          <p className="text-sm text-muted-foreground">
            Students who signed up during summer visits to St. Pete
            recreation centers.
          </p>
        </div>
        {/* Public sign-up form — staff open this on a tablet at a rec
            center, so it belongs beside the page title, not buried. */}
        <Button asChild variant="outline" className="bg-white">
          <a
            href="https://www.sailfutureacademy.org/tasco-summer-visit"
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink className="size-4" />
            Open sign-up form
          </a>
        </Button>
      </div>

      <Card className="overflow-hidden bg-white py-0 gap-0">
        <CardHeader className="py-4 border-b bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-base">
              Sign-ups
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {exportRows.length}
                {center === "all" ? "" : ` at ${center}`}
              </span>
            </CardTitle>
            {/* Center filter sits with the search + row actions it
                works alongside; Copy / Export act on exactly the rows
                these filters leave on screen. */}
            <div className="flex flex-wrap items-center gap-2">
              <Select value={center} onValueChange={setCenter}>
                <SelectTrigger className="h-9 w-full bg-white sm:w-56">
                  <SelectValue placeholder="Recreation center" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All centers</SelectItem>
                  {centerOptions.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                placeholder="Search by student, school, center, or contact…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-9 w-full sm:w-72"
              />
              <Button
                variant="outline"
                onClick={() => void handleCopy()}
                disabled={exportRows.length === 0}
                className="bg-white"
              >
                {copied ? (
                  <Check className="size-4" />
                ) : (
                  <Copy className="size-4" />
                )}
                {copied ? "Copied" : "Copy table"}
              </Button>
              <Button
                variant="outline"
                onClick={handleExport}
                disabled={exportRows.length === 0}
                className="bg-white"
              >
                <Download className="size-4" />
                Export CSV
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-4 bg-white">
          {error && !data ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              Couldn&rsquo;t load TASCO summer visits. Refresh to try again.
            </div>
          ) : (
            <DataTable<TascoSummerVisitRow>
              columns={columns}
              data={visible}
              isLoading={isLoading && !data}
              externalSearch={search}
              onRowClick={(r) => setSelected(r)}
            />
          )}
        </CardContent>
      </Card>

      {/* Triage sheet — rating, follow-up, and the comms log for this
          sign-up. Same surface every recruitment list uses. */}
      {activeRow ? (
        <LeadTriageSheet
          open
          onOpenChange={(o) => !o && setSelected(null)}
          scope={{ source: "tasco", id: activeRow.id }}
          title={activeRow.student_name || `TASCO sign-up #${activeRow.id}`}
          subtitle={[
            activeRow.recreation_center || null,
            activeRow.current_grade || null,
            formatUSPhone(activeRow.parent_phone) || null,
          ]
            .filter(Boolean)
            .join(" · ")}
          rating={activeRow.rating}
          isFollowedUp={activeRow.followed_up}
          lastReachOut={activeRow.last_reach_out || null}
          onChanged={() => void mutate()}
        />
      ) : null}
    </div>
  );
}

/** Compact relative time ("now", "5m ago", "3h ago", "4d ago", then a
 *  date) — same vocabulary as the other recruitment lists. */
function relTime(ts: number): string {
  if (!ts) return "—";
  const diff = Date.now() - ts;
  const MIN = 60_000;
  const HOUR = 3_600_000;
  const DAY = 86_400_000;
  if (diff < MIN) return "now";
  if (diff < HOUR) return `${Math.floor(diff / MIN)}m ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`;
  if (diff < 30 * DAY) return `${Math.floor(diff / DAY)}d ago`;
  return new Date(ts).toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

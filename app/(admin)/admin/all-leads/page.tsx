"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { ChevronRight, Star } from "lucide-react";
import { DataTable, type ColumnDef } from "@/components/admin/data-table";
import { LeadTriageSheet } from "@/components/admin/lead-triage";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StarRating } from "@/components/admin/star-rating";
import { adminFetcher } from "@/lib/admin-fetcher";
import { formatUSPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";
import type {
  AllLeadRow,
  LeadSource,
} from "@/app/api/admin/all-leads/route";

/** Source chip vocabulary — mirrors the messaging composer's labels so
 *  the two surfaces speak the same language. */
const SOURCE_META: Record<LeadSource, { label: string }> = {
  inquiry: { label: "Inquiry" },
  camp: { label: "Summer Camp" },
  visit: { label: "Liability Waiver Visit" },
  tasco: { label: "TASCO" },
};

const SOURCE_FILTERS: LeadSource[] = ["inquiry", "camp", "visit", "tasco"];

/**
 * All Leads — the four recruitment sources (website inquiries, summer
 * camp, liability-waiver visits, TASCO summer visits) flattened into
 * one list. Every lead takes a 1–5 conversion-likelihood star rating
 * inline (stored on its own source table's `interest_level`), and the
 * list filters by source and minimum rating; sort any column to rank.
 */
export default function AllLeadsPage() {
  const { data, isLoading, error, mutate } = useSWR<AllLeadRow[]>(
    "/api/admin/all-leads",
    adminFetcher,
    { refreshInterval: 60_000 }
  );
  const rows = useMemo(() => (Array.isArray(data) ? data : []), [data]);

  const [sourceFilter, setSourceFilter] = useState<LeadSource[]>([]);
  const [minRating, setMinRating] = useState(0);
  // null = no follow-up filter; false = needs follow-up; true = done.
  const [followUpFilter, setFollowUpFilter] = useState<boolean | null>(null);
  const [selected, setSelected] = useState<AllLeadRow | null>(null);

  const visible = useMemo(
    () =>
      rows.filter((r) => {
        if (sourceFilter.length > 0 && !sourceFilter.includes(r.source)) {
          return false;
        }
        if (minRating > 0 && r.rating < minRating) return false;
        if (followUpFilter !== null && r.followed_up !== followUpFilter) {
          return false;
        }
        return true;
      }),
    [rows, sourceFilter, minRating, followUpFilter]
  );

  // Keep the open sheet's snapshot fresh after a rating/follow-up/note
  // write revalidates the list.
  const activeRow = selected
    ? (rows.find((r) => r.key === selected.key) ?? selected)
    : null;

  // Rate a lead with an optimistic mutate so the stars fill in
  // immediately; a failed write re-fetches authoritative data. The
  // write routes to the lead's own source table.
  async function setRating(row: AllLeadRow, rating: number) {
    try {
      mutate(
        (curr) =>
          (curr ?? []).map((r) =>
            r.key === row.key ? { ...r, rating } : r
          ),
        { revalidate: false }
      );
      const res = await fetch("/api/admin/leads", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: row.source,
          id: row.id,
          interest_level: rating,
        }),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      mutate();
    } catch (err) {
      console.error("Failed to save lead rating:", err);
      toast.error("Couldn't save the rating.");
      mutate();
    }
  }

  // Defined inline (not memoized) like the other recruitment lists —
  // the render closures need `setRating`'s latest SWR bindings.
  const columns: ColumnDef<AllLeadRow>[] = [
      {
        // Rating first — this page exists to triage, so the action
        // column leads. Sorts rated-first.
        key: "rating",
        header: "Rating",
        sortable: true,
        width: "w-[12%]",
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
        accessor: (r) => r.submitted_ts,
        render: (r) => (
          <span
            className="whitespace-nowrap text-sm tabular-nums text-muted-foreground"
            title={
              r.submitted_ts
                ? new Date(r.submitted_ts).toLocaleString()
                : undefined
            }
          >
            {relTime(r.submitted_ts)}
          </span>
        ),
      },
      {
        key: "source",
        header: "Source",
        sortable: true,
        width: "w-[13%]",
        accessor: (r) => SOURCE_META[r.source].label,
        render: (r) => (
          <Badge variant="outline" className="font-medium">
            {SOURCE_META[r.source].label}
          </Badge>
        ),
      },
      {
        key: "student_name",
        header: "Student",
        sortable: true,
        searchable: true,
        width: "w-[13%]",
        render: (r) => (
          <span className="block truncate text-sm font-medium">
            {r.student_name || "—"}
          </span>
        ),
      },
      {
        key: "grade",
        header: "Grade",
        sortable: true,
        width: "w-[7%]",
        render: (r) => (
          <span className="block truncate text-sm" title={r.grade}>
            {r.grade || "—"}
          </span>
        ),
      },
      {
        key: "parent_name",
        header: "Parent",
        sortable: true,
        searchable: true,
        width: "w-[11%]",
        render: (r) => (
          <span className="block truncate text-sm">
            {r.parent_name || "—"}
          </span>
        ),
      },
      {
        key: "phone",
        header: "Phone",
        searchable: true,
        width: "w-[10%]",
        render: (r) =>
          r.phone ? (
            <a
              href={`tel:${r.phone}`}
              className="text-sm tabular-nums hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              {formatUSPhone(r.phone) || r.phone}
            </a>
          ) : (
            <span className="text-sm text-muted-foreground">—</span>
          ),
      },
      {
        key: "email",
        header: "Email",
        sortable: true,
        searchable: true,
        width: "w-[13%]",
        render: (r) =>
          r.email ? (
            <a
              href={`mailto:${r.email}`}
              className="block truncate text-sm hover:underline"
              title={r.email}
              onClick={(e) => e.stopPropagation()}
            >
              {r.email}
            </a>
          ) : (
            <span className="text-sm text-muted-foreground">—</span>
          ),
      },
      {
        key: "school",
        header: "School",
        sortable: true,
        searchable: true,
        width: "w-[13%]",
        render: (r) => (
          <span className="block truncate text-sm" title={r.school}>
            {r.school || "—"}
          </span>
        ),
      },
      {
        // Source-specific annotation — rec center, camp attendance,
        // inquiry lifecycle.
        key: "detail",
        header: "Detail",
        sortable: true,
        searchable: true,
        width: "w-[9%]",
        render: (r) => (
          <span
            className="block truncate text-xs text-muted-foreground"
            title={r.detail}
          >
            {r.detail || "—"}
          </span>
        ),
      },
      {
        // Follow-up state + when we last logged contact — the two
        // facts that decide who to call next.
        key: "followed_up",
        header: "Follow-up",
        sortable: true,
        width: "w-[9%]",
        accessor: (r) => (r.followed_up ? 1 : 0),
        render: (r) => (
          <span className="block">
            {r.followed_up ? (
              <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
                Followed up
              </Badge>
            ) : (
              <span className="text-xs text-muted-foreground">Needs</span>
            )}
          </span>
        ),
      },
      {
        key: "last_reach_out",
        header: "Last contact",
        sortable: true,
        width: "w-[8%]",
        accessor: (r) => r.last_reach_out,
        render: (r) => (
          <span
            className="whitespace-nowrap text-xs tabular-nums text-muted-foreground"
            title={
              r.last_reach_out
                ? new Date(r.last_reach_out).toLocaleString()
                : undefined
            }
          >
            {r.last_reach_out ? relTime(r.last_reach_out) : "—"}
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
      <div>
        <h1 className="text-2xl font-bold">All Leads</h1>
        <p className="text-sm text-muted-foreground">
          Every recruitment lead in one list — website inquiries, summer
          camp, liability waiver visits, and TASCO summer visits. Rate
          each lead 1–5 stars on likelihood of conversion; click a row
          to log a call and mark it followed up.
        </p>
      </div>

      {/* Source + rating filter chips — empty selection = everything. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Source
        </span>
        {SOURCE_FILTERS.map((s) => {
          const on = sourceFilter.includes(s);
          return (
            <button
              key={s}
              type="button"
              aria-pressed={on}
              onClick={() =>
                setSourceFilter((prev) =>
                  prev.includes(s)
                    ? prev.filter((x) => x !== s)
                    : [...prev, s]
                )
              }
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
                on
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-white text-muted-foreground hover:border-foreground/40 hover:text-foreground"
              )}
            >
              {SOURCE_META[s].label}
            </button>
          );
        })}
        <span className="mx-1 h-4 w-px bg-border" aria-hidden />
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Rating
        </span>
        {[1, 2, 3, 4, 5].map((n) => {
          const on = minRating === n;
          return (
            <button
              key={n}
              type="button"
              aria-pressed={on}
              onClick={() => setMinRating(on ? 0 : n)}
              className={cn(
                "inline-flex items-center gap-0.5 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
                on
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-white text-muted-foreground hover:border-foreground/40 hover:text-foreground"
              )}
              title={`Rated ${n}${n < 5 ? " or more" : ""} stars`}
            >
              {n}
              <Star
                className={cn(
                  "size-3",
                  on ? "fill-background" : "fill-amber-400 text-amber-400"
                )}
              />
              {n < 5 ? "+" : ""}
            </button>
          );
        })}
        <span className="mx-1 h-4 w-px bg-border" aria-hidden />
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Follow-up
        </span>
        {[
          { value: false, label: "Needs follow-up" },
          { value: true, label: "Followed up" },
        ].map((f) => {
          const on = followUpFilter === f.value;
          return (
            <button
              key={String(f.value)}
              type="button"
              aria-pressed={on}
              onClick={() => setFollowUpFilter(on ? null : f.value)}
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
                on
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-white text-muted-foreground hover:border-foreground/40 hover:text-foreground"
              )}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      <Card className="overflow-hidden bg-white py-0 gap-0">
        <CardHeader className="py-4 border-b bg-white">
          <CardTitle className="text-base">
            Leads
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {visible.length}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 bg-white">
          {error && !data ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              Couldn&rsquo;t load leads. Refresh to try again.
            </div>
          ) : (
            <DataTable<AllLeadRow>
              columns={columns}
              data={visible}
              isLoading={isLoading && !data}
              searchPlaceholder="Search by student, parent, school, phone, or email…"
              onRowClick={(r) => setSelected(r)}
            />
          )}
        </CardContent>
      </Card>

      {/* Triage sheet — stars, follow-up, and the comms log for the
          clicked lead, whichever source it came from. */}
      {activeRow ? (
        <LeadTriageSheet
          open
          onOpenChange={(o) => !o && setSelected(null)}
          scope={{ source: activeRow.source, id: activeRow.id }}
          title={
            activeRow.student_name ||
            activeRow.parent_name ||
            `${SOURCE_META[activeRow.source].label} #${activeRow.id}`
          }
          subtitle={[
            SOURCE_META[activeRow.source].label,
            activeRow.parent_name || null,
            formatUSPhone(activeRow.phone) || null,
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

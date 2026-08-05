"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import { ChevronRight, Loader2, Star, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef } from "@/components/admin/data-table";
import {
  LEAD_FUNNEL_META,
  LeadTriageSheet,
} from "@/components/admin/lead-triage";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { StarRating } from "@/components/admin/star-rating";
import { adminFetcher } from "@/lib/admin-fetcher";
import { formatUSPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";
import type {
  AllLeadRow,
  LeadSource,
} from "@/app/api/admin/all-leads/route";

/** Source chip vocabulary — mirrors the messaging composer's labels so
 *  the two surfaces speak the same language. `short` is the acronym
 *  the table's Source column renders (full label on hover + in the
 *  filter chips / sheet subtitle). */
const SOURCE_META: Record<LeadSource, { label: string; short: string }> = {
  inquiry: { label: "Inquiry", short: "INQ" },
  camp: { label: "Summer Camp", short: "CAMP" },
  visit: { label: "Liability Waiver Visit", short: "LWV" },
  tasco: { label: "TASCO", short: "TASCO" },
};

const SOURCE_FILTERS: LeadSource[] = ["inquiry", "camp", "visit", "tasco"];

/** Tour-state display: label + badge tint + sort rank (higher =
 *  further along). Vocabulary matches the Campus Tours tab. */
const TOUR_META: Record<
  string,
  { label: string; chip: string; rank: number }
> = {
  completed: {
    label: "Toured",
    chip: "bg-green-100 text-green-800 hover:bg-green-100",
    rank: 4,
  },
  scheduled: {
    label: "Scheduled",
    chip: "bg-sky-100 text-sky-800 hover:bg-sky-100",
    rank: 3,
  },
  no_show: {
    label: "No-show",
    chip: "bg-amber-100 text-amber-800 hover:bg-amber-100",
    rank: 2,
  },
  canceled: {
    label: "Canceled",
    chip: "bg-muted text-muted-foreground hover:bg-muted",
    rank: 1,
  },
};

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
  // null = no tour filter; "completed"/"scheduled" match that state;
  // "none" = leads with no tour on record at all.
  const [tourFilter, setTourFilter] = useState<
    "completed" | "scheduled" | "none" | null
  >(null);
  // null = no funnel filter. "converted" = any link; "applied" =
  // submitted or beyond; "enrolled" = fully enrolled; "none" = still
  // just a lead.
  const [funnelFilter, setFunnelFilter] = useState<
    "none" | "converted" | "applied" | "enrolled" | null
  >(null);
  const [selected, setSelected] = useState<AllLeadRow | null>(null);
  const [matching, setMatching] = useState(false);

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
        if (tourFilter !== null) {
          if (tourFilter === "none") {
            if (r.tour_status !== "") return false;
          } else if (r.tour_status !== tourFilter) {
            return false;
          }
        }
        if (funnelFilter !== null) {
          const rank = r.funnel_stage
            ? (LEAD_FUNNEL_META[r.funnel_stage]?.rank ?? 0)
            : 0;
          if (funnelFilter === "none" && rank !== 0) return false;
          if (funnelFilter === "converted" && rank === 0) return false;
          if (
            funnelFilter === "applied" &&
            rank < LEAD_FUNNEL_META.applied.rank
          ) {
            return false;
          }
          if (funnelFilter === "enrolled" && r.funnel_stage !== "enrolled") {
            return false;
          }
        }
        return true;
      }),
    [rows, sourceFilter, minRating, followUpFilter, tourFilter, funnelFilter]
  );

  // Funnel rollup over the WHOLE lead pool (not the filtered view) —
  // the strip answers "how is recruitment converting overall".
  const funnel = useMemo(() => {
    const appliedRank = LEAD_FUNNEL_META.applied.rank;
    let converted = 0;
    let applied = 0;
    let enrolled = 0;
    for (const r of rows) {
      const rank = r.funnel_stage
        ? (LEAD_FUNNEL_META[r.funnel_stage]?.rank ?? 0)
        : 0;
      if (rank > 0) converted++;
      if (rank >= appliedRank) applied++;
      if (r.funnel_stage === "enrolled") enrolled++;
    }
    return { total: rows.length, converted, applied, enrolled };
  }, [rows]);

  // Re-run the server-side email/phone auto-match across every
  // unlinked lead. Idempotent — safe to click whenever the numbers
  // look stale (e.g. a family applied with a different email and was
  // linked by hand elsewhere, or leads arrived after the family).
  async function runAutoMatch() {
    setMatching(true);
    try {
      const res = await fetch("/api/admin/lead-conversion", {
        method: "POST",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error ?? `Auto-match failed (${res.status})`);
      }
      for (const w of data?.wiringWarnings ?? []) toast.warning(w);
      const linked = Number(data?.linked) || 0;
      toast.success(
        linked > 0
          ? `Auto-match linked ${linked} lead${linked === 1 ? "" : "s"}.`
          : "No new matches found."
      );
      mutate();
    } catch (err) {
      console.error("[AllLeads.runAutoMatch]", err);
      toast.error(
        err instanceof Error ? err.message : "Auto-match failed."
      );
    } finally {
      setMatching(false);
    }
  }

  // Keep the open sheet's snapshot fresh after a rating/follow-up/note
  // write revalidates the list.
  const activeRow = selected
    ? (rows.find((r) => r.key === selected.key) ?? selected)
    : null;

  // Deep link: `?open=<source>-<id>` opens that lead's triage sheet
  // once the rows load — the Messages inbox's "View lead" button
  // lands here. Consumed once so closing the sheet doesn't reopen it.
  const searchParams = useSearchParams();
  const openedFromUrl = useRef(false);
  useEffect(() => {
    if (openedFromUrl.current || rows.length === 0) return;
    const openParam = searchParams.get("open");
    if (!openParam) return;
    openedFromUrl.current = true;
    const row = rows.find((r) => r.key === openParam);
    if (row) setSelected(row);
  }, [rows, searchParams]);

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

  // Toggle the follow-up flag straight from the table. Same
  // optimistic shape as `setRating`. (Opt-in is deliberately NOT
  // table-togglable — consent edits go through the sheet's Edit mode.)
  async function setFollowedUp(row: AllLeadRow, value: boolean) {
    try {
      mutate(
        (curr) =>
          (curr ?? []).map((r) =>
            r.key === row.key ? { ...r, followed_up: value } : r
          ),
        { revalidate: false }
      );
      const res = await fetch("/api/admin/leads", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: row.source,
          id: row.id,
          isFollowedUp: value,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? `Save failed (${res.status})`);
      }
      mutate();
    } catch (err) {
      console.error("Failed to save lead follow-up:", err);
      toast.error(
        err instanceof Error ? err.message : "Couldn't save the change."
      );
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
        key: "student_name",
        header: "Student",
        sortable: true,
        searchable: true,
        width: "w-[14%]",
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
        width: "w-[14%]",
        // Accessor carries the CONTACT INFO too: phone + email left
        // the table (they crowded it; the row's sheet has both with
        // call / mail / copy actions), but searching by them must
        // keep working. Sorting still orders by parent name — the
        // name is the string's prefix.
        accessor: (r) => `${r.parent_name} ${r.email} ${r.phone}`,
        render: (r) => (
          <span className="block truncate text-sm">
            {r.parent_name || "—"}
          </span>
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
        key: "source",
        header: "Source",
        sortable: true,
        width: "w-[8%]",
        accessor: (r) => SOURCE_META[r.source].label,
        render: (r) => (
          <Badge
            variant="outline"
            className="whitespace-nowrap font-medium"
            title={SOURCE_META[r.source].label}
          >
            {SOURCE_META[r.source].short}
          </Badge>
        ),
      },
      {
        // Messaging/marketing consent — read-only in the table;
        // changing it requires opening the lead's sheet and clicking
        // Edit (deliberate friction on a consent flag).
        key: "opt_in",
        header: "Opt-in",
        sortable: true,
        width: "w-[7%]",
        accessor: (r) => (r.opt_in ? 1 : 0),
        render: (r) => (
          <span
            className="inline-flex"
            title={
              r.source === "camp"
                ? "Implied consent from camp sign-up"
                : "Edit from the lead's sheet"
            }
          >
            <Checkbox
              checked={r.opt_in}
              disabled
              aria-label="Messaging opt-in"
              className="disabled:opacity-100 disabled:cursor-default"
            />
          </span>
        ),
      },
      {
        // Campus-tour state — sortable so "who has toured" ranks to
        // the top; scheduling/managing tours happens in the lead's
        // sheet and on the Campus Tours tab.
        key: "tour_status",
        header: "Tour",
        sortable: true,
        width: "w-[8%]",
        accessor: (r) => TOUR_META[r.tour_status]?.rank ?? 0,
        render: (r) => {
          const meta = TOUR_META[r.tour_status];
          return meta ? (
            // nowrap + hidden overflow: a badge that doesn't fit the
            // column truncates instead of wrapping to a second line
            // and doubling the row height.
            <Badge
              className={cn(
                meta.chip,
                "max-w-full overflow-hidden whitespace-nowrap"
              )}
              title={
                r.tour_at
                  ? `${meta.label} — ${new Date(r.tour_at).toLocaleString()}`
                  : meta.label
              }
            >
              <span className="truncate">{meta.label}</span>
            </Badge>
          ) : (
            <span className="text-sm text-muted-foreground">—</span>
          );
        },
      },
      {
        // Conversion funnel stage — DERIVED server-side from the
        // lead's linked family's live application data. Sorts
        // furthest-along first so wins rank to the top.
        key: "funnel_stage",
        header: "Converted",
        sortable: true,
        width: "w-[9%]",
        accessor: (r) =>
          r.funnel_stage
            ? (LEAD_FUNNEL_META[r.funnel_stage]?.rank ?? 0)
            : 0,
        render: (r) => {
          const meta = r.funnel_stage
            ? LEAD_FUNNEL_META[r.funnel_stage]
            : null;
          return meta ? (
            <Badge
              className={cn(
                meta.chip,
                "max-w-full overflow-hidden whitespace-nowrap"
              )}
              title={
                r.converted_family_name
                  ? `${meta.label} — ${r.converted_family_name}`
                  : meta.label
              }
            >
              <span className="truncate">{meta.label}</span>
            </Badge>
          ) : (
            <span className="text-sm text-muted-foreground">—</span>
          );
        },
      },
      {
        // Follow-up state + when we last logged contact — the two
        // facts that decide who to call next.
        key: "followed_up",
        header: "Follow-up",
        sortable: true,
        width: "w-[8%]",
        accessor: (r) => (r.followed_up ? 1 : 0),
        render: (r) => (
          <span
            className="inline-flex"
            onClick={(e) => e.stopPropagation()}
            title={r.followed_up ? "Followed up" : "Needs follow-up"}
          >
            <Checkbox
              checked={r.followed_up}
              aria-label="Followed up"
              onCheckedChange={(v) =>
                void setFollowedUp(r, v === true)
              }
            />
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

      {/* Conversion funnel rollup — the whole pool, unaffected by the
          filters below. Percentages are of ALL leads, so the three
          stages read as a funnel narrowing left to right. */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap items-stretch gap-2">
          {(
            [
              { label: "Leads", value: funnel.total, pct: null },
              { label: "Converted", value: funnel.converted, pct: true },
              { label: "Applied", value: funnel.applied, pct: true },
              { label: "Enrolled", value: funnel.enrolled, pct: true },
            ] as const
          ).map((s) => (
            <div
              key={s.label}
              className="min-w-24 rounded-lg border bg-white px-3 py-2"
            >
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {s.label}
              </p>
              <p className="text-lg font-bold tabular-nums leading-tight">
                {s.value}
                {s.pct && funnel.total > 0 ? (
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                    {Math.round((s.value / funnel.total) * 100)}%
                  </span>
                ) : null}
              </p>
            </div>
          ))}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="bg-white"
          disabled={matching}
          onClick={() => void runAutoMatch()}
          title="Match unlinked leads to registration families by parent email and phone"
        >
          {matching ? (
            <Loader2 className="size-3.5 mr-1.5 animate-spin" />
          ) : (
            <Wand2 className="size-3.5 mr-1.5" />
          )}
          Run auto-match
        </Button>
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
        <span className="mx-1 h-4 w-px bg-border" aria-hidden />
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Tour
        </span>
        {(
          [
            { value: "completed", label: "Toured" },
            { value: "scheduled", label: "Tour scheduled" },
            { value: "none", label: "No tour" },
          ] as const
        ).map((f) => {
          const on = tourFilter === f.value;
          return (
            <button
              key={f.value}
              type="button"
              aria-pressed={on}
              onClick={() => setTourFilter(on ? null : f.value)}
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
        <span className="mx-1 h-4 w-px bg-border" aria-hidden />
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Converted
        </span>
        {(
          [
            { value: "none", label: "Not converted" },
            { value: "converted", label: "Converted" },
            { value: "applied", label: "Applied" },
            { value: "enrolled", label: "Enrolled" },
          ] as const
        ).map((f) => {
          const on = funnelFilter === f.value;
          return (
            <button
              key={f.value}
              type="button"
              aria-pressed={on}
              onClick={() => setFunnelFilter(on ? null : f.value)}
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
              // Keep the open lead's row tinted so it's obvious which
              // one the sheet belongs to; clears when the sheet
              // closes (`selected` back to null). Returning a value
              // takes over the row's background AND hover, so
              // unselected rows have to restate the default hover.
              rowClassName={(r) =>
                selected?.key === r.key
                  ? "bg-muted hover:bg-muted"
                  : "hover:bg-muted/50"
              }
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
            activeRow.detail || null,
          ]
            .filter(Boolean)
            .join(" · ")}
          rating={activeRow.rating}
          isFollowedUp={activeRow.followed_up}
          lastReachOut={activeRow.last_reach_out || null}
          details={{
            student_name: activeRow.student_name,
            // TASCO rows have no parent-name column — null hides the
            // input instead of offering an edit that can't save.
            parent_name:
              activeRow.source === "tasco" ? null : activeRow.parent_name,
            phone: activeRow.phone,
            email: activeRow.email,
            grade: activeRow.grade_raw,
            school: activeRow.school,
            opt_in: activeRow.opt_in,
            // Camp has no consent column — implied by sign-up.
            opt_in_editable: activeRow.source !== "camp",
          }}
          conversion={{
            family_id: activeRow.converted_family_id,
            family_name: activeRow.converted_family_name,
            stage: activeRow.funnel_stage,
            converted_at: activeRow.converted_at,
          }}
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

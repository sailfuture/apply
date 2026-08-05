"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import {
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  Loader2,
  Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { DataTable, type ColumnDef } from "@/components/admin/data-table";
import { LeadTriageSheet } from "@/components/admin/lead-triage";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
 *  filter dropdown / sheet subtitle). */
const SOURCE_META: Record<LeadSource, { label: string; short: string }> = {
  inquiry: { label: "Inquiry", short: "INQ" },
  camp: { label: "Summer Camp", short: "CAMP" },
  visit: { label: "Liability Waiver Visit", short: "LWV" },
  tasco: { label: "TASCO", short: "TASCO" },
};

const SOURCE_FILTERS: LeadSource[] = ["inquiry", "camp", "visit", "tasco"];

/**
 * Every filter trigger is the SAME fixed width, so the row never
 * reflows as selections change — picking "Liability Waiver Visit"
 * can't shove the buttons beside it around. Labels truncate inside
 * (the full text stays on the `title`) and the chevron is pinned
 * right by `justify-between` + `shrink-0`. `h-9` matches the search
 * Input's height so the whole row sits on one baseline.
 */
const FILTER_TRIGGER_CLASS = "h-9 w-40 shrink-0 justify-between bg-white";

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

/** The page's group cards, in render order — the active triage queue
 *  leads (it's the work), then the converted stages ascending so the
 *  page reads as the funnel deepening toward Enrolled. Keys match
 *  `AllLeadRow.funnel_stage`, with "active" standing in for the
 *  unconverted `""` stage. Empty groups hide entirely. */
const GROUP_DEFS = [
  {
    key: "active",
    title: "Active Leads",
    dot: "bg-sky-500",
    description: "Haven't converted yet — the working triage queue.",
  },
  {
    key: "linked",
    title: "Linked",
    dot: "bg-slate-400",
    description:
      "Matched to a family that hasn't started an application yet.",
  },
  {
    key: "started",
    title: "Application Started",
    dot: "bg-amber-500",
    description: "Converted — the family's application is still in draft.",
  },
  {
    key: "applied",
    title: "Applied",
    dot: "bg-blue-500",
    description: "Application submitted; awaiting admissions decision.",
  },
  {
    key: "accepted",
    title: "Accepted",
    dot: "bg-emerald-500",
    description: "Family approved — registration packet pending.",
  },
  {
    key: "enrolled",
    title: "Enrolled",
    dot: "bg-green-500",
    description:
      "Fully enrolled — a student's registration packet is confirmed.",
  },
  {
    key: "notInterested",
    title: "Not Interested",
    dot: "bg-red-500",
    description:
      "Family declined — the reason is on each lead's sheet, where Restore brings one back.",
  },
] as const;

type GroupKey = (typeof GROUP_DEFS)[number]["key"];

/**
 * All Leads — the four recruitment sources (website inquiries, summer
 * camp, liability-waiver visits, TASCO summer visits) flattened into
 * one page, grouped by conversion stage: the active triage queue on
 * top, then a card per funnel stage (linked → started → applied →
 * accepted → enrolled). One search box + dropdown filters drive every
 * group at once.
 */
export default function AllLeadsPage() {
  const { data, isLoading, error, mutate } = useSWR<AllLeadRow[]>(
    "/api/admin/all-leads",
    adminFetcher,
    { refreshInterval: 60_000 }
  );
  const rows = useMemo(() => (Array.isArray(data) ? data : []), [data]);

  // ONE search input drives every group card (via DataTable's
  // externalSearch); the dropdowns narrow before grouping.
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<LeadSource[]>([]);
  const [minRating, setMinRating] = useState(0);
  // null = no follow-up filter; false = needs follow-up; true = done.
  const [followUpFilter, setFollowUpFilter] = useState<boolean | null>(null);
  // null = no tour filter; "completed"/"scheduled" match that state;
  // "none" = leads with no tour on record at all.
  const [tourFilter, setTourFilter] = useState<
    "completed" | "scheduled" | "none" | null
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
        return true;
      }),
    [rows, sourceFilter, minRating, followUpFilter, tourFilter]
  );

  // Split the filtered rows into the funnel group cards. A real
  // conversion link outranks a "not interested" mark (linking means
  // the family demonstrably applied); declined-and-unconverted rows
  // drop out of Active Leads into their own card at the bottom.
  const groups = useMemo(() => {
    const out: Record<GroupKey, AllLeadRow[]> = {
      active: [],
      linked: [],
      started: [],
      applied: [],
      accepted: [],
      enrolled: [],
      notInterested: [],
    };
    for (const r of visible) {
      const key: GroupKey =
        r.funnel_stage !== ""
          ? (r.funnel_stage as GroupKey)
          : r.lead_status === "not_interested"
            ? "notInterested"
            : "active";
      (out[key] ?? out.active).push(r);
    }
    return out;
  }, [visible]);

  // Rollup over the WHOLE lead pool (not the filtered view) — every
  // figure counts LEADS, so the four read against one denominator.
  const funnel = useMemo(() => {
    let converted = 0;
    let toured = 0;
    let notInterested = 0;
    for (const r of rows) {
      if (r.funnel_stage !== "") converted++;
      // COMPLETED tours only — a booking that was canceled, no-showed,
      // or is still upcoming isn't a tour that happened. `tour_status`
      // is already the best of that lead's tours, and "completed"
      // outranks every other state, so this catches any lead who has
      // toured at least once.
      if (r.tour_status === "completed") toured++;
      if (r.lead_status === "not_interested") notInterested++;
    }
    return { total: rows.length, converted, toured, notInterested };
  }, [rows]);

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
  // Every column carries a width so the group cards' tables line up
  // vertically down the page (same trick as the applications list).
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
        width: "w-[15%]",
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
        width: "w-[15%]",
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
              <span className="min-w-0 truncate">{meta.label}</span>
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

  // First load: skeleton the whole page rather than showing real
  // chrome around zeroes — the stat cards would otherwise read "0
  // leads" for a beat, which is a wrong answer, not a loading state.
  // (A revalidation with data already in hand falls through to the
  // normal render, so refreshes never flash the skeleton.)
  if (isLoading && !data && !error) {
    return (
      <div className="p-6 space-y-6">
        <AllLeadsIntro />
        <AllLeadsSkeleton />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <AllLeadsIntro />

      {/* Rollup over the whole pool, unaffected by the filters below.
          Every card counts LEADS against one denominator; bare counts
          (percentages came off by user request). Tours links out to
          the Campus Tours page. */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {(
          [
            {
              label: "Leads",
              value: funnel.total,
              hint: "All four recruitment sources",
              href: null,
            },
            {
              label: "Converted",
              value: funnel.converted,
              hint: "Linked to an applying family",
              href: null,
            },
            {
              label: "Tours",
              value: funnel.toured,
              hint: "Leads who completed a tour",
              href: "/admin/campus-tours",
            },
            {
              label: "Not Interested",
              value: funnel.notInterested,
              hint: "Declined — reason on each lead",
              href: null,
            },
          ] as const
        ).map((s) => {
          const body = (
            <>
              <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {s.label}
                {s.href ? <ArrowUpRight className="size-3" /> : null}
              </p>
              <p className="mt-1 text-3xl font-bold tabular-nums leading-tight">
                {s.value.toLocaleString()}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{s.hint}</p>
            </>
          );
          return s.href ? (
            <Link
              key={s.label}
              href={s.href}
              className="rounded-lg border bg-white px-4 py-4 transition-colors hover:border-foreground/30 hover:bg-muted/30"
              title="Open Campus Tours"
            >
              {body}
            </Link>
          ) : (
            <div key={s.label} className="rounded-lg border bg-white px-4 py-4">
              {body}
            </div>
          );
        })}
      </div>

      {/* One search + dropdown filters, spanning the same width as the
          group cards below. Each dropdown's trigger echoes its active
          selection so a narrowed list is never a mystery. */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by student, parent, school, phone, or email…"
          className="min-w-64 flex-1 bg-white"
        />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={cn(
                FILTER_TRIGGER_CLASS,
                sourceFilter.length > 0 && "border-foreground"
              )}
              title={
                sourceFilter.length === 0
                  ? "Filter by lead source"
                  : sourceFilter.map((s) => SOURCE_META[s].label).join(", ")
              }
            >
              <span className="min-w-0 truncate">
                {sourceFilter.length === 0
                  ? "Source"
                  : sourceFilter.length === 1
                    ? SOURCE_META[sourceFilter[0]].label
                    : `Source (${sourceFilter.length})`}
              </span>
              <ChevronDown className="ml-1 size-3.5 shrink-0 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel>Lead source</DropdownMenuLabel>
            {SOURCE_FILTERS.map((s) => (
              <DropdownMenuCheckboxItem
                key={s}
                checked={sourceFilter.includes(s)}
                // Keep the menu open — sources are multi-select and
                // closing per click makes picking two of them a chore.
                onSelect={(e) => e.preventDefault()}
                onCheckedChange={() =>
                  setSourceFilter((prev) =>
                    prev.includes(s)
                      ? prev.filter((x) => x !== s)
                      : [...prev, s]
                  )
                }
              >
                {SOURCE_META[s].label}
              </DropdownMenuCheckboxItem>
            ))}
            {sourceFilter.length > 0 ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setSourceFilter([])}>
                  Clear
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={cn(
                FILTER_TRIGGER_CLASS,
                minRating > 0 && "border-foreground"
              )}
              title="Filter by minimum rating"
            >
              <span className="min-w-0 truncate">
                {minRating > 0
                  ? `Rating: ${minRating}${minRating < 5 ? "+" : ""}`
                  : "Rating"}
              </span>
              <ChevronDown className="ml-1 size-3.5 shrink-0 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-44">
            <DropdownMenuLabel>Minimum rating</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={String(minRating)}
              onValueChange={(v) => setMinRating(Number(v))}
            >
              <DropdownMenuRadioItem value="0">
                Any rating
              </DropdownMenuRadioItem>
              {[1, 2, 3, 4, 5].map((n) => (
                <DropdownMenuRadioItem key={n} value={String(n)}>
                  {n}
                  {n < 5 ? "+" : ""} stars
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={cn(
                FILTER_TRIGGER_CLASS,
                followUpFilter !== null && "border-foreground"
              )}
              title="Filter by follow-up state"
            >
              <span className="min-w-0 truncate">
                {followUpFilter === null
                  ? "Follow-up"
                  : followUpFilter
                    ? "Followed up"
                    : "Needs follow-up"}
              </span>
              <ChevronDown className="ml-1 size-3.5 shrink-0 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            <DropdownMenuLabel>Follow-up</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={
                followUpFilter === null
                  ? "any"
                  : followUpFilter
                    ? "done"
                    : "needs"
              }
              onValueChange={(v) =>
                setFollowUpFilter(v === "any" ? null : v === "done")
              }
            >
              <DropdownMenuRadioItem value="any">Any</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="needs">
                Needs follow-up
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="done">
                Followed up
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={cn(
                FILTER_TRIGGER_CLASS,
                tourFilter !== null && "border-foreground"
              )}
              title="Filter by campus-tour state"
            >
              <span className="min-w-0 truncate">
                {tourFilter === null
                  ? "Tour"
                  : tourFilter === "completed"
                    ? "Toured"
                    : tourFilter === "scheduled"
                      ? "Tour scheduled"
                      : "No tour"}
              </span>
              <ChevronDown className="ml-1 size-3.5 shrink-0 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-44">
            <DropdownMenuLabel>Campus tour</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={tourFilter ?? "any"}
              onValueChange={(v) =>
                setTourFilter(
                  v === "any"
                    ? null
                    : (v as "completed" | "scheduled" | "none")
                )
              }
            >
              <DropdownMenuRadioItem value="any">Any</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="completed">
                Toured
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="scheduled">
                Tour scheduled
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="none">
                No tour
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Auto-match lives at the row's far end — it's an action,
            not a filter, and the gap keeps it from reading as one. */}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="ml-auto h-9 bg-white"
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

      {error && !data ? (
        <div className="rounded-lg border bg-white p-8 text-center text-sm text-muted-foreground">
          Couldn&rsquo;t load leads. Refresh to try again.
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-lg border bg-white px-6 py-12 text-center text-sm text-muted-foreground">
          No leads match the current filters.
        </div>
      ) : (
        <div className="space-y-8">
          {GROUP_DEFS.map((g) => (
            <LeadsGroup
              key={g.key}
              title={g.title}
              description={g.description}
              dotColor={g.dot}
              rows={groups[g.key]}
              columns={columns}
              search={search}
              selectedKey={selected?.key ?? null}
              onRowClick={(r) => setSelected(r)}
            />
          ))}
        </div>
      )}

      {/* Triage sheet — stars, follow-up, conversion link, and the
          comms log for the clicked lead, whichever source it came
          from. */}
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
          leadStatus={activeRow.lead_status}
          statusReason={activeRow.status_reason}
          onChanged={() => void mutate()}
        />
      ) : null}
    </div>
  );
}

/** Page title + blurb — shared by the loaded page and the skeleton so
 *  the two can't drift (and so the heading never flashes in late). */
function AllLeadsIntro() {
  return (
    <div>
      <h1 className="text-2xl font-bold">All Leads</h1>
      <p className="text-sm text-muted-foreground">
        Every recruitment lead in one place, grouped by how far it has
        converted — active leads to triage on top, then each funnel stage
        through Enrolled. Rate each lead 1–5 stars on likelihood of
        conversion; click a row to log a call and mark it followed up.
      </p>
    </div>
  );
}

/**
 * First-load skeleton, laid out to match the real page block for
 * block — four stat cards, the filter row, then two group cards with
 * a table inside. Same widths and heights as the live chrome, so the
 * page doesn't jump when the data lands.
 */
function AllLeadsSkeleton() {
  return (
    <>
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border bg-white px-4 py-4">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-2 h-8 w-16" />
            <Skeleton className="mt-2 h-3 w-32" />
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-9 min-w-64 flex-1" />
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-40 shrink-0" />
        ))}
        <Skeleton className="ml-auto h-9 w-36" />
      </div>

      {/* Two cards — the usual shape while loading (Active Leads plus
          at least one converted stage); more appear as data lands. */}
      <div className="space-y-8">
        {[6, 3].map((rowCount, i) => (
          <div key={i} className="overflow-hidden rounded-xl border bg-white">
            <div className="flex items-center gap-3 border-b px-6 py-4">
              <Skeleton className="size-2.5 rounded-full" />
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3 w-8" />
              <Skeleton className="h-3 w-64" />
            </div>
            <div className="space-y-2 p-4">
              <Skeleton className="h-9 w-full rounded-md" />
              {Array.from({ length: rowCount }).map((_, r) => (
                <Skeleton key={r} className="h-11 w-full rounded-md" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

/**
 * One funnel-stage card — dot + title + count header over the shared
 * lead table. Hides entirely when the stage has no rows under the
 * current dropdown filters (the page-level search still filters
 * inside the table, matching the applications list's behavior).
 */
function LeadsGroup({
  title,
  description,
  dotColor,
  rows,
  columns,
  search,
  selectedKey,
  onRowClick,
}: {
  title: string;
  description: string;
  /** Tailwind bg-... class for the stage dot before the title. */
  dotColor: string;
  rows: AllLeadRow[];
  columns: ColumnDef<AllLeadRow>[];
  /** Page-level search value — drives every card's table at once. */
  search: string;
  /** Key of the lead whose triage sheet is open, for the row tint. */
  selectedKey: string | null;
  onRowClick: (row: AllLeadRow) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <Card className="overflow-hidden bg-white py-0 gap-0">
      <CardHeader className="py-4 border-b bg-white">
        <div className="flex items-baseline gap-3">
          {/* `self-center` so the dot vertically aligns to the
              uppercase title text rather than its baseline. */}
          <span
            className={cn(
              "size-2.5 shrink-0 self-center rounded-full",
              dotColor
            )}
            aria-hidden
          />
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            {title}
          </CardTitle>
          <span className="text-xs tabular-nums text-muted-foreground">
            ({rows.length})
          </span>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </CardHeader>
      <CardContent className="p-4 bg-white">
        <DataTable<AllLeadRow>
          columns={columns}
          data={rows}
          externalSearch={search}
          onRowClick={onRowClick}
          // Keep the open lead's row tinted so it's obvious which one
          // the sheet belongs to; clears when the sheet closes.
          // Returning a value takes over the row's background AND
          // hover, so unselected rows restate the default hover.
          rowClassName={(r) =>
            selectedKey === r.key
              ? "bg-muted hover:bg-muted"
              : "hover:bg-muted/50"
          }
        />
      </CardContent>
    </Card>
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

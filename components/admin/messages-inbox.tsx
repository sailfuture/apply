"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import {
  CheckCheck,
  Loader2,
  MessageSquareText,
  Search,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { FamilyProfileSheet } from "@/components/admin/family-profile-sheet";
import { LeadSheet } from "@/components/admin/lead-sheet";
import type {
  AllLeadRow,
  LeadSource,
} from "@/app/api/admin/all-leads/route";
import { cn } from "@/lib/utils";
import { adminFetcher } from "@/lib/admin-fetcher";
import { formatUSPhone } from "@/lib/phone";
import { FamilyMessageThread } from "@/components/admin/family-message-thread";
import { GroupMessageDialog } from "@/components/admin/group-message-dialog";
import { NewMessageDialog } from "@/components/admin/new-message-dialog";
import { SmsNotificationToggle } from "@/components/admin/sms-notifications";
import { SMS_VIEWED_EVENT } from "@/components/admin/messages-unread-badge";
import type {
  ConversationStage,
  SmsConversation,
} from "@/app/api/admin/messages/route";
import type {
  GroupAudienceResponse,
  GroupContact,
} from "@/app/api/admin/messages/group/audience/route";

/**
 * The shared two-pane SMS inbox behind BOTH messaging pages (user
 * request: split the single Messages page in two):
 *
 *   - `mode="enrolled"` → /admin/messages — enrolled families only,
 *     filtered by crew, bus stop, and grade (joined from the group
 *     audience directory; the conversation feed itself carries none
 *     of that).
 *   - `mode="recruitment"` → /admin/messages/recruitment — everyone
 *     who ISN'T an enrolled family: leads (inquiry/camp/waiver/TASCO),
 *     ad-hoc numbers, and families still applying or registering.
 *     Keeps the stage chips (minus Enrolled).
 *
 * A `?open=type:id` deep link that lands on the wrong page redirects
 * to its sibling, so dashboard "Needs a reply" rows keep working for
 * both kinds of contact. Viewed-state, sync, thread rendering, and the
 * profile sheets are identical across modes.
 */

export type InboxMode = "enrolled" | "recruitment";

/** Where each mode lives — used for the cross-page deep-link redirect. */
const MODE_PATH: Record<InboxMode, string> = {
  enrolled: "/admin/messages",
  recruitment: "/admin/messages/recruitment",
};

/** Recruitment-page filter chips — the funnel vocabulary minus
 *  Enrolled (those conversations live on the other page). "All" =
 *  every non-enrolled conversation. */
const RECRUITMENT_STAGE_FILTERS: Array<{
  value: ConversationStage | "all";
  label: string;
}> = [
  { value: "all", label: "All" },
  { value: "registration", label: "Registration" },
  { value: "application", label: "Applying" },
  { value: "inquiry", label: "Inquiries" },
  { value: "camp", label: "Camp" },
  { value: "visit", label: "Liability Waiver Visit" },
  { value: "tasco", label: "TASCO" },
];

const GRADES = [8, 9, 10, 11, 12] as const;

/** Does a conversation belong on the enrolled page? Everything else —
 *  leads, ad-hoc numbers, families still in the funnel — is
 *  recruitment. */
function isEnrolledConversation(c: SmsConversation): boolean {
  return c.contactType === "family" && c.stage === "enrolled";
}

/**
 * Name resilience: when an upstream blip degrades one poll's name
 * lookups, the API falls back to "Family #58"-style placeholders —
 * which made names flicker on and off between refreshes. This per-tab
 * cache remembers the last REAL name per contact so a placeholder
 * never replaces a name we've already shown. Module-level (not a ref)
 * because the repo lint forbids ref reads during render; a display
 * cache is exactly the kind of state that's safe to share per tab —
 * and across both inbox pages.
 */
const NAME_CACHE = new Map<string, string>();

const CHIP_CLASS = (on: boolean) =>
  cn(
    "shrink-0 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
    on
      ? "border-foreground bg-foreground text-background"
      : "border-border bg-white text-muted-foreground hover:border-foreground/40 hover:text-foreground"
  );

export function MessagesInbox({ mode }: { mode: InboxMode }) {
  const router = useRouter();
  // yearId is LOAD-BEARING here, not just an annotation: the
  // enrolled/recruitment split and the cross-page ?open= redirect
  // both classify on `stage`, and the API only computes family
  // stages when ?yearId= is passed — without it every family reads
  // stage "none" and an enrolled family's deep link would misroute
  // to the recruitment page (and latch there, since the one-shot
  // effect can't rerun). So unlike the pre-split page, the feed
  // fetch WAITS for the YearSelector to inject the year; entry
  // points without one (dashboard rows, PWA icon, notifications)
  // show the loading state for the beat that takes.
  const searchParams = useSearchParams();
  const yearId = searchParams.get("yearId");
  const { data, error, isLoading, mutate } = useSWR<{
    conversations: SmsConversation[];
  }>(
    yearId ? `/api/admin/messages?yearId=${yearId}` : null,
    adminFetcher,
    { refreshInterval: 20_000 }
  );
  const conversations = useMemo(() => {
    const raw = data?.conversations ?? [];
    return raw.map((c) => {
      const cacheKey = `${c.contactType}:${c.contactId}`;
      const isPlaceholder = /^(Family|Inquiry|Camp|Visit|TASCO) #\d+$/.test(
        c.name
      );
      if (!isPlaceholder) {
        NAME_CACHE.set(cacheKey, c.name);
        return c;
      }
      const cached = NAME_CACHE.get(cacheKey);
      return cached ? { ...c, name: cached } : c;
    });
  }, [data]);

  // The page's slice of the feed — the OTHER page owns the rest.
  const scoped = useMemo(
    () =>
      conversations.filter((c) =>
        mode === "enrolled"
          ? isEnrolledConversation(c)
          : !isEnrolledConversation(c)
      ),
    [conversations, mode]
  );

  // Enrolled-page directory join: the conversation feed carries no
  // crew/bus/grade, so pull the group-audience directory (same
  // payload the composer uses — SWR dedupes) and key it by family id.
  const { data: audienceData } = useSWR<GroupAudienceResponse>(
    mode === "enrolled" && yearId
      ? `/api/admin/messages/group/audience?yearId=${yearId}`
      : null,
    adminFetcher
  );
  const familyMeta = useMemo(() => {
    const map = new Map<number, GroupContact>();
    for (const c of audienceData?.contacts ?? []) {
      if (c.type === "family") map.set(c.id, c);
    }
    return map;
  }, [audienceData]);
  const crewOptions = useMemo(
    () =>
      [
        ...new Set(
          [...familyMeta.values()].flatMap((c) => c.crews ?? [])
        ),
      ].sort((a, b) => a.localeCompare(b)),
    [familyMeta]
  );
  const busStopOptions = useMemo(
    () =>
      [
        ...new Set(
          [...familyMeta.values()].flatMap((c) => c.busStops ?? [])
        ),
      ].sort((a, b) => a.localeCompare(b)),
    [familyMeta]
  );

  // Recruitment page filters by funnel stage; the enrolled page by
  // crew / bus stop / grade (its whole audience is one stage).
  const [stageFilter, setStageFilter] = useState<ConversationStage | "all">(
    "all"
  );
  // Audience-derived filters are PER-YEAR (crews and stops are year
  // assignments) — carrying them across a year switch would leave an
  // invisible filter whose chip may no longer exist. Stamping the
  // year into the state and ignoring mismatched stamps self-resets
  // on switch without an effect.
  const [filterState, setFilterState] = useState<{
    year: string | null;
    crews: string[];
    stops: string[];
    grades: number[];
  }>({ year: null, crews: [], stops: [], grades: [] });
  const {
    crews: crewFilter,
    stops: busStopFilter,
    grades: gradeFilter,
  } = useMemo(
    () =>
      filterState.year === yearId
        ? filterState
        : {
            crews: [] as string[],
            stops: [] as string[],
            grades: [] as number[],
          },
    [filterState, yearId]
  );
  // Free-text search across who the conversation is WITH — family,
  // parent, and student names (via the API's searchText), the phone
  // in any format, and the latest message body.
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    let list = scoped;
    if (mode === "recruitment" && stageFilter !== "all") {
      list = list.filter((c) => c.stage === stageFilter);
    }
    if (mode === "enrolled") {
      if (crewFilter.length > 0) {
        list = list.filter((c) =>
          (familyMeta.get(c.contactId)?.crews ?? []).some((cr) =>
            crewFilter.includes(cr)
          )
        );
      }
      if (busStopFilter.length > 0) {
        list = list.filter((c) =>
          (familyMeta.get(c.contactId)?.busStops ?? []).some((b) =>
            busStopFilter.includes(b)
          )
        );
      }
      if (gradeFilter.length > 0) {
        list = list.filter((c) =>
          (familyMeta.get(c.contactId)?.grades ?? []).some((g) =>
            gradeFilter.includes(g)
          )
        );
      }
    }
    const q = search.trim().toLowerCase();
    if (!q) return list;
    const qDigits = q.replace(/\D/g, "");
    return list.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.searchText ?? "").includes(q) ||
        c.lastBody.toLowerCase().includes(q) ||
        (qDigits.length >= 3 && c.phone.includes(qDigits))
    );
  }, [
    scoped,
    mode,
    stageFilter,
    crewFilter,
    busStopFilter,
    gradeFilter,
    familyMeta,
    search,
  ]);
  // Selection carries the name too (not just type+id) so a contact
  // picked from the "New message" dialog — who has NO conversation row
  // yet — can still render a thread header. Once the first text sends,
  // the refreshed conversation list takes over as the name source.
  const [selected, setSelected] = useState<{
    type: SmsConversation["contactType"];
    id: number;
    name: string;
  } | null>(null);

  // Viewed tracking — opening a conversation grays its needs-reply
  // dot until a NEWER inbound text arrives. Persisted per browser in
  // localStorage (one key shared by both pages); loaded after mount
  // (deferred a tick) so SSR and hydration render identically.
  const [viewedMap, setViewedMap] = useState<Record<string, number>>({});
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        setViewedMap(
          JSON.parse(localStorage.getItem("sms-viewed-v1") ?? "{}")
        );
      } catch {
        // Corrupt storage — start fresh.
      }
    }, 0);
    return () => clearTimeout(t);
  }, []);
  function markViewed(type: string, id: number, lastAt: number) {
    setViewedMap((prev) => {
      const key = `${type}:${id}`;
      if ((prev[key] ?? 0) >= lastAt) return prev;
      const next = { ...prev, [key]: lastAt };
      try {
        localStorage.setItem("sms-viewed-v1", JSON.stringify(next));
        // Same-tab nudge for the nav's unread badge — `storage` only
        // fires in other tabs, so without this the badge would keep
        // counting a thread the admin is currently reading.
        window.dispatchEvent(new Event(SMS_VIEWED_EVENT));
      } catch {
        // Storage full/blocked — the dot still grays for this session.
      }
      return next;
    });
  }
  const isUnread = (c: SmsConversation) =>
    c.needsReply &&
    (viewedMap[`${c.contactType}:${c.contactId}`] ?? 0) < c.lastAt;
  // Stamp EVERY needs-reply thread viewed in one write — the escape
  // hatch for a browser whose viewed map has fallen behind (new
  // device, cleared storage, threads a colleague already handled).
  // Marks the FULL feed, not just this page's slice: the nav badge
  // counts both inboxes, so clearing only one page's threads would
  // leave a bubble this page can't show the reason for.
  function markAllViewed() {
    setViewedMap((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const c of conversations) {
        if (!c.needsReply) continue;
        const key = `${c.contactType}:${c.contactId}`;
        if ((next[key] ?? 0) >= c.lastAt) continue;
        next[key] = c.lastAt;
        changed = true;
      }
      if (!changed) return prev;
      try {
        localStorage.setItem("sms-viewed-v1", JSON.stringify(next));
        window.dispatchEvent(new Event(SMS_VIEWED_EVENT));
      } catch {
        // Storage full/blocked — dots still gray for this session.
      }
      return next;
    });
  }
  const anyUnread = conversations.some(isUnread);

  // Deep link: `?open=<contactType>:<contactId>` (the same key shape
  // the unread feed and viewed map use) selects that thread once the
  // conversation list lands — the dashboard's "Needs a reply" rows
  // arrive here. One-shot so the param doesn't fight the admin's own
  // clicking afterwards; opening also marks the thread viewed, exactly
  // like clicking its row. A link whose contact belongs on the OTHER
  // page redirects there (dashboard rows don't know the split).
  const openParam = searchParams.get("open");
  const openedFromParam = useRef(false);
  useEffect(() => {
    if (openedFromParam.current || !openParam || conversations.length === 0) {
      return;
    }
    const sep = openParam.indexOf(":");
    if (sep === -1) return;
    const type = openParam.slice(0, sep);
    const id = Number(openParam.slice(sep + 1));
    // Matched against the FULL feed, not this page's slice — a
    // wrong-page link needs the match to know where to send it.
    const match = conversations.find(
      (c) => c.contactType === type && c.contactId === id
    );
    // Stale link, or the thread hasn't arrived in this page of the
    // list yet — leave the inbox alone and let a later load retry
    // (the one-shot latch below only closes once we've matched).
    if (!match) return;
    openedFromParam.current = true;
    const belongsHere =
      mode === "enrolled"
        ? isEnrolledConversation(match)
        : !isEnrolledConversation(match);
    if (!belongsHere) {
      const params = new URLSearchParams();
      params.set("open", openParam);
      if (yearId) params.set("yearId", yearId);
      router.replace(
        `${MODE_PATH[mode === "enrolled" ? "recruitment" : "enrolled"]}?${params.toString()}`
      );
      return;
    }
    // Deferred a tick rather than written straight from the effect
    // body: a synchronous setState there cascades an extra render
    // pass, which is what `react-hooks/set-state-in-effect` flags.
    // Same shape as the viewedMap load above. Cleanup cancels it if
    // the param changes (or we unmount) before it fires.
    const t = setTimeout(() => {
      setSelected({
        type: match.contactType,
        id: match.contactId,
        name: match.name,
      });
      markViewed(match.contactType, match.contactId, match.lastAt);
    }, 0);
    return () => clearTimeout(t);
  }, [openParam, conversations, mode, router, yearId]);
  const active = selected
    ? (conversations.find(
        (c) =>
          c.contactType === selected.type && c.contactId === selected.id
      ) ?? {
        contactType: selected.type,
        contactId: selected.id,
        name: selected.name,
        phone: "",
      })
    : null;

  // Keep the OPEN thread marked viewed as its `lastAt` moves — a new
  // inbound text (or the Twilio sync backfilling one) landing in the
  // conversation the admin is currently reading otherwise counted as
  // unread until they re-clicked the row: the "seen but never marked
  // read" badge bug. Deferred a tick so the setState doesn't run in
  // the effect body (react-hooks/set-state-in-effect).
  const activeLastAt =
    active && "lastAt" in active ? (active.lastAt ?? 0) : 0;
  useEffect(() => {
    if (!selected || !activeLastAt) return;
    const { type, id } = selected;
    const t = setTimeout(() => markViewed(type, id, activeLastAt), 0);
    return () => clearTimeout(t);
  }, [selected, activeLastAt]);

  // In-place profile sheet for the open conversation — family details
  // for families, the full lead triage sheet for the four lead
  // sources (no page navigation). The all-leads fetch is lazy: it
  // only fires once a lead's profile is actually requested.
  const [profileOpen, setProfileOpen] = useState(false);
  const wantLeadProfile =
    profileOpen &&
    selected !== null &&
    selected.type !== "family" &&
    selected.type !== "adhoc";
  // Data is read by <LeadSheet/> (same SWR key, so this doesn't
  // double-fetch); this hook stays for the header button's loading
  // state and the deleted-record toast.
  const { isLoading: leadRowsLoading, mutate: mutateLeadRows } =
    useSWR<AllLeadRow[]>(
    wantLeadProfile ? "/api/admin/all-leads" : null,
    adminFetcher,
    {
      // Fetch finished but the lead's row is gone (deleted record) —
      // say so instead of leaving a dead button.
      onSuccess: (rows) => {
        const found =
          selected &&
          rows.some(
            (r) => r.source === selected.type && r.id === selected.id
          );
        if (!found) {
          toast.error("Couldn't find this lead's record.");
          setProfileOpen(false);
        }
      },
    }
  );

  // Reconcile against Twilio's own log once per visit — texts sent
  // outside the app (Twilio console, legacy forwarder) and inbound
  // messages the webhook missed get backfilled into the inbox.
  // Idempotent server-side (SID-keyed). DEFERRED a few seconds so the
  // first conversation-list fetch isn't racing the (slow, Twilio-
  // round-tripping) sync for serverless capacity — the inbox paints
  // from the log immediately, and the sync tops it up afterward.
  const syncedRef = useRef(false);
  useEffect(() => {
    if (syncedRef.current) return;
    syncedRef.current = true;
    const timer = setTimeout(() => {
      fetch("/api/admin/messages/sync", { method: "POST" })
        .then((res) => (res.ok ? res.json() : null))
        .then((result) => {
          if (result?.imported > 0) {
            toast.success(
              `Imported ${result.imported} text${result.imported === 1 ? "" : "s"} from Twilio.`
            );
            void mutate();
          }
        })
        .catch(() => {
          // Best-effort — the inbox still renders whatever is logged.
        });
    }, 4000);
    return () => clearTimeout(timer);
  }, [mutate]);

  // Render the list incrementally — newest conversations first (the
  // API sorts), a page at a time so a season's worth of contacts
  // doesn't render hundreds of rows on first paint. Filter changes
  // reset to the first page.
  const PAGE = 30;
  const [visibleCount, setVisibleCount] = useState(PAGE);
  const visibleConversations = filtered.slice(0, visibleCount);
  function changeStageFilter(v: ConversationStage | "all") {
    setStageFilter(v);
    setVisibleCount(PAGE);
  }
  function toggleFilter(kind: "crews" | "stops", value: string) {
    setFilterState((prev) => {
      const base =
        prev.year === yearId
          ? prev
          : { year: yearId, crews: [], stops: [], grades: [] };
      const list = base[kind];
      return {
        ...base,
        year: yearId,
        [kind]: list.includes(value)
          ? list.filter((x) => x !== value)
          : [...list, value],
      };
    });
    setVisibleCount(PAGE);
  }
  function toggleGrade(g: number) {
    setFilterState((prev) => {
      const base =
        prev.year === yearId
          ? prev
          : { year: yearId, crews: [], stops: [], grades: [] };
      return {
        ...base,
        year: yearId,
        grades: base.grades.includes(g)
          ? base.grades.filter((x) => x !== g)
          : [...base.grades, g],
      };
    });
    setVisibleCount(PAGE);
  }
  function changeSearch(v: string) {
    setSearch(v);
    setVisibleCount(PAGE);
  }

  return (
    // Tighter gaps + padding on phones: this page is used one-handed
    // to read and reply to parent texts, so every row of chrome above
    // the list costs a message.
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col gap-3 p-4 md:gap-4 md:p-6">
      <div>
        <h1 className="text-xl font-bold md:text-2xl">
          {mode === "enrolled" ? "Messages" : "Recruitment Messages"}
        </h1>
        {/* Explanatory copy is desktop-only — on a phone it pushes the
            conversation list below the fold. */}
        <p className="hidden text-sm text-muted-foreground sm:block">
          {mode === "enrolled"
            ? "Two-way text threads with enrolled families. Filter by crew, bus stop, or grade — or send a group message."
            : "Two-way text threads with leads and families still in the admissions funnel. Enrolled families live on the Messages page under Parents."}
        </p>
      </div>

      {/* Search — its own row between the header and the filter
          chips. Matches family/parent/student names, phone (any
          format), and the latest message text. */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        {/* type="text" (not "search") — the browser's built-in clear
            X doubled up with ours. */}
        <input
          type="text"
          value={search}
          onChange={(e) => changeSearch(e.target.value)}
          autoComplete="off"
          placeholder="Search by student, parent, or phone…"
          className="w-full rounded-md border bg-white py-1.5 pl-8 pr-7 text-sm outline-none placeholder:text-muted-foreground focus:border-foreground/40"
        />
        {search ? (
          <button
            type="button"
            onClick={() => changeSearch("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            aria-label="Clear search"
          >
            <X className="size-3.5" />
          </button>
        ) : null}
      </div>

      {/* Filter chips inline with the compose buttons — one row:
          filters left, actions right. Recruitment filters by funnel
          stage; enrolled by crew / bus stop / grade (joined from the
          audience directory). */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Chips scroll sideways on a phone rather than wrapping to
            three rows; they wrap normally from md up. */}
        <div className="-mx-1 flex max-w-full items-center gap-1.5 overflow-x-auto px-1 pb-0.5 md:mx-0 md:flex-wrap md:overflow-visible md:px-0">
          {mode === "recruitment" ? (
            RECRUITMENT_STAGE_FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                aria-pressed={stageFilter === f.value}
                onClick={() => changeStageFilter(f.value)}
                className={CHIP_CLASS(stageFilter === f.value)}
              >
                {f.label}
              </button>
            ))
          ) : (
            <>
              {crewOptions.length > 0 ? (
                <>
                  <span className="shrink-0 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Crew
                  </span>
                  {crewOptions.map((crew) => (
                    <button
                      key={crew}
                      type="button"
                      aria-pressed={crewFilter.includes(crew)}
                      onClick={() => toggleFilter("crews", crew)}
                      className={CHIP_CLASS(crewFilter.includes(crew))}
                    >
                      {crew.replace(/^crew\s+/i, "")}
                    </button>
                  ))}
                </>
              ) : null}
              {busStopOptions.length > 0 ? (
                <>
                  <span
                    className="mx-1 h-4 w-px shrink-0 bg-border"
                    aria-hidden
                  />
                  <span className="shrink-0 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Bus stop
                  </span>
                  {busStopOptions.map((stop) => (
                    <button
                      key={stop}
                      type="button"
                      aria-pressed={busStopFilter.includes(stop)}
                      onClick={() => toggleFilter("stops", stop)}
                      className={CHIP_CLASS(busStopFilter.includes(stop))}
                    >
                      {stop}
                    </button>
                  ))}
                </>
              ) : null}
              {/* Grade chips only earn their row space once the
                  directory has loaded — they filter via it. */}
              {familyMeta.size > 0 ? (
                <>
                  <span
                    className="mx-1 h-4 w-px shrink-0 bg-border"
                    aria-hidden
                  />
                  <span className="shrink-0 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Grade
                  </span>
                  {GRADES.map((g) => (
                    <button
                      key={g}
                      type="button"
                      aria-pressed={gradeFilter.includes(g)}
                      onClick={() => toggleGrade(g)}
                      className={CHIP_CLASS(gradeFilter.includes(g))}
                    >
                      {g}th
                    </button>
                  ))}
                </>
              ) : null}
            </>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {anyUnread ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={markAllViewed}
              title="Clear the unread dots and the nav bubble without opening each thread"
            >
              <CheckCheck className="mr-1.5 size-3.5" />
              Mark all read
            </Button>
          ) : null}
          <SmsNotificationToggle />
          <NewMessageDialog
            onPick={(contact) => {
              setSelected(contact);
              setProfileOpen(false);
            }}
          />
          {/* defaultYearId keeps the composer's audience year in
              lockstep with the page's slicing year — its own default
              (the active year) can differ from the nav's (the
              upcoming year), which made "enrolled" mean two different
              cohorts on one screen. */}
          <GroupMessageDialog
            scope={mode}
            defaultYearId={yearId ? Number(yearId) : undefined}
            onSent={() => mutate()}
          />
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 md:grid-cols-[320px_1fr]">
        {/* Conversation list. On mobile the two panes share one column,
            so exactly one shows at a time: the list until a thread is
            picked, then the thread (with its "← All" button to return).
            md+ always shows both. */}
        <div
          className={cn(
            "min-h-0 overflow-y-auto overscroll-contain rounded-lg border bg-white",
            selected !== null && "hidden md:block"
          )}
        >
          {/* Distinguish "still loading" and "failed to load" from a
              genuinely empty inbox — asserting "no conversations" while
              the request is in flight (or after it errored) reads as
              lost messages. */}
          {error && !data ? (
            <div className="space-y-2 p-6 text-center text-sm text-muted-foreground">
              <p>Couldn&rsquo;t load conversations.</p>
              <button
                type="button"
                onClick={() => void mutate()}
                className="text-xs font-medium text-foreground underline underline-offset-2"
              >
                Try again
              </button>
            </div>
          ) : (!yearId || isLoading) && !data ? (
            // Centered in the pane (not hugging the top) with a label
            // so the wait reads as "working", not "empty". Also the
            // state while the YearSelector injects the default year —
            // the feed deliberately doesn't fetch without one.
            <div className="flex h-full flex-col items-center justify-center gap-2 p-6">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
              <p className="text-xs text-muted-foreground">
                Loading conversations…
              </p>
            </div>
          ) : scoped.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              {mode === "enrolled"
                ? "No conversations with enrolled families yet. Use "
                : "No recruitment conversations yet. Use "}
              <span className="font-medium text-foreground">New message</span>{" "}
              to start one — or send a group message.
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              {search.trim()
                ? "No conversations match this search."
                : "No conversations match this filter."}
            </div>
          ) : (
            <ul className="divide-y">
              {visibleConversations.map((c) => (
                <li key={`${c.contactType}:${c.contactId}`}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelected({
                        type: c.contactType,
                        id: c.contactId,
                        name: c.name,
                      });
                      setProfileOpen(false);
                      markViewed(c.contactType, c.contactId, c.lastAt);
                    }}
                    className={cn(
                      "w-full px-4 py-3 text-left transition-colors hover:bg-muted/50",
                      selected?.type === c.contactType &&
                        selected?.id === c.contactId &&
                        "bg-muted"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-sm font-medium">
                          {displayName(c.contactType, c.name)}
                        </span>
                        <ContactPhone
                          type={c.contactType}
                          phone={c.phone}
                        />
                      </span>
                      <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
                        {relTime(c.lastAt)}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      {c.needsReply ? (
                        <span
                          className={cn(
                            "size-2 shrink-0 rounded-full",
                            isUnread(c) ? "bg-blue-500" : "bg-slate-300"
                          )}
                          aria-label={
                            isUnread(c) ? "Needs reply" : "Viewed"
                          }
                        />
                      ) : null}
                      {/* Group-blast preview reads differently from a
                          personal text — icon + "Group:" prefix. */}
                      {c.lastIsGroup ? (
                        <Users
                          className="size-3 shrink-0 text-muted-foreground"
                          aria-label="Group message"
                        />
                      ) : null}
                      <span
                        className={cn(
                          "truncate text-xs",
                          isUnread(c)
                            ? "font-medium text-foreground"
                            : "text-muted-foreground"
                        )}
                      >
                        {c.lastIsGroup
                          ? "Group: "
                          : c.lastDirection === "outbound"
                            ? "You: "
                            : ""}
                        {c.lastBody}
                      </span>
                    </div>
                  </button>
                </li>
              ))}
              {filtered.length > visibleCount ? (
                <li>
                  <button
                    type="button"
                    onClick={() => setVisibleCount((n) => n + PAGE)}
                    className="w-full px-4 py-3 text-center text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                  >
                    Show more ({filtered.length - visibleCount} older)
                  </button>
                </li>
              ) : null}
            </ul>
          )}
        </div>

        {/* Thread pane */}
        <div
          className={cn(
            "min-h-0 flex-col overflow-hidden rounded-lg border bg-white",
            selected === null ? "hidden md:flex" : "flex"
          )}
        >
          {active ? (
            <>
              <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
                <p className="flex min-w-0 items-center gap-1.5 text-sm font-semibold">
                  <span className="truncate">
                    {displayName(active.contactType, active.name)}
                  </span>
                  <ContactPhone
                    type={active.contactType}
                    phone={active.phone}
                  />
                </p>
                <div className="flex shrink-0 items-center gap-2">
                  {/* Open the contact's profile IN PLACE — a family
                      details sheet, or the lead's full triage sheet —
                      no page navigation. Ad-hoc numbers have no
                      record, so no button. */}
                  {active.contactType !== "adhoc" ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="bg-white"
                      onClick={() => setProfileOpen(true)}
                    >
                      {wantLeadProfile && leadRowsLoading ? (
                        <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                      ) : (
                        <UserRound className="size-3.5 mr-1.5" />
                      )}
                      {active.contactType === "family"
                        ? "Family details"
                        : "View lead"}
                    </Button>
                  ) : null}
                  {/* Quick way back to the list on mobile, where the
                      list is hidden while a thread is open. */}
                  <button
                    type="button"
                    onClick={() => setSelected(null)}
                    className="text-xs text-muted-foreground hover:text-foreground md:hidden"
                  >
                    ← All
                  </button>
                </div>
              </div>
              <FamilyMessageThread
                key={`${active.contactType}:${active.contactId}`}
                className="flex-1 min-h-0"
                contact={{ type: active.contactType, id: active.contactId }}
                onSent={() => mutate()}
              />
            </>
          ) : (!yearId || isLoading) && !data ? (
            // Conversation list is still loading — an empty pane here
            // (the list's own spinner carries the state). Prompting
            // "select a conversation" before there's anything to
            // select reads as a broken page.
            <div className="h-full" />
          ) : (
            <div className="flex h-full items-center justify-center px-8 text-center">
              <div className="text-sm text-muted-foreground">
                <MessageSquareText className="mx-auto mb-2 size-6 text-muted-foreground/50" />
                Select a conversation to read and reply.
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Profile sheets — opened by the thread header's button, no
          page navigation. Families get the compact profile sheet;
          leads get the same triage sheet All Leads uses (rating,
          editable details, chat-style comms log). */}
      {selected && selected.type === "family" ? (
        <FamilyProfileSheet
          familyId={selected.id}
          open={profileOpen}
          onOpenChange={setProfileOpen}
        />
      ) : null}
      {/* The shared lead sheet — identical to All Leads and every
          per-source page. It fetches the all-leads row itself; the
          hook above shares the same SWR key (so no second request)
          and stays for the header button's loading state. */}
      <LeadSheet
        lead={
          wantLeadProfile && selected
            ? { source: selected.type as LeadSource, id: selected.id }
            : null
        }
        onOpenChange={(o) => !o && setProfileOpen(false)}
        onChanged={() => void mutateLeadRows()}
      />
    </div>
  );
}


/** Ad-hoc conversations are NAMED by their raw 10-digit number —
 *  pretty-print it; every other type shows its record name. */
function displayName(
  type: SmsConversation["contactType"],
  name: string
): string {
  if (type === "adhoc") return formatUSPhone(name) || name;
  return name;
}

/** The contact's phone beside the conversation name (replaces the old
 *  Inquiry/Camp/Visit type chip — the stage filter chips already say
 *  where a contact sits). Ad-hoc rows skip it: their NAME is already
 *  the number. */
function ContactPhone({
  type,
  phone,
}: {
  type: SmsConversation["contactType"];
  phone: string;
}) {
  if (type === "adhoc" || !phone) return null;
  return (
    <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
      {formatUSPhone(phone) || phone}
    </span>
  );
}

/** Compact relative time for the conversation list ("3m", "2h", "5d",
 *  then a date). */
function relTime(ts: number): string {
  if (!ts) return "";
  const diff = Date.now() - ts;
  const MIN = 60_000;
  const HOUR = 3_600_000;
  const DAY = 86_400_000;
  if (diff < MIN) return "now";
  if (diff < HOUR) return `${Math.floor(diff / MIN)}m`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h`;
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}d`;
  return new Date(ts).toLocaleDateString([], { month: "short", day: "numeric" });
}

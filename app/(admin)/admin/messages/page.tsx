"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import {
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

/** Inbox filter chips — the same pipeline vocabulary as the group
 *  composer. "All" includes families with no activity for the year. */
const STAGE_FILTERS: Array<{ value: ConversationStage | "all"; label: string }> =
  [
    { value: "all", label: "All" },
    { value: "enrolled", label: "Enrolled" },
    { value: "registration", label: "Registration" },
    { value: "application", label: "Applying" },
    { value: "inquiry", label: "Inquiries" },
    { value: "camp", label: "Camp" },
    { value: "visit", label: "Liability Waiver Visit" },
    { value: "tasco", label: "TASCO" },
  ];

/**
 * Name resilience: when an upstream blip degrades one poll's name
 * lookups, the API falls back to "Family #58"-style placeholders —
 * which made names flicker on and off between refreshes. This per-tab
 * cache remembers the last REAL name per contact so a placeholder
 * never replaces a name we've already shown. Module-level (not a ref)
 * because the repo lint forbids ref reads during render; a display
 * cache is exactly the kind of state that's safe to share per tab.
 */
const NAME_CACHE = new Map<string, string>();

/**
 * Global SMS inbox — two panes: every family conversation on the left
 * (newest first, with a blue dot when the family texted last and we
 * haven't replied), the selected family's two-way thread on the right.
 * "New group message" fans a filtered blast out to many families at
 * once; each send still lands on that family's thread.
 */
export default function AdminMessagesPage() {
  // yearId scopes the family STAGE annotations only — threads and the
  // conversation list itself are never year-filtered.
  const searchParams = useSearchParams();
  const yearId = searchParams.get("yearId");
  const { data, error, isLoading, mutate } = useSWR<{
    conversations: SmsConversation[];
  }>(
    yearId ? `/api/admin/messages?yearId=${yearId}` : "/api/admin/messages",
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

  const [stageFilter, setStageFilter] = useState<ConversationStage | "all">(
    "all"
  );
  // Free-text search across who the conversation is WITH — family,
  // parent, and student names (via the API's searchText), the phone
  // in any format, and the latest message body.
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    const byStage =
      stageFilter === "all"
        ? conversations
        : conversations.filter((c) => c.stage === stageFilter);
    const q = search.trim().toLowerCase();
    if (!q) return byStage;
    const qDigits = q.replace(/\D/g, "");
    return byStage.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.searchText ?? "").includes(q) ||
        c.lastBody.toLowerCase().includes(q) ||
        (qDigits.length >= 3 && c.phone.includes(qDigits))
    );
  }, [conversations, stageFilter, search]);
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
  // localStorage; loaded after mount (deferred a tick) so SSR and
  // hydration render identically.
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

  // Deep link: `?open=<contactType>:<contactId>` (the same key shape
  // the unread feed and viewed map use) selects that thread once the
  // conversation list lands — the dashboard's "Needs a reply" rows
  // arrive here. One-shot so the param doesn't fight the admin's own
  // clicking afterwards; opening also marks the thread viewed, exactly
  // like clicking its row.
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
    const match = conversations.find(
      (c) => c.contactType === type && c.contactId === id
    );
    // Stale link, or the thread hasn't arrived in this page of the
    // list yet — leave the inbox alone and let a later load retry
    // (the one-shot latch below only closes once we've matched).
    if (!match) return;
    openedFromParam.current = true;
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
  }, [openParam, conversations]);
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
        <h1 className="text-xl font-bold md:text-2xl">Messages</h1>
        {/* Explanatory copy is desktop-only — on a phone it pushes the
            conversation list below the fold. */}
        <p className="hidden text-sm text-muted-foreground sm:block">
          Two-way text threads with families. Reply to inbound texts, or
          send a filtered group message.
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

      {/* Stage filter chips inline with the compose buttons — one
          row: filters left, actions right. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Chips scroll sideways on a phone rather than wrapping to
            three rows; they wrap normally from md up. */}
        <div className="-mx-1 flex max-w-full items-center gap-1.5 overflow-x-auto px-1 pb-0.5 md:mx-0 md:flex-wrap md:overflow-visible md:px-0">
          {STAGE_FILTERS.map((f) => {
            const on = stageFilter === f.value;
            return (
              <button
                key={f.value}
                type="button"
                aria-pressed={on}
                onClick={() => changeStageFilter(f.value)}
                className={cn(
                  // shrink-0 + nowrap: in the mobile scroll row a long
                  // label ("Liability Waiver Visit") would otherwise
                  // compress and wrap instead of scrolling.
                  "shrink-0 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
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
        <div className="flex shrink-0 items-center gap-2">
          <SmsNotificationToggle />
          <NewMessageDialog
            onPick={(contact) => {
              setSelected(contact);
              setProfileOpen(false);
            }}
          />
          <GroupMessageDialog onSent={() => mutate()} />
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
          ) : isLoading && !data ? (
            // Centered in the pane (not hugging the top) with a label
            // so the wait reads as "working", not "empty".
            <div className="flex h-full flex-col items-center justify-center gap-2 p-6">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
              <p className="text-xs text-muted-foreground">
                Loading conversations…
              </p>
            </div>
          ) : conversations.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              No conversations yet. Use{" "}
              <span className="font-medium text-foreground">New message</span>{" "}
              to text a family, inquiry, or camp parent — or start a group
              message.
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
          ) : isLoading && !data ? (
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

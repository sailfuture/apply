"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import { Loader2, MessageSquareText, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { adminFetcher } from "@/lib/admin-fetcher";
import { FamilyMessageThread } from "@/components/admin/family-message-thread";
import { GroupMessageDialog } from "@/components/admin/group-message-dialog";
import { NewMessageDialog } from "@/components/admin/new-message-dialog";
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
    { value: "visit", label: "Visits" },
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
      const isPlaceholder = /^(Family|Inquiry|Camp|Visit) #\d+$/.test(
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
  const filtered = useMemo(
    () =>
      stageFilter === "all"
        ? conversations
        : conversations.filter((c) => c.stage === stageFilter),
    [conversations, stageFilter]
  );
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
      } catch {
        // Storage full/blocked — the dot still grays for this session.
      }
      return next;
    });
  }
  const isUnread = (c: SmsConversation) =>
    c.needsReply &&
    (viewedMap[`${c.contactType}:${c.contactId}`] ?? 0) < c.lastAt;
  const active = selected
    ? (conversations.find(
        (c) =>
          c.contactType === selected.type && c.contactId === selected.id
      ) ?? {
        contactType: selected.type,
        contactId: selected.id,
        name: selected.name,
      })
    : null;

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

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col gap-4 p-6">
      <div>
        <h1 className="text-2xl font-bold">Messages</h1>
        <p className="text-sm text-muted-foreground">
          Two-way text threads with families. Reply to inbound texts, or
          send a filtered group message.
        </p>
      </div>

      {/* Stage filter chips inline with the compose buttons — one
          row: filters left, actions right. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {STAGE_FILTERS.map((f) => {
            const on = stageFilter === f.value;
            return (
              <button
                key={f.value}
                type="button"
                aria-pressed={on}
                onClick={() => changeStageFilter(f.value)}
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
        <div className="flex shrink-0 items-center gap-2">
          <NewMessageDialog onPick={(contact) => setSelected(contact)} />
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
            <div className="flex justify-center p-6">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
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
              No conversations match this filter.
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
                          {c.name}
                        </span>
                        <ContactBadge type={c.contactType} />
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
                  <span className="truncate">{active.name}</span>
                  <ContactBadge type={active.contactType} />
                </p>
                {/* Quick way back to the list on mobile, where the list
                    is hidden while a thread is open. */}
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="text-xs text-muted-foreground hover:text-foreground md:hidden"
                >
                  ← All
                </button>
              </div>
              <FamilyMessageThread
                key={`${active.contactType}:${active.contactId}`}
                className="flex-1 min-h-0"
                contact={{ type: active.contactType, id: active.contactId }}
                onSent={() => mutate()}
              />
            </>
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
    </div>
  );
}

/** Tiny type chip beside a conversation name. Families are the
 *  default relationship, so they carry no badge — only inquiry and
 *  summer-camp contacts are flagged. */
function ContactBadge({
  type,
}: {
  type: SmsConversation["contactType"];
}) {
  if (type === "family") return null;
  return (
    <span className="shrink-0 rounded-full border px-1.5 py-px text-[10px] font-medium text-muted-foreground">
      {type === "inquiry" ? "Inquiry" : type === "camp" ? "Camp" : "Visit"}
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

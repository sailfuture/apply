"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Loader2, MessageSquareText } from "lucide-react";
import { cn } from "@/lib/utils";
import { adminFetcher } from "@/lib/admin-fetcher";
import { FamilyMessageThread } from "@/components/admin/family-message-thread";
import { GroupMessageDialog } from "@/components/admin/group-message-dialog";
import { NewMessageDialog } from "@/components/admin/new-message-dialog";
import type { SmsConversation } from "@/app/api/admin/messages/route";

/**
 * Global SMS inbox — two panes: every family conversation on the left
 * (newest first, with a blue dot when the family texted last and we
 * haven't replied), the selected family's two-way thread on the right.
 * "New group message" fans a filtered blast out to many families at
 * once; each send still lands on that family's thread.
 */
export default function AdminMessagesPage() {
  const { data, error, isLoading, mutate } = useSWR<{
    conversations: SmsConversation[];
  }>("/api/admin/messages", adminFetcher, { refreshInterval: 20_000 });
  const conversations = useMemo(() => data?.conversations ?? [], [data]);
  // Selection carries the name too (not just the id) so a family picked
  // from the "New message" dialog — who has NO conversation row yet —
  // can still render a thread header. Once the first text sends, the
  // refreshed conversation list takes over as the name source.
  const [selected, setSelected] = useState<{
    id: number;
    name: string;
  } | null>(null);
  const active = selected
    ? (conversations.find((c) => c.familyId === selected.id) ?? {
        familyId: selected.id,
        familyName: selected.name,
      })
    : null;

  // Reconcile against Twilio's own log once per visit — texts sent
  // outside the app (Twilio console, legacy forwarder) and inbound
  // messages the webhook missed get backfilled into the inbox.
  // Idempotent server-side (SID-keyed), so the only cost of firing on
  // every mount is the Twilio list call.
  const syncedRef = useRef(false);
  useEffect(() => {
    if (syncedRef.current) return;
    syncedRef.current = true;
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
  }, [mutate]);

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col gap-4 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Messages</h1>
          <p className="text-sm text-muted-foreground">
            Two-way text threads with families. Reply to inbound texts, or
            send a filtered group message.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <NewMessageDialog onPick={(family) => setSelected(family)} />
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
            "min-h-0 overflow-y-auto rounded-lg border bg-white",
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
              to text a family, or start a group message.
            </div>
          ) : (
            <ul className="divide-y">
              {conversations.map((c) => (
                <li key={c.familyId}>
                  <button
                    type="button"
                    onClick={() =>
                      setSelected({ id: c.familyId, name: c.familyName })
                    }
                    className={cn(
                      "w-full px-4 py-3 text-left transition-colors hover:bg-muted/50",
                      selected?.id === c.familyId && "bg-muted"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">
                        {c.familyName}
                      </span>
                      <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
                        {relTime(c.lastAt)}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      {c.needsReply ? (
                        <span
                          className="size-2 shrink-0 rounded-full bg-blue-500"
                          aria-label="Needs reply"
                        />
                      ) : null}
                      <span
                        className={cn(
                          "truncate text-xs",
                          c.needsReply
                            ? "font-medium text-foreground"
                            : "text-muted-foreground"
                        )}
                      >
                        {c.lastDirection === "outbound" ? "You: " : ""}
                        {c.lastBody}
                      </span>
                    </div>
                  </button>
                </li>
              ))}
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
                <p className="text-sm font-semibold">{active.familyName}</p>
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
                key={active.familyId}
                className="flex-1 min-h-0"
                familyId={active.familyId}
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

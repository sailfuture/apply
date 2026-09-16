"use client";

import { useCallback } from "react";
import useSWR from "swr";
import { adminFetcher } from "@/lib/admin-fetcher";
import { cn } from "@/lib/utils";
import { countUnread } from "@/lib/sms/unread";
import type { ReadStateMap, UnreadMessagesResponse } from "@/lib/sms/unread";
import type { ReadStateResponse } from "@/app/api/admin/messages/read-state/route";

/**
 * Client half of the SMS unread badge.
 *
 * Read state ("I've looked at this thread", "this one already popped a
 * desktop notification") lives on the admin's CLERK USER, not in the
 * browser — see `lib/sms/read-state.ts`. It arrives in the SAME payload
 * as the needs-reply list, which is what makes the badge stable:
 *
 *   - it follows the account, so reading on a laptop clears the badge
 *     on a phone, and a new device doesn't light up with old threads
 *   - both halves of the count land together, so the badge can't paint
 *     a too-high number and then drop it a tick later
 */

const UNREAD_KEY = "/api/admin/messages/unread";
const READ_STATE_URL = "/api/admin/messages/read-state";

/** Stable empty map so `useSmsViewedMap()` doesn't hand out a fresh
 *  object (and re-render every consumer) on each render. */
const EMPTY: ReadStateMap = {};

export interface ReadStateEntry {
  key: string;
  at: number;
}

/**
 * The shared needs-reply feed. Every consumer (nav badge, inbox dots,
 * dashboard card, desktop notifier) subscribes to this one SWR key, so
 * they all read the same answer at the same moment and it costs one
 * request no matter how many are mounted.
 */
export function useUnreadMessagesFeed() {
  return useSWR<UnreadMessagesResponse>(UNREAD_KEY, adminFetcher, {
    // The nav is mounted on every admin page; a minute of staleness on
    // a badge is fine and keeps this off the hot path.
    refreshInterval: 60_000,
    revalidateOnFocus: true,
    // A failed badge fetch should never surface as a page error.
    shouldRetryOnError: false,
    // Don't blank the badge while a revalidation is in flight — the
    // count should only change when a NEW answer arrives.
    keepPreviousData: true,
  });
}

/**
 * Same cache, but adds no polling of its own. Used by the writer,
 * which needs the current payload but is always mounted alongside a
 * real subscriber (the badge, the dots, the notifier) — a second timer
 * would just be another request for the same answer.
 */
function usePassiveUnreadFeed() {
  return useSWR<UnreadMessagesResponse>(UNREAD_KEY, adminFetcher, {
    refreshInterval: 0,
    revalidateOnFocus: false,
    shouldRetryOnError: false,
    keepPreviousData: true,
  });
}

/** Apply stamps to a map, raising timestamps only. Returns the same
 *  reference when nothing changes so callers can skip the round trip. */
function applyStamps(
  map: ReadStateMap,
  entries: ReadStateEntry[]
): ReadStateMap {
  let changed = false;
  const next = { ...map };
  for (const { key, at } of entries) {
    if (!key || !(at > (next[key] ?? 0))) continue;
    next[key] = at;
    changed = true;
  }
  return changed ? next : map;
}

/**
 * This admin's per-thread view stamps. Empty until the feed lands —
 * which is also when `conversations` lands, so no consumer ever sees
 * one without the other.
 */
export function useSmsViewedMap(): ReadStateMap {
  return useUnreadMessagesFeed().data?.viewed ?? EMPTY;
}

/** Threads this admin has already been desktop-notified about, on any
 *  device — so a second browser doesn't re-announce texts the first
 *  one already popped. */
export function useSmsAnnouncedMap(): ReadStateMap {
  return useUnreadMessagesFeed().data?.announced ?? EMPTY;
}

/**
 * Writers for the two read-state maps.
 *
 * Each returns immediately: the SWR cache is updated optimistically so
 * the dot grays and the badge drops on the next paint, then the POST
 * confirms and swaps in the server's merged map. A failed sync keeps
 * the optimistic value rather than rolling back — re-lighting a thread
 * the admin is currently reading would be worse than a stamp that
 * lands on the next click.
 */
export function useSmsReadStateWriter() {
  const { data, mutate } = usePassiveUnreadFeed();

  const stamp = useCallback(
    (field: "viewed" | "announced", entries: ReadStateEntry[]) => {
      if (entries.length === 0) return;
      const current = data;
      if (!current) {
        // Feed hasn't landed yet, so there's nothing to update
        // optimistically — record the stamp and let the refetch show it.
        void fetch(READ_STATE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [field]: entries }),
        })
          .then(() => mutate())
          .catch(() => {
            // Best-effort; the next click re-sends.
          });
        return;
      }

      const stamped = applyStamps(current[field], entries);
      // Nothing new to record — bail before the network. Matters
      // because thread selection re-runs on re-render, and each of
      // those would otherwise be a write.
      if (stamped === current[field]) return;

      const optimistic: UnreadMessagesResponse = {
        ...current,
        [field]: stamped,
        unreadCount: countUnread(
          current.conversations,
          field === "viewed" ? stamped : current.viewed
        ),
      };

      void mutate(
        async (prev) => {
          const base = prev ?? current;
          const res = await fetch(READ_STATE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ [field]: entries }),
          });
          if (!res.ok) throw new Error(`Read-state sync failed (${res.status})`);
          const saved = (await res.json()) as ReadStateResponse;
          return {
            ...base,
            viewed: saved.viewed,
            announced: saved.announced,
            unreadCount: countUnread(base.conversations, saved.viewed),
          };
        },
        {
          optimisticData: optimistic,
          revalidate: false,
          rollbackOnError: false,
          throwOnError: false,
        }
      );
    },
    [data, mutate]
  );

  const markViewed = useCallback(
    (entries: ReadStateEntry[]) => stamp("viewed", entries),
    [stamp]
  );
  const markAnnounced = useCallback(
    (entries: ReadStateEntry[]) => stamp("announced", entries),
    [stamp]
  );

  return { markViewed, markAnnounced };
}

/**
 * Count of SMS threads waiting on a reply that this admin hasn't
 * opened yet — the nav badge's number. Computed server-side (see
 * `countUnread`) and recomputed locally only for optimistic updates,
 * so there is exactly one definition of the rule.
 */
export function useUnreadMessageCount(): number {
  return useUnreadMessagesFeed().data?.unreadCount ?? 0;
}

/**
 * Blue count pill for the nav. Renders nothing at zero so the nav
 * stays quiet when there's nothing to answer.
 */
export function NotificationBadge({
  count,
  className,
}: {
  count: number;
  className?: string;
}) {
  if (count <= 0) return null;
  return (
    <span
      aria-label={`${count} unread message${count === 1 ? "" : "s"}`}
      className={cn(
        "inline-flex min-w-[1.125rem] items-center justify-center rounded-full bg-blue-600 px-1 text-[10px] font-semibold leading-[1.125rem] tabular-nums",
        // `text-white!`, not `text-white`: this badge renders inside
        // DropdownMenuItem, whose shadcn class list carries
        // `focus:**:text-accent-foreground` — a DESCENDANT rule
        // (specificity 0,3,0) that beats the badge's own `text-white`
        // (0,1,0) and repaints the count near-black on a blue pill.
        // Radix focuses menu items on hover, so it fired just from
        // moving the mouse over the Messages row.
        "text-white!",
        className
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

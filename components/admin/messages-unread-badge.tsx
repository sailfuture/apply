"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { adminFetcher } from "@/lib/admin-fetcher";
import { cn } from "@/lib/utils";
import type { UnreadMessagesResponse } from "@/app/api/admin/messages/unread/route";

/** localStorage map of `${contactType}:${contactId}` → newest message
 *  timestamp the admin has looked at. Owned by /admin/messages; the
 *  nav badge is a second reader of the same key. */
const VIEWED_KEY = "sms-viewed-v1";

/** Same-tab notification that the viewed map changed — `storage` only
 *  fires in OTHER tabs, so the inbox dispatches this one by hand and
 *  the badge drops immediately when a thread is opened. */
export const SMS_VIEWED_EVENT = "sms-viewed-changed";

/**
 * Count of SMS threads waiting on a reply that this admin hasn't
 * opened yet — the nav badge's number.
 *
 * Two halves, matching the inbox's own unread dots exactly:
 *   - server: the thread's newest message is inbound (needs a reply)
 *   - client: `sms-viewed-v1` has no view newer than that message
 *
 * The viewed map is read after mount (never during render) so SSR and
 * hydration produce identical markup — the badge pops in a tick later.
 */
/**
 * Live view of the `sms-viewed-v1` map — the client half of "unread".
 * Reads after mount (never during render) so SSR and hydration match,
 * then stays current via the same-tab event and cross-tab `storage`.
 * Shared by the nav badge, the dashboard's Needs-a-reply card, and
 * anything else that must agree with the inbox's dots.
 */
export function useSmsViewedMap(): Record<string, number> {
  const [viewed, setViewed] = useState<Record<string, number>>({});
  useEffect(() => {
    const read = () => {
      try {
        setViewed(JSON.parse(localStorage.getItem(VIEWED_KEY) ?? "{}"));
      } catch {
        // Corrupt/blocked storage — treat everything as unviewed.
      }
    };
    const timer = setTimeout(read, 0);
    window.addEventListener(SMS_VIEWED_EVENT, read);
    window.addEventListener("storage", read);
    return () => {
      clearTimeout(timer);
      window.removeEventListener(SMS_VIEWED_EVENT, read);
      window.removeEventListener("storage", read);
    };
  }, []);
  return viewed;
}

export function useUnreadMessageCount(): number {
  const { data } = useSWR<UnreadMessagesResponse>(
    "/api/admin/messages/unread",
    adminFetcher,
    {
      // The nav is mounted on every admin page; a minute of staleness
      // on a badge is fine and keeps this off the hot path.
      refreshInterval: 60_000,
      revalidateOnFocus: true,
      // A failed badge fetch should never surface as a page error.
      shouldRetryOnError: false,
    }
  );
  const viewed = useSmsViewedMap();

  return (data?.conversations ?? []).filter(
    (c) => (viewed[c.key] ?? 0) < c.lastAt
  ).length;
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
        "inline-flex min-w-[1.125rem] items-center justify-center rounded-full bg-blue-600 px-1 text-[10px] font-semibold leading-[1.125rem] text-white tabular-nums",
        className
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

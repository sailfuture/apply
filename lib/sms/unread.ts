/**
 * Shapes and rules for the admin "needs a reply" feed — the data
 * behind the nav badge, the inbox's dots and the dashboard's
 * Needs-a-Reply card.
 *
 * Lives in `lib` rather than in the route so the client can import the
 * COUNTING RULE (not just the types) and apply it to an optimistic
 * update without the definition drifting from the server's.
 */

/** One conversation whose newest message is inbound — i.e. a contact
 *  texted us and nobody has replied. */
export interface UnreadConversation {
  /** `${contactType}:${contactId}` — the key every read-state map is
   *  keyed by. */
  key: string;
  /** `created_at` of the newest message on the thread (unix ms). */
  lastAt: number;
  /** Who texted — a record name where we can resolve one cheaply,
   *  otherwise the formatted phone. Powers the desktop notification;
   *  the badge ignores it. */
  name: string;
  /** First line of the inbound text, truncated — the notification
   *  body. */
  preview: string;
  /** True when the message is newer than the badge window. The nav
   *  badge only counts recent threads — a needs-reply thread flagged
   *  months ago (a "Thanks!" nobody replied to) is backlog for the
   *  dashboard card, not a notification. Computed server-side so
   *  clients never call the clock during render. */
  recent: boolean;
}

/** `${contactType}:${contactId}` → newest message timestamp the admin
 *  has looked at (or, for `announced`, already raised a desktop
 *  notification for). */
export type ReadStateMap = Record<string, number>;

export interface UnreadMessagesResponse {
  conversations: UnreadConversation[];
  /** THIS admin's per-thread view stamps, from their Clerk user —
   *  travels with the account, not the browser. Ships in the same
   *  payload as `conversations` on purpose: the badge needs both
   *  halves to compute a count, and delivering them separately is
   *  what made it flash a too-high number and then drop. */
  viewed: ReadStateMap;
  /** Threads this admin has already been desktop-notified about, on
   *  any device. Same reasoning as `viewed`. */
  announced: ReadStateMap;
  /** `countUnread(conversations, viewed)`, precomputed. */
  unreadCount: number;
}

/**
 * The badge number. A thread counts when ALL of:
 *   - server: its newest message is inbound (it's in `conversations`)
 *   - read state: no view stamp at or after that message
 *   - recency: the server flagged it `recent`
 */
export function countUnread(
  conversations: UnreadConversation[],
  viewed: ReadStateMap
): number {
  return conversations.filter(
    (c) => c.recent && (viewed[c.key] ?? 0) < c.lastAt
  ).length;
}

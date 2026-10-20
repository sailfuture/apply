import type { XanoCall, XanoSmsMessage } from "@/lib/xano";

/**
 * Deep links into the Quo web app. Pure string work — safe to import
 * from client components (unlike lib/quo.ts, which reads the API key).
 *
 * Quo's own links (the `links.quo` field on webhook events, stored on
 * `registration_calls.quo_link`) look like
 *
 *   https://my.quo.com/inbox/<line id>/c/<conversation id>?at=<activity id>
 *
 * so a conversation link is the same URL without `?at=`, and any
 * stored link tells us the Main Line's id. Calls the 15-minute sync
 * imported (rather than the webhook) carry no link and no
 * conversation id — those fall back to the contact's conversation,
 * which in Quo is the same thread (Quo files a number's calls and
 * texts together).
 */

const QUO_APP = "https://my.quo.com";

export function quoConversationUrl(
  lineId: string,
  conversationId: string,
  activityId?: string | null
): string {
  const base = `${QUO_APP}/inbox/${encodeURIComponent(lineId)}/c/${encodeURIComponent(conversationId)}`;
  return activityId ? `${base}?at=${encodeURIComponent(activityId)}` : base;
}

/** The phone-line id inside a stored Quo link, or null. */
export function lineIdFromQuoLink(link: string | null | undefined): string | null {
  const m = /\/inbox\/(PN[A-Za-z0-9]+)\//.exec(link ?? "");
  return m ? m[1] : null;
}

/**
 * The Quo conversation for one contact's thread, from whatever rows
 * carry it: the newest text or call with a conversation id wins.
 * `lineId` may be null when nothing in the thread was webhook-written
 * and the server couldn't ask Quo; then there is no link.
 */
export function threadQuoUrl(
  messages: Pick<XanoSmsMessage, "created_at" | "quo_conversation_id">[],
  calls: Pick<XanoCall, "started_at" | "created_at" | "quo_conversation_id" | "quo_link">[],
  lineId: string | null
): string | null {
  let bestAt = -1;
  let conversationId: string | null = null;
  for (const m of messages) {
    const id = (m.quo_conversation_id ?? "").trim();
    if (id && m.created_at > bestAt) {
      bestAt = m.created_at;
      conversationId = id;
    }
  }
  for (const c of calls) {
    const id = (c.quo_conversation_id ?? "").trim();
    const at = c.started_at || c.created_at;
    if (id && at > bestAt) {
      bestAt = at;
      conversationId = id;
    }
  }
  const line = lineId ?? calls.map((c) => lineIdFromQuoLink(c.quo_link)).find(Boolean) ?? null;
  return conversationId && line ? quoConversationUrl(line, conversationId) : null;
}

/**
 * Where "Open in Quo" on one call should land: Quo's own link to the
 * call when we have it, else the call pinned inside its conversation,
 * else the thread's conversation (sync-imported calls), else nothing.
 */
export function callQuoUrl(
  call: Pick<XanoCall, "quo_link" | "quo_conversation_id" | "quo_call_id">,
  threadUrl: string | null
): string | null {
  const own = (call.quo_link ?? "").trim();
  if (own) return own;
  const conversationId = (call.quo_conversation_id ?? "").trim();
  const line = lineIdFromQuoLink(threadUrl);
  if (conversationId && line) {
    return quoConversationUrl(line, conversationId, call.quo_call_id);
  }
  return threadUrl;
}

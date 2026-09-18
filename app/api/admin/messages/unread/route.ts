import { NextResponse } from "next/server";
import { withServerTiming } from "@/lib/server-timing";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import {
  counterpartyPhone,
  messageContactRef,
  phoneFromAdhocId,
} from "@/lib/sms/contacts";
import { formatUSPhone } from "@/lib/phone";
import { getSmsReadState } from "@/lib/sms/read-state";
import { countUnread } from "@/lib/sms/unread";

// Re-exported so the existing `import type { UnreadMessagesResponse }
// from ".../messages/unread/route"` call sites keep resolving; the
// definitions themselves live in lib so the client can import the
// counting RULE alongside them.
export type {
  UnreadConversation,
  UnreadMessagesResponse,
  ReadStateMap,
} from "@/lib/sms/unread";
import type { UnreadConversation, UnreadMessagesResponse } from "@/lib/sms/unread";

/** Nav-badge recency window. A thread needs a reply for as long as
 *  its newest message is inbound — forever, for a text that needs no
 *  answer. Without a cutoff, every such thread an admin never
 *  explicitly opened would bubble the nav indefinitely. */
const BADGE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** How far back the feed reads. The badge only counts the last 7
 *  days, and the dashboard's Needs-a-Reply card lists the rest as
 *  backlog — a thread whose newest message is older than this has
 *  gone unanswered for two months and is no longer a useful prompt.
 *  Reading only this window is what turned the badge's poll from the
 *  whole 700 KB table into a few KB. */
const FEED_LOOKBACK_MS = 60 * 24 * 60 * 60 * 1000;

/** Cap on name resolution. Unread counts are small in practice; this
 *  keeps a pathological backlog from fanning out dozens of lookups on
 *  an endpoint that polls from every admin page. */
const NAME_LOOKUP_CAP = 10;
const PREVIEW_CHARS = 120;

/**
 * Needs-reply conversations for the nav badge.
 *
 * Deliberately a separate, cheap endpoint rather than a reuse of the
 * inbox feed (`GET /api/admin/messages`): the badge renders on EVERY
 * admin page and polls, while the feed additionally loads families,
 * inquiries, camp rows, waivers, TASCO rows and (with `?yearId=`) the
 * whole application/progress set just to label conversations. This one
 * touches `sms_messages` only — no names, no stages.
 *
 * Returns BOTH halves of "unread" in one payload: the threads whose
 * latest message is inbound, and this admin's own read state (which
 * of those they've already opened, and which they've already been
 * notified about) from their Clerk user. One request, one answer —
 * the client never has to combine a server list with a separately
 * loaded local map, which is what used to make the badge flash a
 * too-high count on every page load.
 */
async function handleGET() {
  try {
    await requireAdmin();
    // Newest-first, so the FIRST row seen per contact is that
    // thread's latest message. Only the recent window is read — see
    // `FEED_LOOKBACK_MS`. The read state rides along in the same
    // payload — see `UnreadMessagesResponse.viewed`.
    const [messages, readState] = await Promise.all([
      xano.smsMessages.getSince(Date.now() - FEED_LOOKBACK_MS),
      getSmsReadState(),
    ]);
    const seen = new Set<string>();
    const pending: Array<{
      key: string;
      type: string;
      id: number;
      lastAt: number;
      preview: string;
      phone: string;
    }> = [];
    for (const m of messages) {
      const contact = messageContactRef(m);
      if (!contact) continue;
      const key = `${contact.type}:${contact.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (m.direction === "inbound") {
        pending.push({
          key,
          type: contact.type,
          id: contact.id,
          lastAt: m.created_at,
          preview: (m.body ?? "").trim().slice(0, PREVIEW_CHARS),
          phone: counterpartyPhone(m),
        });
      }
    }

    // Resolve sender names only for the threads we're returning, and
    // only up to the cap — with nothing unread (the common case) this
    // whole block is skipped and the endpoint stays a single scan.
    const toName = pending.slice(0, NAME_LOOKUP_CAP);
    const needsScan = (t: string) =>
      toName.some((p) => p.type === t);
    const [camps, waivers, tascos] = await Promise.all([
      needsScan("camp")
        ? xano.summerCamp.getAll().catch(() => [])
        : Promise.resolve([]),
      needsScan("visit")
        ? xano.websiteWaivers.getAll().catch(() => [])
        : Promise.resolve([]),
      needsScan("tasco")
        ? xano.tascoSummerVisits.getAll().catch(() => [])
        : Promise.resolve([]),
    ]);

    const names = await Promise.all(
      toName.map(async (p) => {
        const fallback = formatUSPhone(p.phone) || p.phone || "Unknown number";
        try {
          if (p.type === "adhoc") {
            return formatUSPhone(phoneFromAdhocId(p.id)) || fallback;
          }
          if (p.type === "family") {
            const f = await xano.families.getById(p.id);
            return f?.family_name?.trim() || fallback;
          }
          if (p.type === "inquiry") {
            const i = await xano.inquiries.getById(p.id);
            const n = `${i?.primary_first_name ?? ""} ${i?.primary_last_name ?? ""}`.trim();
            return n || fallback;
          }
          if (p.type === "camp") {
            const c = camps.find((r) => r.id === p.id);
            const n = `${c?.primary_parent_first_name ?? ""} ${c?.primary_parent_last_name ?? ""}`.trim();
            return n || fallback;
          }
          if (p.type === "visit") {
            const w = waivers.find((r) => r.id === p.id);
            return (w?.parent_name ?? "").trim() || fallback;
          }
          if (p.type === "tasco") {
            const t = tascos.find((r) => r.id === p.id);
            const student = (t?.student_name ?? "").trim();
            return student ? `Parent of ${student}` : fallback;
          }
        } catch {
          // Name lookup is best-effort — the phone still identifies
          // the sender, and the badge doesn't use the name at all.
        }
        return fallback;
      })
    );

    const cutoff = Date.now() - BADGE_WINDOW_MS;
    const conversations: UnreadConversation[] = pending.map((p, i) => ({
      key: p.key,
      lastAt: p.lastAt,
      name:
        names[i] ?? (formatUSPhone(p.phone) || p.phone || "Unknown number"),
      preview: p.preview,
      recent: p.lastAt > cutoff,
    }));

    return NextResponse.json({
      conversations,
      viewed: readState.viewed,
      announced: readState.announced,
      unreadCount: countUnread(conversations, readState.viewed),
    } satisfies UnreadMessagesResponse);
  } catch (err) {
    return handleAdminError(err);
  }
}

export const GET = withServerTiming(handleGET);

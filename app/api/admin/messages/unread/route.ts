import { NextResponse } from "next/server";
import { withServerTiming } from "@/lib/server-timing";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import {
  callContactRef,
  counterpartyPhone,
  messageContactRef,
  normPhone,
  phoneFromAdhocId,
} from "@/lib/sms/contacts";
import { callNeedsReply, callPreview } from "@/lib/calls";
import { formatUSPhone } from "@/lib/phone";
import { getSmsReadState } from "@/lib/sms/read-state";
import { countUnread } from "@/lib/sms/unread";
import { isFollowUpTemplate } from "@/lib/nurture/templates";

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
 * touches `sms_messages` and `registration_calls` only — no names, no
 * stages. A missed call or a voicemail counts the same as an
 * unanswered inbound text (user decision, 2026-10-20); an answered
 * call, or one we placed, settles the thread like an outbound text.
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
    const since = Date.now() - FEED_LOOKBACK_MS;
    const [messages, calls, readState] = await Promise.all([
      xano.smsMessages.getSince(since),
      xano.calls.getSince(since),
      getSmsReadState(),
    ]);
    // Texts and calls as one newest-first stream of "things that
    // count", so the first event seen per contact decides the thread.
    // An automated follow-up isn't an answer: it's left out, so a
    // reminder going out can't hide a question.
    const events = [
      ...messages
        .filter(
          (m) => !(m.direction === "outbound" && isFollowUpTemplate(m.template))
        )
        .map((m) => ({ at: m.created_at, contact: messageContactRef(m), msg: m, call: null })),
      ...calls.map((c) => ({
        at: c.started_at || c.created_at,
        contact: callContactRef(c),
        msg: null,
        call: c,
      })),
    ].sort((a, b) => b.at - a.at);
    const seen = new Set<string>();
    const pending: Array<{
      key: string;
      type: string;
      id: number;
      lastAt: number;
      preview: string;
      phone: string;
      kind: "text" | "call";
    }> = [];
    for (const e of events) {
      if (!e.contact) continue;
      const key = `${e.contact.type}:${e.contact.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (e.msg && e.msg.direction === "inbound") {
        pending.push({
          key,
          type: e.contact.type,
          id: e.contact.id,
          lastAt: e.at,
          preview: (e.msg.body ?? "").trim().slice(0, PREVIEW_CHARS),
          phone: counterpartyPhone(e.msg),
          kind: "text",
        });
      } else if (e.call && callNeedsReply(e.call)) {
        pending.push({
          key,
          type: e.contact.type,
          id: e.contact.id,
          lastAt: e.at,
          preview: callPreview(e.call).slice(0, PREVIEW_CHARS),
          phone: normPhone(e.call.counterparty),
          kind: "call",
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
      kind: p.kind,
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

import { NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import {
  counterpartyPhone,
  messageContactRef,
  phoneFromAdhocId,
} from "@/lib/sms/contacts";
import { formatUSPhone } from "@/lib/phone";

/** One conversation whose newest message is inbound — i.e. a contact
 *  texted us and nobody has replied. The nav badge subtracts the ones
 *  the admin has already opened (tracked per browser in localStorage
 *  by the inbox), so the timestamp travels with the key. */
export interface UnreadConversation {
  /** `${contactType}:${contactId}` — the same key the inbox writes to
   *  its `sms-viewed-v1` localStorage map. */
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
  /** True when the message is newer than `BADGE_WINDOW_MS`. The nav
   *  badge only counts recent threads — a needs-reply thread flagged
   *  months ago (a "Thanks!" nobody replied to, or one this browser's
   *  viewed map never saw) is backlog for the dashboard card, not a
   *  notification. Computed here so clients never call the clock
   *  during render. */
  recent: boolean;
}

/** Nav-badge recency window. The server flags a thread as needing a
 *  reply for as long as its newest message is inbound — forever, for
 *  a text that needs no answer — and the client's viewed map is
 *  per-browser. Without a cutoff every new device/browser bubbles
 *  the nav with months-old texts. */
const BADGE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Cap on name resolution. Unread counts are small in practice; this
 *  keeps a pathological backlog from fanning out dozens of lookups on
 *  an endpoint that polls from every admin page. */
const NAME_LOOKUP_CAP = 10;
const PREVIEW_CHARS = 120;

export interface UnreadMessagesResponse {
  conversations: UnreadConversation[];
}

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
 * "Unread" here is only the server half: the latest message on the
 * thread is inbound. The client half (has this admin already opened
 * the thread?) lives in localStorage, matching the inbox's own dots —
 * see `isUnread` in /admin/messages.
 */
export async function GET() {
  try {
    await requireAdmin();
    // Newest-first from Xano, so the FIRST row seen per contact is
    // that thread's latest message.
    const messages = await xano.smsMessages.getAll();
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
    } satisfies UnreadMessagesResponse);
  } catch (err) {
    return handleAdminError(err);
  }
}

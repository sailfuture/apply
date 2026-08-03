import { NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import { messageContactRef } from "@/lib/sms/contacts";

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
}

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
    const conversations: UnreadConversation[] = [];
    for (const m of messages) {
      const contact = messageContactRef(m);
      if (!contact) continue;
      const key = `${contact.type}:${contact.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (m.direction === "inbound") {
        conversations.push({ key, lastAt: m.created_at });
      }
    }
    return NextResponse.json({
      conversations,
    } satisfies UnreadMessagesResponse);
  } catch (err) {
    return handleAdminError(err);
  }
}

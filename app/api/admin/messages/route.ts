import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano, type XanoSmsMessage } from "@/lib/xano";
import { sendSms } from "@/lib/sms/send";
import {
  getContactRecipient,
  type SmsContactType,
} from "@/lib/sms/contacts";

/** One row in the global inbox's conversation list — the latest text
 *  per contact plus a needs-reply flag. A contact is a family, an
 *  inquiry, or a summer-camp parent; threads are one continuous
 *  history per contact, never split by academic year. */
export interface SmsConversation {
  contactType: SmsContactType;
  contactId: number;
  /** Display name — family name, or the inquiry/camp parent's name. */
  name: string;
  lastBody: string;
  lastAt: number;
  lastDirection: string;
  messageCount: number;
  /** True when the most recent message is inbound (contact texted, no
   *  reply yet) — drives the unread dot in the inbox. */
  needsReply: boolean;
}

/** Which contact a logged message belongs to — exactly one of the
 *  three FK columns is set per row (family wins if legacy rows ever
 *  carry more than one). */
function messageContact(
  m: XanoSmsMessage
): { type: SmsContactType; id: number } | null {
  if (m.registration_families_id) {
    return { type: "family", id: m.registration_families_id };
  }
  if (m.registration_inquiry_id) {
    return { type: "inquiry", id: m.registration_inquiry_id };
  }
  if (m.registration_summer_camp_id) {
    return { type: "camp", id: m.registration_summer_camp_id };
  }
  return null;
}

function parseContactParams(req: NextRequest): {
  type: SmsContactType;
  id: number;
} | null {
  // Preferred: ?contactType=family|inquiry|camp&contactId=N.
  // Back-compat: ?familyId=N (the family-record drawer predates the
  // contact model).
  const typeParam = req.nextUrl.searchParams.get("contactType");
  const idParam =
    req.nextUrl.searchParams.get("contactId") ??
    req.nextUrl.searchParams.get("familyId");
  if (!idParam) return null;
  const id = Number(idParam);
  if (!Number.isFinite(id)) return null;
  const type: SmsContactType =
    typeParam === "inquiry" || typeParam === "camp" ? typeParam : "family";
  return { type, id };
}

/**
 * Admin SMS messages.
 *
 *  - `GET ?contactType=&contactId=` (or legacy `?familyId=`) — one
 *    contact's text thread + the recipient summary (who it goes to,
 *    opt-out state).
 *  - `GET` (no params) — the global inbox feed: one conversation per
 *    contact across families, inquiries, and summer-camp parents.
 *  - `POST { contactType?, contactId?, familyId?, body }` — send a
 *    manual text to the contact's phone and log it on their thread.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const contact = parseContactParams(req);

    if (!contact) {
      // Global inbox feed — group the flat message log into one
      // conversation per contact, keyed on the newest message.
      const [messages, families, inquiries, campRows] = await Promise.all([
        xano.smsMessages.getAll(),
        xano.families.getAll().catch(() => []),
        xano.inquiries.getAll().catch(() => []),
        xano.summerCamp.getAll().catch(() => []),
      ]);
      const familyName = new Map(
        families.map((f) => [f.id, f.family_name])
      );
      const inquiryName = new Map(
        inquiries.map((i) => [
          i.id,
          `${i.primary_first_name ?? ""} ${i.primary_last_name ?? ""}`.trim(),
        ])
      );
      const campName = new Map(
        campRows.map((c) => [
          c.id,
          `${c.primary_parent_first_name ?? ""} ${c.primary_parent_last_name ?? ""}`.trim(),
        ])
      );
      const nameFor = (type: SmsContactType, id: number): string => {
        const raw =
          type === "family"
            ? familyName.get(id)
            : type === "inquiry"
              ? inquiryName.get(id)
              : campName.get(id);
        if (raw && raw.trim()) return raw.trim();
        return type === "family"
          ? `Family #${id}`
          : type === "inquiry"
            ? `Inquiry #${id}`
            : `Camp #${id}`;
      };

      const byContact = new Map<
        string,
        {
          type: SmsContactType;
          id: number;
          last: XanoSmsMessage;
          count: number;
        }
      >();
      for (const m of messages) {
        const c = messageContact(m);
        if (!c) continue;
        const key = `${c.type}:${c.id}`;
        const existing = byContact.get(key);
        if (!existing) {
          byContact.set(key, { ...c, last: m, count: 1 });
        } else {
          existing.count += 1;
          if (m.created_at > existing.last.created_at) existing.last = m;
        }
      }
      const conversations: SmsConversation[] = [...byContact.values()]
        .map(({ type, id, last, count }) => ({
          contactType: type,
          contactId: id,
          name: nameFor(type, id),
          lastBody: last.body,
          lastAt: last.created_at,
          lastDirection: last.direction,
          messageCount: count,
          needsReply: last.direction === "inbound",
        }))
        .sort((a, b) => b.lastAt - a.lastAt);
      return NextResponse.json({ conversations });
    }

    const [messages, recipient] = await Promise.all([
      xano.smsMessages.getByContact(contact.type, contact.id),
      getContactRecipient(contact.type, contact.id),
    ]);
    return NextResponse.json({ messages, recipient });
  } catch (err) {
    return handleAdminError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { admin } = await requireAdmin();
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 }
      );
    }

    // Contact resolution mirrors the GET params: contactType/contactId
    // preferred, bare familyId honored for older callers.
    const rawType = body?.contactType;
    const contactType: SmsContactType =
      rawType === "inquiry" || rawType === "camp" ? rawType : "family";
    const contactId = Number(body?.contactId ?? body?.familyId);
    if (!Number.isFinite(contactId)) {
      return NextResponse.json(
        { error: "contactId (or familyId) is required" },
        { status: 400 }
      );
    }
    const text = typeof body?.body === "string" ? body.body.trim() : "";
    if (!text) {
      return NextResponse.json(
        { error: "Message body is required" },
        { status: 400 }
      );
    }

    const result = await sendSms({
      contact: { type: contactType, id: contactId },
      body: text,
      template: "manual",
      studentId: body?.studentId ?? null,
      yearId: body?.yearId ?? null,
      author: { email: admin.email, name: admin.name },
    });

    if (!result.ok) {
      // Map the skip/error to an HTTP status + a human message the
      // composer can toast. `opted_out` is a 409 (conflict with a
      // standing state), missing/unconfigured are 422, a real Twilio
      // failure is 502.
      const status =
        result.skipped === "opted_out"
          ? 409
          : result.skipped
            ? 422
            : 502;
      const message =
        result.skipped === "opted_out"
          ? "This contact has opted out of text messages."
          : result.skipped === "no_phone"
            ? "No valid phone number on file for this contact."
            : result.skipped === "not_configured"
              ? "SMS isn't configured yet (missing Twilio credentials)."
              : (result.error ?? "Failed to send message.");
      return NextResponse.json(
        { error: message, skipped: result.skipped ?? null },
        { status }
      );
    }

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return handleAdminError(err);
  }
}

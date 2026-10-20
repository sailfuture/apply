import { NextRequest, NextResponse } from "next/server";
import { withServerTiming } from "@/lib/server-timing";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import {
  xano,
  LEAD_NOTE_SOURCES,
  type LeadNoteSource,
  type XanoCall,
} from "@/lib/xano";
import { sendSms } from "@/lib/sms/send";
import {
  counterpartyPhone,
  getContactRecipient,
  messageContactRef as messageContact,
  normPhone,
  phoneFromAdhocId,
  resolvePrimaryParent,
  type SmsContactType,
} from "@/lib/sms/contacts";
import { resolveMainLine } from "@/lib/quo";
import { writeClosedConversation } from "@/lib/app-settings";
import { threadQuoUrl } from "@/lib/quo/links";
import { buildInboxFeed } from "@/lib/sms/inbox-feed";
import { bumpLeadReachOut } from "@/lib/leads";

// The conversation-list types live with the builder in
// lib/sms/inbox-feed.ts; re-exported so the inbox's
// `import type { … } from "@/app/api/admin/messages/route"` keeps
// resolving.
export type { ConversationStage, SmsConversation } from "@/lib/sms/inbox-feed";

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
    typeParam === "inquiry" ||
    typeParam === "camp" ||
    typeParam === "visit" ||
    typeParam === "tasco" ||
    typeParam === "adhoc"
      ? typeParam
      : "family";
  return { type, id };
}

/**
 * Admin SMS messages.
 *
 *  - `GET ?contactType=&contactId=` (or legacy `?familyId=`) — one
 *    contact's text thread + their Main Line calls + the recipient
 *    summary (who it goes to, opt-out state) + the thread's Quo link.
 *  - `GET [?yearId=][&since=]` (no contact params) — the global inbox
 *    feed: one conversation per contact across families, inquiries,
 *    and summer-camp parents; `since` narrows it to a recent window,
 *    and a missing `yearId` means the admin default year.
 *  - `POST { contactType?, contactId?, familyId?, body }` — send a
 *    manual text to the contact's phone and log it on their thread.
 */
async function handleGET(req: NextRequest) {
  try {
    await requireAdmin();
    const contact = parseContactParams(req);

    if (!contact) {
      // Global inbox feed — one conversation per contact, newest
      // first, with a pipeline-stage annotation per family for the
      // filter chips and the enrolled/recruitment split. The stages
      // are scoped to `?yearId=`; without one the builder resolves
      // the same default year the YearSelector injects, so the inbox
      // can fetch on first render instead of waiting for the URL.
      //
      // `?since=<unix ms>` asks for the WINDOW: only texts and calls
      // at or after that instant, with the parent/student search
      // haystack skipped. The inbox paints from that first and swaps
      // in the full feed (no `since`) when it lands — same shape, so
      // the two merge by contact key. See lib/sms/inbox-feed.ts.
      const yearId = Number(req.nextUrl.searchParams.get("yearId"));
      const sinceParam = req.nextUrl.searchParams.get("since");
      const since = sinceParam === null ? null : Number(sinceParam);
      const feed = await buildInboxFeed({
        yearId: Number.isFinite(yearId) && yearId > 0 ? yearId : null,
        since: since !== null && Number.isFinite(since) && since > 0 ? since : null,
      });
      return NextResponse.json({
        conversations: feed.conversations,
        yearId: feed.yearId,
      });
    }

    // Ad-hoc threads have no FK column to query on — filter the full
    // log down to no-contact rows whose counterparty is this number.
    const messagesPromise =
      contact.type === "adhoc"
        ? xano.smsMessages.getAll().then((all) => {
            const phone = phoneFromAdhocId(contact.id);
            return all
              .filter(
                (m) =>
                  messageContact(m)?.type === "adhoc" &&
                  counterpartyPhone(m) === phone
              )
              .sort((a, b) => a.created_at - b.created_at);
          })
        : xano.smsMessages.getByContact(contact.type, contact.id);
    // Phone calls on the Main Line with this contact — they sit in the
    // thread between the texts. Ad-hoc numbers have no FK column on
    // the calls table either, so match on the counterparty number.
    const callsPromise: Promise<XanoCall[]> =
      contact.type === "adhoc"
        ? xano.calls.getAll().then((all) => {
            const phone = phoneFromAdhocId(contact.id);
            return all
              .filter(
                (c) =>
                  !c.registration_families_id &&
                  !c.registration_inquiry_id &&
                  !c.registration_summer_camp_id &&
                  !c.website_liability_waiver_id &&
                  !c.tasco_summer_visit_id &&
                  normPhone(c.counterparty) === phone
              )
              .sort((a, b) => a.started_at - b.started_at || a.id - b.id);
          })
        : xano.calls.getByContact(contact.type, contact.id);
    const [messages, recipient, calls, lineId] = await Promise.all([
      messagesPromise,
      getContactRecipient(contact.type, contact.id),
      callsPromise,
      // The Main Line's Quo id, for "Open in Quo" links. Best-effort:
      // without the API key (or Quo down) the stored links still
      // carry it, and a thread with neither simply has no button.
      process.env.QUO_API_KEY
        ? resolveMainLine()
            .then((n) => n.id)
            .catch(() => null)
        : Promise.resolve(null),
    ]);
    const quoConversationUrl = threadQuoUrl(messages, calls, lineId);
    return NextResponse.json({
      messages,
      recipient,
      calls,
      quoConversationUrl,
    });
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
      rawType === "inquiry" ||
      rawType === "camp" ||
      rawType === "visit" ||
      rawType === "tasco" ||
      rawType === "adhoc"
        ? rawType
        : "family";
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
              ? "Texting isn't set up yet (the texting service's credentials are missing)."
              : (result.error ?? "Failed to send message.");
      return NextResponse.json(
        { error: message, skipped: result.skipped ?? null },
        { status }
      );
    }

    // Manual texts count as contact — stamp the lead's
    // `last_reach_out` the same way a comms-log note does, so the
    // recruitment lists' "Last contact" column reflects the send.
    // Best-effort: bumpLeadReachOut logs and swallows its own errors.
    if (LEAD_NOTE_SOURCES.includes(contactType as LeadNoteSource)) {
      await bumpLeadReachOut(contactType as LeadNoteSource, contactId);
    }

    // Sent-but-unlogged: the text went out (so this is still a 201),
    // but the Xano log write failed — without a row, the message is
    // invisible in every thread until the Twilio sync backfills it.
    // Tell the sender instead of letting the thread quietly not show
    // what they just sent.
    if (!result.logId) {
      return NextResponse.json(
        {
          ...result,
          warning:
            "The text was sent, but logging it failed — it may not show " +
            "in the thread until the next Twilio sync. If this keeps " +
            "happening, check the Xano sms_messages Add Record endpoint.",
        },
        { status: 201 }
      );
    }

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return handleAdminError(err);
  }
}

/**
 * `PATCH { contactType: "family", contactId, optedOut }` — manually
 * flip a family's SMS opt-out state (the account-holder parent's
 * `sms_opted_out_at`). Admin uses this to opt a family back in after
 * an accidental STOP, or to opt one out by hand.
 *
 * Scope note: only family contacts carry an app-side opt-out flag on a
 * parent row. And our flag is only half the story — if the parent
 * actually texted STOP, Twilio/carriers keep blocking sends (error
 * 21610) until the parent texts START from their phone; the UI copy
 * says so.
 */
export async function PATCH(req: NextRequest) {
  try {
    const { admin } = await requireAdmin();
    const body = await req.json().catch(() => null);
    const contactId = Number(body?.contactId);

    // Close / reopen — any contact type. Closing stamps "now"; the
    // thread stays hidden until something newer than the stamp
    // arrives (see `SmsConversation.closed`).
    if (typeof body?.closed === "boolean") {
      const rawType = body?.contactType;
      const type: SmsContactType | null =
        rawType === "family" ||
        rawType === "inquiry" ||
        rawType === "camp" ||
        rawType === "visit" ||
        rawType === "tasco" ||
        rawType === "adhoc"
          ? rawType
          : null;
      if (!type || !Number.isFinite(contactId) || contactId <= 0) {
        return NextResponse.json(
          { error: "contactType and contactId are required" },
          { status: 400 }
        );
      }
      const key = `${type}:${contactId}`;
      const closedAt = body.closed ? Date.now() : 0;
      const map = await writeClosedConversation(key, closedAt, admin.email);
      return NextResponse.json({
        ok: true,
        closed: Boolean(map[key]),
        closedAt: map[key] ?? 0,
      });
    }

    if (body?.contactType !== "family" || !Number.isFinite(contactId)) {
      return NextResponse.json(
        { error: "Opt-out state can only be changed for family contacts" },
        { status: 400 }
      );
    }
    const optedOut = body?.optedOut === true;

    const parent = await resolvePrimaryParent(contactId);
    if (!parent) {
      return NextResponse.json(
        { error: "No parent on file for this family" },
        { status: 404 }
      );
    }

    // Xano PATCH silently drops empty inputs, so null can't clear the
    // column — 0 is the "opted back in" sentinel (falsy everywhere the
    // flag is read). Verify the write actually landed: if the endpoint
    // treats 0 as empty too, the timestamp would survive and the UI
    // would un-gray a composer that still can't send.
    const updated = await xano.parents.update(parent.id, {
      sms_opted_out_at: optedOut ? Date.now() : 0,
    });
    if (!optedOut && updated?.sms_opted_out_at) {
      return NextResponse.json(
        {
          error:
            "Xano ignored the opt-in write — the registration_parents " +
            "PATCH endpoint must accept 0 for `sms_opted_out_at`.",
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      ok: true,
      parentId: parent.id,
      optedOut: Boolean(updated?.sms_opted_out_at),
    });
  } catch (err) {
    return handleAdminError(err);
  }
}

export const GET = withServerTiming(handleGET);

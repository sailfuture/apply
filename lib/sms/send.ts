import { xano, type XanoParent, type XanoSmsMessage } from "@/lib/xano";
import {
  getMessagingServiceSid,
  getTwilioClient,
  isTwilioConfigured,
} from "@/lib/twilio";
import { toE164 } from "@/lib/phone";
import { currentSmsProvider } from "@/lib/app-settings";
import { isQuoConfigured, quoUserIdByEmail, sendQuoText } from "@/lib/quo";
import { MAIN_LINE } from "@/lib/school-phones";
import {
  contactMessageKeys,
  getContactRecipient,
  resolvePrimaryParent,
  type SmsContactType,
} from "@/lib/sms/contacts";

// The recipient helpers moved to `lib/sms/contacts.ts` (their logic is
// shared with inquiry/summer-camp contact resolution now); re-exported
// here so existing importers keep working unchanged.
export {
  pickAccountHolderParent,
  resolvePrimaryParent,
  getFamilyRecipient,
  type FamilyRecipient,
} from "@/lib/sms/contacts";

/**
 * Core outbound SMS path. One function every surface routes through —
 * the manual composer, the six lifecycle/billing triggers (Phase 2),
 * group blasts (Phase 3), and now inquiry/summer-camp threads — so
 * consent, phone normalization, the Twilio call, and the
 * `sms_messages` log all live in one place.
 *
 * Contract mirrors the email layer's best-effort sends: this never
 * throws. Automated triggers can call it fire-and-forget beside their
 * existing email sends without risking the status change that fired
 * them. The `SendSmsResult` tells interactive callers (the composer)
 * what happened so they can surface a toast.
 */

export type SendSmsSkipReason =
  | "opted_out"
  | "no_phone"
  | "not_configured"
  // Never from `sendSms` itself: a billing trigger that couldn't read
  // the log to tell whether this text already went out, and held it
  // for the next cron run (see `lib/sms/triggers.ts`).
  | "unverified";

export interface SendSmsInput {
  /** Family recipient — the classic path. Equivalent to
   *  `contact: { type: "family", id: familyId }`; ignored when
   *  `contact` is passed. */
  familyId?: number;
  /** Generic recipient — family, inquiry, or summer-camp contact.
   *  Takes precedence over `familyId`. */
  contact?: { type: SmsContactType; id: number } | null;
  body: string;
  /** What produced this text: "manual" (staff-typed) | a trigger key
   *  ("application_received", "accepted", …) | "group:<slug>". */
  template?: string | null;
  studentId?: number | null;
  yearId?: number | null;
  /** Staff who initiated a manual/group send (denormalized onto the
   *  log). Omit for automated triggers. */
  author?: { email: string; name: string } | null;
  /** Pre-resolved recipient parent — pass it when you already have the
   *  record (e.g. a group send that fetched every family) to skip the
   *  lookup and read opt-out without another round-trip. Family
   *  contacts only. */
  parent?: XanoParent | null;
  /** Explicit recipient override (E.164 or 10-digit). Rare — normally
   *  the contact's own phone is the target. */
  to?: string | null;
  /**
   * Write the log row BEFORE sending and treat it as a claim on
   * (contact, template). For automated sends whose only dedupe record
   * is this log (lib/nurture): if the row can't be written, nothing is
   * sent — otherwise a Xano write outage would re-send the same text
   * on every run — and if an older row for the same template is
   * already on the thread (an overlapping run), this one backs off.
   * Contacts with a thread only (not ad-hoc numbers).
   */
  claim?: boolean;
}

export interface SendSmsResult {
  ok: boolean;
  skipped?: SendSmsSkipReason;
  messageSid?: string;
  logId?: number;
  error?: string;
  /** Claimed sends only: another run had already claimed this
   *  template for this contact, so nothing was sent. */
  deduped?: boolean;
}

function buildStatusCallbackUrl(): string | undefined {
  const base = process.env.NEXT_PUBLIC_APP_URL;
  if (!base) return undefined;
  return `${base.replace(/\/$/, "")}/api/webhooks/twilio`;
}

export async function sendSms(input: SendSmsInput): Promise<SendSmsResult> {
  const {
    template = "manual",
    studentId = null,
    yearId = null,
    author = null,
  } = input;
  // Trim at the choke point, not (only) per caller: Xano trims text
  // columns on save, and the sms_messages create echo-guard compares
  // what comes back — an untrimmed trailing newline would trip it and
  // drop the log row. Trimming here means no current or future caller
  // can reintroduce that.
  const body = (input.body ?? "").trim();
  if (!body) {
    return { ok: false, error: "Empty message body" };
  }

  const contact =
    input.contact ??
    (input.familyId != null
      ? { type: "family" as const, id: input.familyId }
      : null);
  if (!contact) {
    return { ok: false, error: "No recipient contact specified" };
  }

  // Resolve the recipient + consent gate, per contact type.
  let to: string | null = null;
  if (contact.type === "family") {
    // Family path: the parent row supplies both the phone number and
    // the consent evidence. ALWAYS resolve it when the caller didn't
    // pass one — including when an explicit `to` override is given.
    // The old shape (`!parent && !input.to`) skipped the lookup for
    // `to`-only calls, which made the gate below evaluate
    // `undefined?.sms_opted_out_at` and fail OPEN: any such caller
    // would text an opted-out family. This function is the final
    // authority on consent; the extra read is the cost of that.
    let parent = input.parent ?? null;
    if (!parent) {
      parent = await resolvePrimaryParent(contact.id);
    }
    // Consent gate — never text a family that texted STOP.
    if (parent?.sms_opted_out_at) {
      return { ok: false, skipped: "opted_out" };
    }
    to = toE164(input.to ?? parent?.phone ?? null);
  } else {
    // Inquiry / summer-camp path: the row carries its own phone.
    // Inquiry rows also carry the form's messaging-consent flag —
    // an explicit "no" blocks the send. (Twilio's carrier-level
    // opt-out still backstops both types regardless.)
    const recipient = await getContactRecipient(contact.type, contact.id);
    if (recipient?.optedOut) {
      return { ok: false, skipped: "opted_out" };
    }
    to = toE164(input.to ?? recipient?.phone ?? null);
  }

  if (!to) {
    return { ok: false, skipped: "no_phone" };
  }

  // Which number this goes out from. Quo = the office Main Line;
  // Twilio = (727) 604-8321. Every surface routes through here, so the
  // switch (Follow-ups -> Phone system) moves them all at once.
  const provider = await currentSmsProvider();
  if (provider === "quo") {
    if (!isQuoConfigured()) return { ok: false, skipped: "not_configured" };
    return sendViaQuo({
      contact,
      to,
      body,
      template: template ?? "manual",
      studentId,
      yearId,
      author,
      claim: Boolean(input.claim),
    });
  }

  // No Twilio creds (local / preview) → don't attempt a send, and
  // deliberately don't log a row: the thread should reflect real sends
  // only. Interactive callers surface "SMS isn't configured yet".
  if (!isTwilioConfigured()) {
    return { ok: false, skipped: "not_configured" };
  }

  // Exactly one of the three contact FKs set on every logged row.
  const contactKeys = contactMessageKeys(contact);

  if (input.claim) {
    if (contact.type === "adhoc") {
      return { ok: false, error: "Claimed sends need a contact thread" };
    }
    return sendClaimed({
      contact: { type: contact.type, id: contact.id },
      row: {
        ...contactKeys,
        registration_students_id: studentId,
        registration_school_years_id: yearId,
        direction: "outbound",
        to_number: to,
        from_number: "",
        body,
        template: template ?? "manual",
        author_email: author?.email ?? null,
        author_name: author?.name ?? null,
      },
    });
  }

  const from = getMessagingServiceSid();
  try {
    const client = getTwilioClient();
    const statusCallback = buildStatusCallbackUrl();
    const msg = await client.messages.create({
      to,
      messagingServiceSid: from,
      body,
      ...(statusCallback ? { statusCallback } : {}),
    });

    // Log the accepted send. If logging fails the text still WENT OUT,
    // so don't report failure to the caller — but retry once first: an
    // unlogged send is invisible in every thread and the inbox until
    // the next Twilio sync backfills it, which reads as a lost message.
    const logRow = {
      ...contactKeys,
      registration_students_id: studentId,
      registration_school_years_id: yearId,
      direction: "outbound",
      to_number: to,
      // Twilio assigns the sender number async when using a Messaging
      // Service — `msg.from` is often null at accept time, and the
      // service SID ("MG…") is NOT a phone number, so never store it
      // as one. Blank is honest; the UI hides an empty from-number.
      from_number: msg.from ?? "",
      body,
      status: msg.status ?? "queued",
      twilio_message_sid: msg.sid,
      template,
      error_code: msg.errorCode != null ? String(msg.errorCode) : null,
      author_email: author?.email ?? null,
      author_name: author?.name ?? null,
      segments: msg.numSegments != null ? Number(msg.numSegments) : null,
    };
    const log = await xano.smsMessages.create(logRow).catch(async (err) => {
      console.error("[sendSms] sent but failed to log, retrying:", err);
      return xano.smsMessages.create(logRow).catch((err2) => {
        console.error("[sendSms] sent but failed to log (retry):", err2);
        return null;
      });
    });

    return { ok: true, messageSid: msg.sid, logId: log?.id };
  } catch (err) {
    console.error("[sendSms] Twilio send failed:", err);
    // Best-effort: record the failed attempt so it shows in the thread.
    try {
      await xano.smsMessages.create({
        ...contactKeys,
        registration_students_id: studentId,
        registration_school_years_id: yearId,
        direction: "outbound",
        to_number: to,
        // Same rule as the success path: the Messaging Service SID is
        // not a phone number — leave blank.
        from_number: "",
        body,
        status: "failed",
        twilio_message_sid: null,
        template,
        error_code:
          err instanceof Error ? err.message.slice(0, 120) : "send_error",
        author_email: author?.email ?? null,
        author_name: author?.name ?? null,
        segments: null,
      });
    } catch {
      // already logged the send error above
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : "SMS send failed",
    };
  }
}

/**
 * The `claim` path of `sendSms`: log row first, then the text.
 *
 *  1. Claim — write the row as "sending". No row, no send.
 *  2. Lowest id wins — re-read the thread; an OLDER row with this
 *     template means another run claimed it first, so this claim is
 *     withdrawn. (If the thread can't be read, withdraw too: the next
 *     run retries, which beats guessing.)
 *  3. Send, then stamp the row with Twilio's SID and status. A Twilio
 *     refusal marks the row failed — it stays as the dedupe record, so
 *     a dead number isn't retried every half hour.
 */
async function sendClaimed({
  contact,
  row,
}: {
  contact: { type: Exclude<SmsContactType, "adhoc">; id: number };
  row: Omit<
    XanoSmsMessage,
    "id" | "created_at" | "status" | "twilio_message_sid" | "error_code" | "segments"
  > & { to_number: string; body: string; template: string };
}): Promise<SendSmsResult> {
  let claim: XanoSmsMessage;
  try {
    claim = await xano.smsMessages.create({
      ...row,
      status: "sending",
      twilio_message_sid: null,
      error_code: null,
      segments: null,
    });
  } catch (err) {
    console.error("[sendSms] couldn't write the claim row — not sending:", err);
    return { ok: false, error: "Couldn't log the text first, so it wasn't sent" };
  }

  const withdraw = () =>
    xano.smsMessages.delete(claim.id).catch((err) => {
      console.error(`[sendSms] couldn't withdraw claim row ${claim.id}:`, err);
    });
  try {
    const thread = await xano.smsMessages.getByContactStrict(
      contact.type,
      contact.id
    );
    const earlier = thread.some(
      (m) =>
        m.direction === "outbound" &&
        m.template === row.template &&
        m.id < claim.id
    );
    if (earlier) {
      await withdraw();
      return { ok: true, deduped: true };
    }
  } catch (err) {
    console.error("[sendSms] couldn't confirm the claim — not sending:", err);
    await withdraw();
    return { ok: false, error: "Couldn't confirm the text wasn't already sent" };
  }

  try {
    const statusCallback = buildStatusCallbackUrl();
    const msg = await getTwilioClient().messages.create({
      to: row.to_number,
      messagingServiceSid: getMessagingServiceSid(),
      body: row.body,
      ...(statusCallback ? { statusCallback } : {}),
    });
    const stamp = {
      status: msg.status ?? "queued",
      twilio_message_sid: msg.sid,
      from_number: msg.from ?? "",
      error_code: msg.errorCode != null ? String(msg.errorCode) : null,
      segments: msg.numSegments != null ? Number(msg.numSegments) : null,
    };
    // The claim already dedupes, so a failed stamp can't cause a
    // re-send — it only leaves the row reading "Sending…".
    await xano.smsMessages.update(claim.id, stamp).catch(async (err) => {
      console.error("[sendSms] sent but couldn't stamp the claim, retrying:", err);
      await xano.smsMessages.update(claim.id, stamp).catch((err2) => {
        console.error("[sendSms] sent but couldn't stamp the claim (retry):", err2);
      });
    });
    return { ok: true, messageSid: msg.sid, logId: claim.id };
  } catch (err) {
    console.error("[sendSms] Twilio send failed (claimed):", err);
    await xano.smsMessages
      .update(claim.id, {
        status: "failed",
        error_code:
          err instanceof Error ? err.message.slice(0, 120) : "send_error",
      })
      .catch(() => {});
    return {
      ok: false,
      error: err instanceof Error ? err.message : "SMS send failed",
    };
  }
}

/**
 * The Quo path: every text from the Main Line, logged BEFORE it's
 * sent. Writing the row first does two jobs: it is the claim that
 * keeps an overlapping automated run from sending the same text twice
 * (the same rule as the Twilio claim path), and it means the delivery
 * webhook, which can arrive within a second, finds the row to update
 * instead of creating a second one: by Quo id once the stamp below
 * lands, and by number + words before that (`adoptApplyRow` in
 * lib/quo/ingest.ts). If the receipt wins that race the stamp can put
 * the status back a step; the 15-minute Quo sync sets it right.
 *
 * Staff sends carry the sender's Quo user when their email matches a
 * Quo account, so the Quo app shows who wrote it. Every send is marked
 * done in the office inbox (Apply is where it was handled); a reply
 * from the parent reopens the conversation there.
 */
async function sendViaQuo(args: {
  contact: { type: SmsContactType; id: number };
  to: string;
  body: string;
  template: string;
  studentId: number | null;
  yearId: number | null;
  author: { email: string; name: string } | null;
  claim: boolean;
}): Promise<SendSmsResult> {
  const { contact, to, body, template, author } = args;
  let row: XanoSmsMessage;
  try {
    row = await xano.smsMessages.create({
      ...contactMessageKeys(contact),
      registration_students_id: args.studentId,
      registration_school_years_id: args.yearId,
      direction: "outbound",
      to_number: to,
      from_number: MAIN_LINE,
      body,
      status: "sending",
      twilio_message_sid: null,
      template,
      error_code: null,
      author_email: author?.email ?? null,
      author_name: author?.name ?? null,
      segments: null,
      provider: "quo",
      quo_message_id: null,
      quo_conversation_id: null,
    } as Parameters<typeof xano.smsMessages.create>[0]);
  } catch (err) {
    console.error("[sendSms] couldn't log the text first, so it wasn't sent:", err);
    return { ok: false, error: "Couldn't log the text first, so it wasn't sent" };
  }

  const withdraw = () =>
    xano.smsMessages.delete(row.id).catch((err) => {
      console.error(`[sendSms] couldn't withdraw row ${row.id}:`, err);
    });
  if (args.claim && contact.type !== "adhoc") {
    try {
      const thread = await xano.smsMessages.getByContactStrict(contact.type, contact.id);
      const earlier = thread.some(
        (m) => m.direction === "outbound" && m.template === template && m.id < row.id
      );
      if (earlier) {
        await withdraw();
        return { ok: true, deduped: true };
      }
    } catch (err) {
      console.error("[sendSms] couldn't confirm the claim, so it wasn't sent:", err);
      await withdraw();
      return { ok: false, error: "Couldn't confirm the text wasn't already sent" };
    }
  }

  try {
    const userId = author?.email ? await quoUserIdByEmail(author.email) : null;
    const msg = await sendQuoText({ to, content: body, userId, markDone: true });
    const stamp = {
      status: msg.status || "sent",
      quo_message_id: msg.id,
      quo_conversation_id: msg.conversationId ?? "",
      from_number: msg.from || MAIN_LINE,
    };
    // The row already exists, so a failed stamp can't cause a re-send;
    // the delivery webhook (keyed on the Quo id) also fills it in.
    await xano.smsMessages.update(row.id, stamp).catch(async (err) => {
      console.error("[sendSms] sent via Quo but couldn't stamp the row, retrying:", err);
      await xano.smsMessages.update(row.id, stamp).catch((err2) => {
        console.error("[sendSms] sent via Quo but couldn't stamp the row (retry):", err2);
      });
    });
    return { ok: true, messageSid: msg.id, logId: row.id };
  } catch (err) {
    console.error("[sendSms] Quo send failed:", err);
    await xano.smsMessages
      .update(row.id, {
        status: "failed",
        error_code: err instanceof Error ? err.message.slice(0, 120) : "send_error",
      })
      .catch(() => {});
    return { ok: false, error: err instanceof Error ? err.message : "SMS send failed" };
  }
}

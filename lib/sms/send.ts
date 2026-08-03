import { xano, type XanoParent } from "@/lib/xano";
import {
  getMessagingServiceSid,
  getTwilioClient,
  isTwilioConfigured,
} from "@/lib/twilio";
import { toE164 } from "@/lib/phone";
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

export type SendSmsSkipReason = "opted_out" | "no_phone" | "not_configured";

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
}

export interface SendSmsResult {
  ok: boolean;
  skipped?: SendSmsSkipReason;
  messageSid?: string;
  logId?: number;
  error?: string;
}

function buildStatusCallbackUrl(): string | undefined {
  const base = process.env.NEXT_PUBLIC_APP_URL;
  if (!base) return undefined;
  return `${base.replace(/\/$/, "")}/api/webhooks/twilio`;
}

export async function sendSms(input: SendSmsInput): Promise<SendSmsResult> {
  const {
    body,
    template = "manual",
    studentId = null,
    yearId = null,
    author = null,
  } = input;

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
    // Family path: account-holder parent unless the caller passed one
    // or an explicit `to`. Needed both for the phone number and the
    // opt-out check.
    let parent = input.parent ?? null;
    if (!parent && !input.to) {
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

  // No Twilio creds (local / preview) → don't attempt a send, and
  // deliberately don't log a row: the thread should reflect real sends
  // only. Interactive callers surface "SMS isn't configured yet".
  if (!isTwilioConfigured()) {
    return { ok: false, skipped: "not_configured" };
  }

  // Exactly one of the three contact FKs set on every logged row.
  const contactKeys = contactMessageKeys(contact);

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
      from_number: msg.from ?? from,
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
        from_number: from,
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

import { xano, type XanoParent } from "@/lib/xano";
import {
  getMessagingServiceSid,
  getTwilioClient,
  isTwilioConfigured,
} from "@/lib/twilio";
import { toE164 } from "@/lib/phone";

/**
 * Core outbound SMS path. One function every surface routes through —
 * the manual composer, the six lifecycle/billing triggers (Phase 2),
 * and group blasts (Phase 3) — so consent, phone normalization, the
 * Twilio call, and the `sms_messages` log all live in one place.
 *
 * Contract mirrors the email layer's best-effort sends: this never
 * throws. Automated triggers can call it fire-and-forget beside their
 * existing email sends without risking the status change that fired
 * them. The `SendSmsResult` tells interactive callers (the composer)
 * what happened so they can surface a toast.
 */

export type SendSmsSkipReason = "opted_out" | "no_phone" | "not_configured";

export interface SendSmsInput {
  familyId: number;
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
   *  lookup and read opt-out without another round-trip. */
  parent?: XanoParent | null;
  /** Explicit recipient override (E.164 or 10-digit). Rare — normally
   *  the account-holder parent's phone is the target. */
  to?: string | null;
}

export interface SendSmsResult {
  ok: boolean;
  skipped?: SendSmsSkipReason;
  messageSid?: string;
  logId?: number;
  error?: string;
}

/**
 * The account-holder parent for a family — the "primary account phone"
 * the texts target. Prefers the parent linked to a Clerk user (the one
 * who owns the login); falls back to the first parent on the family.
 */
export async function resolvePrimaryParent(
  familyId: number
): Promise<XanoParent | null> {
  try {
    const family = await xano.families.getById(familyId);
    if (!family) return null;
    const ids = xano.families.getParentIds(family);
    if (!ids.length) return null;
    const parents = (
      await Promise.all(
        ids.map((id) => xano.parents.getById(id).catch(() => null))
      )
    ).filter((p): p is XanoParent => p != null);
    if (!parents.length) return null;
    return parents.find((p) => p.clerk_user_id) ?? parents[0];
  } catch {
    return null;
  }
}

export interface FamilyRecipient {
  parentId: number | null;
  name: string;
  /** Bare stored phone (10-digit) for display. */
  phone: string;
  /** E.164, or null when the number is missing/invalid. */
  e164: string | null;
  optedOut: boolean;
}

/** Recipient summary for the messages UI — who a text would go to and
 *  whether they've opted out. Null when the family has no parent. */
export async function getFamilyRecipient(
  familyId: number
): Promise<FamilyRecipient | null> {
  const parent = await resolvePrimaryParent(familyId);
  if (!parent) return null;
  return {
    parentId: parent.id,
    name: `${parent.first_name ?? ""} ${parent.last_name ?? ""}`.trim(),
    phone: parent.phone ?? "",
    e164: toE164(parent.phone),
    optedOut: Boolean(parent.sms_opted_out_at),
  };
}

function buildStatusCallbackUrl(): string | undefined {
  const base = process.env.NEXT_PUBLIC_APP_URL;
  if (!base) return undefined;
  return `${base.replace(/\/$/, "")}/api/webhooks/twilio`;
}

export async function sendSms(input: SendSmsInput): Promise<SendSmsResult> {
  const {
    familyId,
    body,
    template = "manual",
    studentId = null,
    yearId = null,
    author = null,
  } = input;

  // Resolve the recipient parent unless the caller passed one or an
  // explicit `to`. Needed both for the phone number and the opt-out
  // check.
  let parent = input.parent ?? null;
  if (!parent && !input.to) {
    parent = await resolvePrimaryParent(familyId);
  }

  // Consent gate — never text a family that texted STOP.
  if (parent?.sms_opted_out_at) {
    return { ok: false, skipped: "opted_out" };
  }

  const to = toE164(input.to ?? parent?.phone ?? null);
  if (!to) {
    return { ok: false, skipped: "no_phone" };
  }

  // No Twilio creds (local / preview) → don't attempt a send, and
  // deliberately don't log a row: the thread should reflect real sends
  // only. Interactive callers surface "SMS isn't configured yet".
  if (!isTwilioConfigured()) {
    return { ok: false, skipped: "not_configured" };
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
    // so don't report failure to the caller — just surface it server-side.
    const log = await xano.smsMessages
      .create({
        registration_families_id: familyId,
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
      })
      .catch((err) => {
        console.error("[sendSms] sent but failed to log:", err);
        return null;
      });

    return { ok: true, messageSid: msg.sid, logId: log?.id };
  } catch (err) {
    console.error("[sendSms] Twilio send failed:", err);
    // Best-effort: record the failed attempt so it shows in the thread.
    try {
      await xano.smsMessages.create({
        registration_families_id: familyId,
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

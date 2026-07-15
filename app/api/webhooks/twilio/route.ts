import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "twilio";
import { xano } from "@/lib/xano";
import { getTwilioAuthToken } from "@/lib/twilio";
import { sendEmail } from "@/lib/emails/send";
import { smsReplyReceived } from "@/lib/emails/templates";

/**
 * Twilio inbound webhook — one endpoint for two POST shapes Twilio
 * sends (both `application/x-www-form-urlencoded`):
 *
 *  1. Inbound SMS (a family replied): has `Body` + `From`. We log it on
 *     the family's thread and honor STOP/START keywords by flipping the
 *     parent's `sms_opted_out_at`. (Twilio's Advanced Opt-Out also
 *     enforces STOP at the carrier level and sends the confirmation
 *     reply; we mirror the state so our own sends + UI respect it.)
 *  2. Status callback: has `MessageStatus` for a `MessageSid` we
 *     already logged — we update that row's delivery status.
 *
 * Every request is signature-verified against the Twilio auth token so
 * a third party can't forge inbound texts or opt-outs.
 */
export async function POST(req: NextRequest) {
  const authToken = getTwilioAuthToken();

  const form = await req.formData();
  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) {
    params[k] = typeof v === "string" ? v : "";
  }

  // Reject anything not actually signed by Twilio. When the token isn't
  // configured yet (local/preview) we skip verification so the endpoint
  // can be exercised, but in production the token is always present.
  if (authToken) {
    const signature = req.headers.get("x-twilio-signature") ?? "";
    const url = webhookUrl(req);
    const valid = validateRequest(authToken, signature, url, params);
    if (!valid) {
      return new NextResponse("Invalid Twilio signature", { status: 403 });
    }
  }

  const messageSid = params.MessageSid || params.SmsSid || "";
  const messageStatus = params.MessageStatus || params.SmsStatus || "";
  const body = params.Body ?? "";
  const from = params.From ?? "";

  // --- Status callback -----------------------------------------------
  // No inbound body, but a delivery status for a SID we sent. Update the
  // matching log row so the thread reflects sent → delivered / failed.
  const isStatusCallback = !params.Body && !!messageStatus && !!messageSid;
  if (isStatusCallback) {
    try {
      const existing = await xano.smsMessages.findByMessageSid(messageSid);
      if (existing) {
        await xano.smsMessages.update(existing.id, {
          status: messageStatus,
          error_code: params.ErrorCode
            ? String(params.ErrorCode)
            : (existing.error_code ?? null),
        });
      }
    } catch (err) {
      console.error("[twilio webhook] status update failed:", err);
    }
    return twimlOk();
  }

  // --- Inbound message -----------------------------------------------
  const keyword = body.trim().toUpperCase();
  const isStop = ["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"].includes(
    keyword
  );
  const isStart = ["START", "UNSTOP", "YES"].includes(keyword);

  try {
    const parent = await xano.parents.findByPhone(from);
    const family = parent
      ? await xano.families.findByParentId(parent.id).catch(() => null)
      : null;

    // Opt-out / opt-in bookkeeping (mirrors Twilio's carrier-level state
    // so our own sends + the UI honor it).
    if (parent && (isStop || isStart)) {
      await xano.parents
        .update(parent.id, {
          sms_opted_out_at: isStop ? Date.now() : null,
        })
        .catch((err) =>
          console.error("[twilio webhook] opt-out update failed:", err)
        );
    }

    // Log the inbound text on the family thread (when we can attribute
    // the sender to a family).
    if (family) {
      await xano.smsMessages
        .create({
          registration_families_id: family.id,
          registration_students_id: null,
          registration_school_years_id: null,
          direction: "inbound",
          to_number: params.To ?? "",
          from_number: from,
          body,
          status: "received",
          twilio_message_sid: messageSid || null,
          template: null,
          error_code: null,
          author_email: null,
          author_name: null,
          segments: params.NumSegments ? Number(params.NumSegments) : null,
        })
        .catch((err) =>
          console.error("[twilio webhook] inbound log failed:", err)
        );
    } else {
      console.warn(
        `[twilio webhook] inbound from unrecognized number ${from}`
      );
    }

    // Staff notification email — resolved to parent + family +
    // student(s) so the admissions inbox sees WHO texted, not just a
    // number. Sent for every inbound message (including STOP, flagged
    // as an opt-out, and unrecognized numbers, flagged unattributed).
    // `sendEmail` is internally guarded and never throws; a failed
    // notification must not fail the webhook (Twilio would retry and
    // double-log the message).
    const students = family
      ? await xano.students.getByFamilyId(family.id).catch(() => [])
      : [];
    const appBase = (
      process.env.NEXT_PUBLIC_APP_URL ?? "https://apply.sailfutureacademy.org"
    ).replace(/\/$/, "");
    await sendEmail({
      to: [process.env.SMS_ALERTS_EMAIL ?? "admissions@sailfuture.org"],
      content: smsReplyReceived({
        parent_name: parent
          ? `${parent.first_name} ${parent.last_name}`.trim()
          : null,
        family_name: family?.family_name ?? null,
        student_names: joinNames(
          students.map((s) => `${s.first_name} ${s.last_name}`.trim())
        ),
        from_number: from,
        message_body: body,
        message_sid: messageSid || null,
        inbox_url: `${appBase}/admin/messages`,
        opted_out: isStop,
      }),
      tag: "sms-reply-received",
      familyId: family?.id,
    });
  } catch (err) {
    console.error("[twilio webhook] inbound handling failed:", err);
  }

  return twimlOk();
}

/** "A" / "A and B" / "A, B, and C"; null for an empty list. */
function joinNames(names: string[]): string | null {
  const list = names.filter(Boolean);
  if (list.length === 0) return null;
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(", ")}, and ${list[list.length - 1]}`;
}

/** The public URL Twilio signed against. Prefer the configured app URL
 *  (proxies rewrite host/proto, which would break signature checks). */
function webhookUrl(req: NextRequest): string {
  const base = process.env.NEXT_PUBLIC_APP_URL;
  if (base) return `${base.replace(/\/$/, "")}/api/webhooks/twilio`;
  return req.nextUrl.href;
}

/** Empty TwiML, 200 — we don't auto-reply (Twilio Advanced Opt-Out
 *  sends STOP/HELP confirmations); 200 stops Twilio from retrying. */
function twimlOk(): NextResponse {
  return new NextResponse(
    '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
    { status: 200, headers: { "Content-Type": "text/xml" } }
  );
}

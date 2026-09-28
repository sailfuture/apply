import {
  getMessagingServiceSid,
  getTwilioClient,
  isTwilioConfigured,
} from "@/lib/twilio";
import { formatUSPhone } from "@/lib/phone";
import { sendEmail } from "@/lib/emails/send";
import { mainLineTextingChanged } from "@/lib/emails/templates";
import { MAIN_LINE } from "@/lib/school-phones";
import { readForwardingSettings } from "@/lib/app-settings";
import {
  adhocIdFromPhone,
  normPhone,
  type SmsContact,
  type SmsContactType,
} from "@/lib/sms/contacts";

/**
 * Parent replies → the office Main Line.
 *
 * Families text one number, (727) 604-8321, and staff answer from Apply
 * so every reply keeps coming from that number. But staff live in Quo,
 * so each inbound text is also copied to the Main Line as a
 * notification: who texted, what they said, their number (to call
 * back from the Main Line), and a link to answer in Apply.
 *
 * The copy comes FROM the texting number — Twilio can't send "as" the
 * parent — so in Quo every forward sits in one conversation with
 * (727) 604-8321. Answering inside that conversation reaches no parent:
 * `answerStaffText` catches those replies and says where to answer.
 *
 * Both are best-effort and never throw: a notification must not fail
 * the webhook (Twilio would retry and double-log the parent's text).
 * Neither is logged to `sms_messages` — school-to-school texts aren't
 * conversations, and the Twilio sync skips them for the same reason.
 */

/** Longest slice of the parent's text quoted in a forward. */
const QUOTE_MAX = 300;

/** Every bounce starts with this — it's also how the throttle finds
 *  earlier bounces in Twilio's log. */
const BOUNCE_PREFIX = "Not sent to any parent.";

/** At most one bounce per hour per school number: enough to catch a
 *  staffer answering in the wrong thread, and it can't ping-pong with
 *  a Quo auto-reply. */
const BOUNCE_THROTTLE_MS = 60 * 60_000;

const CONTACT_LABEL: Record<SmsContactType, string> = {
  family: "family",
  inquiry: "lead",
  camp: "camp",
  visit: "campus visit",
  tasco: "rec-center lead",
  adhoc: "",
};

function appBase(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ?? "https://apply.sailfutureacademy.org"
  ).replace(/\/$/, "");
}

/** The inbox thread for this texter, or the bare inbox. */
function threadUrl(contact: SmsContact | null, from: string): string {
  const key = contact
    ? `${contact.type}:${contact.id}`
    : adhocIdFromPhone(from) !== null
      ? `adhoc:${adhocIdFromPhone(from)}`
      : null;
  return key
    ? `${appBase()}/admin/messages?open=${encodeURIComponent(key)}`
    : `${appBase()}/admin/messages`;
}

/** "Maria Lopez (lead, Kid Lopez) (813) 555-0101" — who texted, in
 *  the words staff use, plus the number to call back. */
function describeTexter(contact: SmsContact | null, from: string): string {
  const phone = formatUSPhone(normPhone(from)) || from;
  if (!contact || contact.type === "adhoc") return phone;
  const person = contact.personName || contact.name;
  const context =
    contact.type === "family"
      ? contact.name !== person
        ? contact.name
        : "family"
      : [CONTACT_LABEL[contact.type], contact.studentNames]
          .filter(Boolean)
          .join(", ");
  return `${person} (${context}) ${phone}`;
}

function quote(body: string): string {
  const text = body.trim() || "(no text)";
  return text.length > QUOTE_MAX ? `${text.slice(0, QUOTE_MAX)}...` : text;
}

/** The forward's text — exported for the preview/tests. */
export function forwardBody(input: {
  contact: SmsContact | null;
  from: string;
  body: string;
  keyword: "stop" | "start" | null;
}): string {
  const who = describeTexter(input.contact, input.from);
  const link = threadUrl(input.contact, input.from);
  if (input.keyword === "stop") {
    return `${who} texted STOP and is now opted out of school texts.\nThread: ${link}`;
  }
  if (input.keyword === "start") {
    return `${who} texted START and can get school texts again.\nThread: ${link}`;
  }
  return `Parent text from ${who}:\n"${quote(input.body)}"\nAnswer in Apply so they keep one number: ${link}`;
}

/** Copy one inbound parent text to the Main Line. */
export async function forwardReplyToMainLine(input: {
  contact: SmsContact | null;
  from: string;
  body: string;
  keyword: "stop" | "start" | null;
}): Promise<void> {
  try {
    if (!isTwilioConfigured()) return;
    if (!(await readForwardingSettings()).enabled) return;
    await getTwilioClient().messages.create({
      to: MAIN_LINE,
      messagingServiceSid: getMessagingServiceSid(),
      body: forwardBody(input),
    });
  } catch (err) {
    // 21610: the Main Line texted STOP to the texting number, so Twilio
    // blocks every forward until it texts START (staff were emailed
    // when the STOP arrived — see answerStaffText).
    const code = (err as { code?: number } | null)?.code;
    console.error(
      code === 21610
        ? "[sms/forward] the Main Line has opted out of texts from the texting number (21610) — text START from the Main Line to restore reply copies"
        : "[sms/forward] forward to the Main Line failed:",
      err
    );
  }
}

const STOP_WORDS = ["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"];
const START_WORDS = ["START", "UNSTOP"];

/**
 * A school number (the Main Line, in practice) texted the texting
 * number — almost always a staffer answering a forward inside Quo,
 * which reaches nobody. Tell them once an hour where to answer,
 * pointing at the newest forwarded thread. Texts from staff are never
 * relayed to a parent automatically: guessing the recipient wrong
 * would send one family's conversation to another.
 *
 * STOP / START are different: Twilio acts on them itself — a STOP
 * blocks every later forward to that number — so staff get an email
 * saying so (and how to undo it) instead of a bounce.
 */
export async function answerStaffText(from: string, body: string): Promise<void> {
  const keyword = body.trim().toUpperCase();
  const blocked = STOP_WORDS.includes(keyword);
  if (blocked || START_WORDS.includes(keyword)) {
    await sendEmail({
      to: [process.env.SMS_ALERTS_EMAIL ?? "admissions@sailfuture.org"],
      content: mainLineTextingChanged({ blocked, appUrl: appBase() }),
      tag: "sms-main-line-opt-out",
    });
    return;
  }
  try {
    if (!isTwilioConfigured()) return;
    const client = getTwilioClient();
    const recent = await client.messages.list({
      to: from,
      dateSentAfter: new Date(Date.now() - 24 * 60 * 60_000),
      limit: 50,
    });
    const now = Date.now();
    const bouncedRecently = recent.some(
      (m) =>
        (m.body ?? "").startsWith(BOUNCE_PREFIX) &&
        now - (m.dateCreated?.getTime() ?? 0) < BOUNCE_THROTTLE_MS
    );
    if (bouncedRecently) return;

    // Newest forward's thread link — the conversation they were most
    // likely answering.
    const latestForward = recent
      .filter((m) => (m.body ?? "").includes("/admin/messages?open="))
      .sort(
        (a, b) =>
          (b.dateCreated?.getTime() ?? 0) - (a.dateCreated?.getTime() ?? 0)
      )[0];
    const link =
      latestForward?.body?.match(/https?:\/\/\S+\/admin\/messages\?open=\S+/)?.[0] ??
      `${appBase()}/admin/messages`;

    await client.messages.create({
      to: from,
      messagingServiceSid: getMessagingServiceSid(),
      body: `${BOUNCE_PREFIX} Texts to this number don't reach families. Answer in Apply instead: ${link}`,
    });
  } catch (err) {
    console.error("[sms/forward] staff-text bounce failed:", err);
  }
}

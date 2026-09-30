import { xano, type XanoCall } from "@/lib/xano";
import {
  buildSmsDirectory,
  contactMessageKeys,
  normPhone,
  type SmsContact,
} from "@/lib/sms/contacts";
import { isSchoolNumber } from "@/lib/school-phones";
import {
  getCall,
  quoUserDirectory,
  resolveMainLine,
  type QuoCall,
  type QuoMessage,
  type QuoTranscriptLine,
} from "@/lib/quo";

/**
 * Quo → Apply. Texts land in `sms_messages` beside the Twilio ones
 * (provider "quo"), calls in `registration_calls`; both attach to the
 * family or lead whose number they match, through the same directory
 * the Twilio webhook uses.
 *
 * Everything here is an UPSERT keyed on Quo's own ids, because Quo
 * delivers webhooks at least once and in no particular order: a
 * duplicate finds its row and changes nothing, a recording that
 * arrives before its call creates the call first. Reads that gate an
 * insert are strict (a failed read is an error, never "not there").
 *
 * Only the Main Line is mirrored. Texts and calls between two school
 * numbers are staff plumbing and are skipped.
 */

export interface IngestContext {
  mainLineId: string;
  mainLineNumber: string;
  directory: Map<string, SmsContact>;
  users: Map<string, { name: string; email: string }>;
}

export async function loadIngestContext(): Promise<IngestContext> {
  const [mainLine, directory, users] = await Promise.all([
    resolveMainLine(),
    buildSmsDirectory(),
    quoUserDirectory(),
  ]);
  return {
    mainLineId: mainLine.id,
    mainLineNumber: mainLine.number,
    directory,
    users,
  };
}

export type IngestOutcome =
  | "created"
  | "updated"
  | "unchanged"
  | "skipped_other_number"
  | "skipped_internal"
  | "skipped_unknown";

/* ─────────────────────────────── Texts ─────────────────────────────── */

/** A Quo text, normalized from either a webhook event or the v1 list. */
export interface QuoTextInput {
  id: string;
  conversationId: string | null;
  phoneNumberId: string | null;
  direction: "incoming" | "outgoing";
  text: string;
  hasMedia: boolean;
  status: string;
  /** ISO timestamp. */
  createdAt: string;
  /** E.164 on each side. */
  from: string;
  to: string;
  userId: string | null;
  errorCode: string | null;
  quoLink?: string | null;
}

export function textFromQuoMessage(m: QuoMessage): QuoTextInput {
  return {
    id: m.id,
    conversationId: m.conversationId ?? null,
    phoneNumberId: m.phoneNumberId ?? null,
    direction: m.direction,
    text: m.text ?? "",
    hasMedia: (m.media?.length ?? 0) > 0,
    status: m.status,
    createdAt: m.createdAt,
    from: m.from,
    to: m.to?.[0] ?? "",
    userId: m.userId ?? null,
    errorCode: null,
  };
}

const STOP_WORDS = ["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"];
const START_WORDS = ["START", "UNSTOP"];

/** Mirror a STOP/START the parent texted to the Main Line onto the
 *  record Apply's own sends consult — same bookkeeping as the Twilio
 *  webhook. Quo enforces the opt-out on its side regardless. */
async function applyKeyword(contact: SmsContact | null, body: string): Promise<void> {
  const keyword = body.trim().toUpperCase();
  const isStop = STOP_WORDS.includes(keyword);
  const isStart = START_WORDS.includes(keyword);
  if (!contact || (!isStop && !isStart)) return;
  try {
    if (contact.type === "family" && contact.parentId) {
      await xano.parents.update(contact.parentId, {
        sms_opted_out_at: isStop ? Date.now() : 0,
      });
    } else if (contact.type === "inquiry") {
      await xano.inquiries.update(contact.id, { messaging_opt_in: !isStop });
    }
  } catch (err) {
    console.error("[quo/ingest] opt-out bookkeeping failed:", err);
  }
}

export async function upsertQuoText(
  input: QuoTextInput,
  ctx: IngestContext
): Promise<IngestOutcome> {
  // No id, no row: an empty key would match nothing on the next look
  // and insert again on every retry.
  if (!input.id) return "skipped_unknown";
  if (input.phoneNumberId && input.phoneNumberId !== ctx.mainLineId) {
    return "skipped_other_number";
  }
  const inbound = input.direction === "incoming";
  const counterparty = inbound ? input.from : input.to;
  if (!counterparty || isSchoolNumber(counterparty)) return "skipped_internal";
  // Short codes and alphanumeric senders can't thread by phone — the
  // Twilio paths skip them too.
  if (normPhone(counterparty).length !== 10) return "skipped_unknown";

  const staff = input.userId ? ctx.users.get(input.userId) : null;
  const existing = await xano.smsMessages.findAllByQuoMessageIdStrict(input.id);
  if (existing.length > 0) {
    const row = existing[0];
    const status = inbound ? "received" : input.status;
    const patch: Record<string, unknown> = {};
    if (status && row.status !== status) patch.status = status;
    if (input.errorCode && row.error_code !== input.errorCode) {
      patch.error_code = input.errorCode;
    }
    if (input.conversationId && !row.quo_conversation_id) {
      patch.quo_conversation_id = input.conversationId;
    }
    // A staff text logged before its sender resolved (the user list
    // was unavailable) gets the name once it does.
    if (!inbound && staff?.name && row.author_name !== staff.name) {
      patch.author_name = staff.name;
      if (staff.email) patch.author_email = staff.email;
    }
    if (Object.keys(patch).length === 0) return "unchanged";
    await xano.smsMessages.update(row.id, patch);
    return "updated";
  }

  const contact = ctx.directory.get(normPhone(counterparty)) ?? null;
  const body =
    input.text.trim() ||
    (input.hasMedia ? "(sent a photo or file)" : "(no text)");
  const created = await xano.smsMessages.create({
    ...contactMessageKeys(contact),
    registration_students_id: null,
    registration_school_years_id: null,
    direction: inbound ? "inbound" : "outbound",
    to_number: input.to,
    from_number: input.from,
    body,
    status: inbound ? "received" : input.status || "sent",
    twilio_message_sid: null,
    // Staff texts from the Quo app read as manual replies everywhere
    // (inbox "needs a reply", the follow-up planner's staff-contact
    // hold); inbound rows carry no template, like Twilio's.
    template: inbound ? null : "manual",
    error_code: input.errorCode,
    author_email: inbound ? null : (staff?.email ?? null),
    author_name: inbound ? null : (staff?.name || "Main Line"),
    segments: null,
    provider: "quo",
    quo_message_id: input.id,
    quo_conversation_id: input.conversationId,
    created_at: Date.parse(input.createdAt) || Date.now(),
  } as Parameters<typeof xano.smsMessages.create>[0]);

  // Two deliveries of one event can both pass the lookup above; the
  // lower id stands and this one goes.
  const dupes = await xano.smsMessages
    .findAllByQuoMessageIdStrict(input.id)
    .catch(() => [] as { id: number }[]);
  if (dupes.some((r) => r.id < created.id)) {
    await xano.smsMessages.delete(created.id).catch((err) => {
      console.error(`[quo/ingest] duplicate text row ${created.id} could not be removed:`, err);
    });
    return "unchanged";
  }
  if (inbound) await applyKeyword(contact, body);
  return "created";
}

/* ─────────────────────────────── Calls ─────────────────────────────── */

export interface QuoCallInput {
  id: string;
  conversationId: string | null;
  phoneNumberId: string | null;
  direction: "incoming" | "outgoing";
  status: string;
  createdAt: string;
  answeredAt: string | null;
  completedAt: string | null;
  duration: number | null;
  userId: string | null;
  /** The parent's E.164. */
  counterparty: string | null;
  hasVoicemail: boolean | null;
  voicemail: { transcript: string | null; duration: number | null } | null;
  summary: { summary: string[] | null; nextSteps: string[] | null } | null;
  quoLink: string | null;
}

/** From the versioned list/get shape. */
export function callFromQuoCall(c: QuoCall, ctx: IngestContext): QuoCallInput {
  const external = c.participants.find(
    (p) => p.phoneNumber && !isSchoolNumber(p.phoneNumber)
  );
  return {
    id: c.id,
    conversationId: null,
    phoneNumberId: c.phoneNumberId,
    direction: c.direction,
    status: c.status,
    createdAt: c.createdAt,
    answeredAt: c.answeredAt,
    completedAt: c.completedAt,
    duration: c.duration ?? null,
    // Incoming: only `answeredBy` means a person picked up — `actorId`
    // is the line's user even on calls nobody answered. Outgoing: the
    // caller is `initiatedBy`, or the actor when that's blank.
    userId:
      c.direction === "incoming"
        ? (c.answeredBy ?? null)
        : (c.initiatedBy ?? c.actorId ?? null),
    counterparty:
      external?.phoneNumber ??
      c.participants.find((p) => p.phoneNumber !== ctx.mainLineNumber)?.phoneNumber ??
      null,
    hasVoicemail: c.voicemail ? true : null,
    voicemail: c.voicemail
      ? { transcript: c.voicemail.transcript ?? null, duration: c.voicemail.duration ?? null }
      : null,
    summary: c.summary
      ? { summary: c.summary.summary ?? null, nextSteps: c.summary.nextSteps ?? null }
      : null,
    quoLink: null,
  };
}

const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) || 0 : 0);

/** What actually happened, in the timeline's words. Quo calls a
 *  hang-up in the phone menu "completed"; here an incoming call nobody
 *  answered is "missed", and one that left a message is "voicemail". */
function finalStatus(input: QuoCallInput): string {
  if (input.hasVoicemail || input.voicemail?.transcript) return "voicemail";
  if (input.direction === "incoming" && !input.answeredAt) return "missed";
  return input.status || "completed";
}

export async function upsertQuoCall(
  input: QuoCallInput,
  ctx: IngestContext
): Promise<{ outcome: IngestOutcome; row: XanoCall | null }> {
  if (!input.id) return { outcome: "skipped_unknown", row: null };
  if (input.phoneNumberId && input.phoneNumberId !== ctx.mainLineId) {
    return { outcome: "skipped_other_number", row: null };
  }
  if (!input.counterparty || isSchoolNumber(input.counterparty)) {
    return { outcome: "skipped_internal", row: null };
  }
  if (normPhone(input.counterparty).length !== 10) {
    return { outcome: "skipped_unknown", row: null };
  }
  const staff = input.userId ? ctx.users.get(input.userId) : null;
  const next = {
    status: finalStatus(input),
    started_at: ms(input.createdAt),
    answered_at: ms(input.answeredAt),
    completed_at: ms(input.completedAt),
    duration_seconds: Math.max(0, Math.round(input.duration ?? 0)),
    quo_user_id: input.userId ?? "",
    staff_name: staff?.name ?? "",
    has_voicemail: Boolean(input.hasVoicemail || input.voicemail?.transcript),
    voicemail_transcript: input.voicemail?.transcript ?? "",
    summary: input.summary?.summary ?? null,
    next_steps: input.summary?.nextSteps ?? null,
    quo_link: input.quoLink ?? "",
    quo_conversation_id: input.conversationId ?? "",
  };

  const existing = await xano.calls.findAllByQuoCallIdStrict(input.id);
  if (existing.length > 0) {
    const row = existing[0];
    const patch: Partial<XanoCall> = {};
    // Only move forward: a later event never blanks a value an
    // earlier one filled (Xano skips empties anyway).
    if (next.status && next.status !== row.status && !(row.status === "voicemail" && next.status !== "voicemail")) patch.status = next.status;
    if (next.answered_at && next.answered_at !== row.answered_at) patch.answered_at = next.answered_at;
    if (next.completed_at && next.completed_at !== row.completed_at) patch.completed_at = next.completed_at;
    if (next.duration_seconds && next.duration_seconds !== row.duration_seconds) patch.duration_seconds = next.duration_seconds;
    // Staff can change either way: an answered call gains a name, and a
    // call that turns out to have gone unanswered loses the one it was
    // wrongly given (through the clear endpoint — PATCH drops empties).
    let clearStaff = false;
    if (next.quo_user_id !== row.quo_user_id) {
      if (next.quo_user_id) patch.quo_user_id = next.quo_user_id;
      else clearStaff = true;
    }
    if (next.staff_name !== row.staff_name) {
      if (next.staff_name) patch.staff_name = next.staff_name;
      else clearStaff = true;
    }
    if (clearStaff && (row.staff_name || row.quo_user_id)) {
      await xano.calls.clearStaff(row.id);
    }
    if (next.has_voicemail && !row.has_voicemail) patch.has_voicemail = true;
    if (next.voicemail_transcript && next.voicemail_transcript !== row.voicemail_transcript) patch.voicemail_transcript = next.voicemail_transcript;
    if (next.summary && JSON.stringify(next.summary) !== JSON.stringify(row.summary)) patch.summary = next.summary;
    if (next.next_steps && JSON.stringify(next.next_steps) !== JSON.stringify(row.next_steps)) patch.next_steps = next.next_steps;
    if (next.quo_link && !row.quo_link) patch.quo_link = next.quo_link;
    if (next.quo_conversation_id && !row.quo_conversation_id) patch.quo_conversation_id = next.quo_conversation_id;
    if (Object.keys(patch).length === 0) {
      return clearStaff && (row.staff_name || row.quo_user_id)
        ? { outcome: "updated", row: { ...row, staff_name: "", quo_user_id: "" } }
        : { outcome: "unchanged", row };
    }
    const updated = await xano.calls.update(row.id, patch);
    return { outcome: "updated", row: updated };
  }

  const contact = ctx.directory.get(normPhone(input.counterparty)) ?? null;
  const created = await xano.calls.create({
    quo_call_id: input.id,
    phone_number: ctx.mainLineNumber,
    counterparty: input.counterparty,
    direction: input.direction,
    recording_id: "",
    recording_seconds: 0,
    transcript: null,
    ...next,
    ...contactMessageKeys(contact),
  });
  const dupes = await xano.calls.findAllByQuoCallIdStrict(input.id).catch(() => [] as XanoCall[]);
  if (dupes.some((r) => r.id < created.id)) {
    await xano.calls.delete(created.id).catch((err) => {
      console.error(`[quo/ingest] duplicate call row ${created.id} could not be removed:`, err);
    });
    return { outcome: "unchanged", row: dupes[0] };
  }
  return { outcome: "created", row: created };
}

/** The row for a Quo call id, creating it from the API when an event
 *  about the call (recording, transcript, summary) arrives before the
 *  call itself. Null when Quo doesn't know the call either. */
export async function ensureCallRow(
  quoCallId: string,
  ctx: IngestContext
): Promise<XanoCall | null> {
  if (!quoCallId) return null;
  const existing = await xano.calls.findAllByQuoCallIdStrict(quoCallId);
  if (existing.length > 0) return existing[0];
  const call = await getCall(quoCallId);
  if (!call) return null;
  return (await upsertQuoCall(callFromQuoCall(call, ctx), ctx)).row;
}

export async function applyCallRecording(
  quoCallId: string,
  recordings: Array<{ id: string; duration: number | null; status?: string | null }>,
  ctx: IngestContext
): Promise<IngestOutcome> {
  const done = recordings.find((r) => !r.status || r.status === "completed") ?? recordings[0];
  if (!done) return "unchanged";
  const row = await ensureCallRow(quoCallId, ctx);
  if (!row) return "skipped_unknown";
  if (row.recording_id === done.id) return "unchanged";
  await xano.calls.update(row.id, {
    recording_id: done.id,
    recording_seconds: Math.max(0, Math.round(done.duration ?? 0)),
  });
  return "updated";
}

/** Stored compactly: who, what, when (seconds into the call). */
export function compactTranscript(
  dialogue: QuoTranscriptLine[] | null | undefined,
  ctx: IngestContext
): Array<{ who: string; text: string; at: number }> {
  return (dialogue ?? [])
    .filter((l) => (l.content ?? "").trim())
    .map((l) => ({
      // The webhook names the staffer `userId`; the versioned
      // transcripts endpoint names them `actorId`.
      who: (l.userId ?? l.actorId)
        ? ctx.users.get((l.userId ?? l.actorId) as string)?.name || "Staff"
        : "Caller",
      text: l.content.trim(),
      at: Math.max(0, Math.round(l.start ?? 0)),
    }));
}

export async function applyCallTranscript(
  quoCallId: string,
  dialogue: QuoTranscriptLine[] | null | undefined,
  ctx: IngestContext
): Promise<IngestOutcome> {
  const lines = compactTranscript(dialogue, ctx);
  if (lines.length === 0) return "unchanged";
  const row = await ensureCallRow(quoCallId, ctx);
  if (!row) return "skipped_unknown";
  if (JSON.stringify(row.transcript) === JSON.stringify(lines)) return "unchanged";
  await xano.calls.update(row.id, { transcript: lines });
  return "updated";
}

export async function applyCallSummary(
  quoCallId: string,
  summary: string[] | null | undefined,
  nextSteps: string[] | null | undefined,
  ctx: IngestContext
): Promise<IngestOutcome> {
  if (!summary?.length && !nextSteps?.length) return "unchanged";
  const row = await ensureCallRow(quoCallId, ctx);
  if (!row) return "skipped_unknown";
  const patch: Partial<XanoCall> = {};
  if (summary?.length && JSON.stringify(summary) !== JSON.stringify(row.summary)) patch.summary = summary;
  if (nextSteps?.length && JSON.stringify(nextSteps) !== JSON.stringify(row.next_steps)) patch.next_steps = nextSteps;
  if (Object.keys(patch).length === 0) return "unchanged";
  await xano.calls.update(row.id, patch);
  return "updated";
}

export async function applyCallVoicemail(
  quoCallId: string,
  voicemail: { transcript: string | null; duration: number | null },
  ctx: IngestContext
): Promise<IngestOutcome> {
  const row = await ensureCallRow(quoCallId, ctx);
  if (!row) return "skipped_unknown";
  const patch: Partial<XanoCall> = {};
  if (!row.has_voicemail) patch.has_voicemail = true;
  if (row.status !== "voicemail") patch.status = "voicemail";
  const transcript = (voicemail.transcript ?? "").trim();
  if (transcript && transcript !== row.voicemail_transcript) patch.voicemail_transcript = transcript;
  if (Object.keys(patch).length === 0) return "unchanged";
  await xano.calls.update(row.id, patch);
  return "updated";
}

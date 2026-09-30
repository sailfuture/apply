import { xano } from "@/lib/xano";
import { sendSms, type SendSmsInput } from "@/lib/sms/send";
import { toE164 } from "@/lib/phone";
import {
  normPhone,
  phoneFromAdhocId,
  pickAccountHolderParent,
  type SmsContactType,
} from "@/lib/sms/contacts";

/**
 * The group-text engine: one message to an EXPLICIT recipient list,
 * sent now. Shared by the group route (staff pressed Send) and the
 * scheduled-sends cron (staff pressed Send later), so the two can't
 * drift on who is reachable, how a text is personalized, or how a
 * retry resumes.
 *
 * The server never decides WHO — only whether each named contact is
 * reachable right now (number on file, not opted out; `sendSms`
 * re-checks consent as the final authority). Contacts span every
 * record type; each send logs onto that contact's own thread.
 *
 * Idempotency: the caller mints a `blastId`; the batch logs with
 * template `group:<yearId>:<blastId>` and any contact already carrying
 * a non-failed message under that template is skipped — a retry after
 * a timeout resumes instead of double-texting. If the log can't be
 * read to make that check, the blast is refused before any text goes
 * out (`GroupSendError`, status 503).
 */

export const CONTACT_TYPES: SmsContactType[] = [
  "family",
  "inquiry",
  "camp",
  "visit",
  "tasco",
  // Ad-hoc: staff-typed numbers with no record — id IS the 10-digit
  // phone; sends log with no contact FK and thread by number.
  "adhoc",
];
export const BLAST_ID_RE = /^[\w-]{6,64}$/;
/** Sanity ceiling — one blast is a school's worth of families, not a
 *  marketing list. */
export const MAX_RECIPIENTS = 500;

/**
 * `{{first_name}}` personalization — replaced per recipient at send
 * time with their first name ("there" when the record has none), so
 * one composed blast still reads like a personal text. Keep the
 * pattern in sync with FIRST_NAME_RE in the compose dialog.
 */
const FIRST_NAME_TOKEN_RE = /\{\{\s*first_name\s*\}\}/gi;
function personalize(body: string, firstName: string): string {
  const name = firstName.trim() || "there";
  return body.replace(FIRST_NAME_TOKEN_RE, name);
}

export interface ContactRef {
  type: SmsContactType;
  id: number;
}

/** Strict recipient validation — a malformed entry fails the whole
 *  list, never silently texts the wrong record type. Duplicates
 *  collapse. Returns the list, or the message to show. */
export function parseContacts(raw: unknown): ContactRef[] | string {
  if (!Array.isArray(raw) || raw.length === 0) {
    return "contacts is required — pick at least one recipient";
  }
  if (raw.length > MAX_RECIPIENTS) {
    return `At most ${MAX_RECIPIENTS} recipients per blast`;
  }
  const contacts: ContactRef[] = [];
  const seen = new Set<string>();
  for (const c of raw) {
    const type = (c as { type?: unknown })?.type as SmsContactType;
    const id = Number((c as { id?: unknown })?.id);
    if (!CONTACT_TYPES.includes(type) || !Number.isFinite(id) || id <= 0) {
      return "Each contact must be { type: family|inquiry|camp|visit|tasco|adhoc, id: number }";
    }
    const key = `${type}-${id}`;
    if (seen.has(key)) continue; // client double-added — harmless
    seen.add(key);
    contacts.push({ type, id });
  }
  return contacts;
}

export class GroupSendError extends Error {
  status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.name = "GroupSendError";
    this.status = status;
  }
}

export interface GroupSendInput {
  yearId: number;
  contacts: ContactRef[];
  body: string;
  blastId: string;
  author: { email: string; name: string };
}

export interface GroupSendResult {
  matched: number;
  sendable: number;
  sent: number;
  failed: number;
  alreadySent: number;
  skippedOptedOut: number;
  skippedNoPhone: number;
}

export async function sendGroupText(input: GroupSendInput): Promise<GroupSendResult> {
  const { yearId, contacts, author } = input;
  const text = input.body.trim();

  // ── Resolve reachability for the named contacts (batch reads —
  //    a few table scans max, never N round-trips) ─────────────────
  const wantFamilies = contacts.some((c) => c.type === "family");
  const wantInquiries = contacts.some((c) => c.type === "inquiry");
  const wantCamp = contacts.some((c) => c.type === "camp");
  const wantVisits = contacts.some((c) => c.type === "visit");
  const wantTasco = contacts.some((c) => c.type === "tasco");
  const [families, inquiries, campRows, waivers, tascoRows] =
    await Promise.all([
      wantFamilies
        ? xano.families.getAllDetails().catch(() => [])
        : Promise.resolve([]),
      wantInquiries
        ? xano.inquiries.getAll().catch(() => [])
        : Promise.resolve([]),
      wantCamp
        ? xano.summerCamp.getAll().catch(() => [])
        : Promise.resolve([]),
      wantVisits
        ? xano.websiteWaivers.getAll().catch(() => [])
        : Promise.resolve([]),
      wantTasco
        ? xano.tascoSummerVisits.getAll().catch(() => [])
        : Promise.resolve([]),
    ]);
  const familyById = new Map(families.map((f) => [f.id, f]));
  const inquiryById = new Map(inquiries.map((i) => [i.id, i]));
  const campById = new Map(campRows.map((c) => [c.id, c]));
  const visitById = new Map(waivers.map((w) => [w.id, w]));
  const tascoById = new Map(tascoRows.map((t) => [t.id, t]));

  interface Target {
    ref: ContactRef;
    send: SendSmsInput;
    /** Recipient's first name for `{{first_name}}` personalization. */
    firstName: string;
    sendable: boolean;
    optedOut: boolean;
    hasPhone: boolean;
  }
  const targets: Target[] = contacts.map((ref) => {
    if (ref.type === "family") {
      const fam = familyById.get(ref.id);
      const parent = pickAccountHolderParent(
        fam?.registration_parents_id ?? []
      );
      const e164 = toE164(parent?.phone ?? null);
      const optedOut = Boolean(parent?.sms_opted_out_at);
      return {
        ref,
        send: {
          contact: ref,
          yearId,
          body: text,
          // `parent` keeps sendSms's opt-out gate authoritative;
          // `to` pins the resolved number.
          parent: parent ?? null,
          to: e164,
          author,
        },
        firstName: parent?.first_name ?? "",
        sendable: Boolean(e164) && !optedOut,
        optedOut,
        hasPhone: Boolean(e164),
      };
    }
    if (ref.type === "inquiry") {
      const row = inquiryById.get(ref.id);
      const e164 = toE164(String(row?.primary_phone ?? ""));
      const optedOut = row?.messaging_opt_in === false;
      return {
        ref,
        send: { contact: ref, yearId, body: text, author },
        firstName: row?.primary_first_name ?? "",
        sendable: Boolean(row) && Boolean(e164) && !optedOut,
        optedOut,
        hasPhone: Boolean(e164),
      };
    }
    if (ref.type === "visit") {
      const row = visitById.get(ref.id);
      const e164 = toE164(row?.parent_phone ?? "");
      // The public waiver's marketing checkbox is the texting
      // consent — anything else reads as opted out.
      const optedOut = row?.marketing_opt_in !== true;
      return {
        ref,
        send: { contact: ref, yearId, body: text, author },
        firstName: (row?.parent_name ?? "").trim().split(/\s+/)[0] ?? "",
        sendable: Boolean(row) && Boolean(e164) && !optedOut,
        optedOut,
        hasPhone: Boolean(e164),
      };
    }
    if (ref.type === "tasco") {
      const row = tascoById.get(ref.id);
      const e164 = toE164(row?.parent_phone ?? "");
      return {
        ref,
        send: { contact: ref, yearId, body: text, author },
        // TASCO rows have no parent name — personalization falls
        // back to "there".
        firstName: "",
        sendable: Boolean(row) && Boolean(e164),
        optedOut: false,
        hasPhone: Boolean(e164),
      };
    }
    if (ref.type === "adhoc") {
      const e164 = toE164(phoneFromAdhocId(ref.id));
      return {
        ref,
        send: { contact: ref, yearId, body: text, author },
        firstName: "",
        sendable: Boolean(e164),
        optedOut: false,
        hasPhone: Boolean(e164),
      };
    }
    const row = campById.get(ref.id);
    const e164 = toE164(row?.primary_phone ?? "");
    return {
      ref,
      send: { contact: ref, yearId, body: text, author },
      firstName: row?.primary_parent_first_name ?? "",
      sendable: Boolean(row) && Boolean(e164),
      optedOut: false,
      hasPhone: Boolean(e164),
    };
  });

  // One template value per blast — greppable, renders as a staff
  // message on each thread, and doubles as the idempotency key.
  const template = `group:${yearId}:${input.blastId}`;

  // Resume support across ALL contact types — skip anyone this
  // exact blast already texted; failed sends were logged "failed"
  // so they retry.
  //
  // Fails CLOSED. A retry after a partial failure is the ordinary
  // case, and on a retry, sending without knowing who was already
  // reached texts every one of them twice. So the log is read
  // straight from Xano (not the cached list), and if it can't be
  // read nothing goes out. An EMPTY log counts as unreadable — this
  // table is never empty in production, so that is a bad read, not
  // a clean slate.
  const prior = await xano.smsMessages.getAllStrict().catch((err) => {
    console.error("[group-send] couldn't read the log:", err);
    return null;
  });
  if (!prior || prior.length === 0) {
    throw new GroupSendError(
      "Couldn't check who this message has already reached, so " +
        "nothing was sent. Try again in a moment.",
      503
    );
  }
  const alreadySent = new Set<string>();
  for (const m of prior) {
    if (m.template !== template || m.status === "failed") continue;
    if (m.registration_families_id)
      alreadySent.add(`family-${m.registration_families_id}`);
    if (m.registration_inquiry_id)
      alreadySent.add(`inquiry-${m.registration_inquiry_id}`);
    if (m.registration_summer_camp_id)
      alreadySent.add(`camp-${m.registration_summer_camp_id}`);
    if (m.website_liability_waiver_id)
      alreadySent.add(`visit-${m.website_liability_waiver_id}`);
    if (m.tasco_summer_visit_id)
      alreadySent.add(`tasco-${m.tasco_summer_visit_id}`);
    // Ad-hoc rows carry no FK — resume-match them on the number
    // the blast texted.
    if (
      !m.registration_families_id &&
      !m.registration_inquiry_id &&
      !m.registration_summer_camp_id &&
      !m.website_liability_waiver_id &&
      !m.tasco_summer_visit_id
    ) {
      const key = normPhone(m.to_number);
      if (key.length === 10) alreadySent.add(`adhoc-${Number(key)}`);
    }
  }

  const toSend = targets.filter(
    (t) => t.sendable && !alreadySent.has(`${t.ref.type}-${t.ref.id}`)
  );

  // Bounded concurrency — fast enough for a few hundred contacts
  // without hammering the carrier gateway, which queues on its side.
  const CONCURRENCY = 5;
  let sent = 0;
  let failed = 0;
  for (let i = 0; i < toSend.length; i += CONCURRENCY) {
    const batch = toSend.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map((t) =>
        sendSms({
          ...t.send,
          template,
          body: personalize(text, t.firstName),
        }).catch(() => ({ ok: false as const }))
      )
    );
    for (const res of results) {
      if (res.ok) sent += 1;
      else failed += 1;
    }
  }

  return {
    matched: targets.length,
    sendable: targets.filter((t) => t.sendable).length,
    sent,
    failed,
    alreadySent: alreadySent.size,
    skippedOptedOut: targets.filter((t) => t.optedOut).length,
    skippedNoPhone: targets.filter((t) => !t.hasPhone).length,
  };
}

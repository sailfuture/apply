import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import { sendSms, type SendSmsInput } from "@/lib/sms/send";
import { toE164 } from "@/lib/phone";
import {
  pickAccountHolderParent,
  type SmsContactType,
} from "@/lib/sms/contacts";

/**
 * Group SMS blast to an EXPLICIT recipient list. The compose dialog
 * builds the audience itself (search + multi-select over
 * `/api/admin/messages/group/audience`) and posts exactly who to
 * text:
 *
 *   POST { yearId, contacts: [{ type, id }, …], body, blastId }
 *
 * This replaced the filter-resolved audience (year + coarse stage
 * pills) — the server no longer decides WHO, only whether each named
 * contact is reachable right now (number on file, not opted out;
 * `sendSms` re-checks consent as the final authority). Contacts span
 * all three record types; each send logs onto that contact's own
 * thread.
 *
 * Idempotency: the client mints a `blastId` per compose session; the
 * batch logs with template `group:<yearId>:<blastId>` and any contact
 * already carrying a non-failed message under that template is
 * skipped — a retry after a timeout resumes instead of double-texting.
 */
export const maxDuration = 300;

const CONTACT_TYPES: SmsContactType[] = ["family", "inquiry", "camp"];
const BLAST_ID_RE = /^[\w-]{6,64}$/;

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
/** Sanity ceiling — one blast is a school's worth of families, not a
 *  marketing list. */
const MAX_RECIPIENTS = 500;

interface ContactRef {
  type: SmsContactType;
  id: number;
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

    const yearId = Number(body.yearId);
    if (!Number.isFinite(yearId) || yearId <= 0) {
      return NextResponse.json(
        { error: "A school year is required" },
        { status: 400 }
      );
    }

    // Strict recipient validation — a malformed entry must fail the
    // whole request, never silently text the wrong record type.
    const rawContacts = body.contacts;
    if (!Array.isArray(rawContacts) || rawContacts.length === 0) {
      return NextResponse.json(
        { error: "contacts is required — pick at least one recipient" },
        { status: 400 }
      );
    }
    if (rawContacts.length > MAX_RECIPIENTS) {
      return NextResponse.json(
        { error: `At most ${MAX_RECIPIENTS} recipients per blast` },
        { status: 400 }
      );
    }
    const contacts: ContactRef[] = [];
    const seen = new Set<string>();
    for (const c of rawContacts) {
      const type = c?.type as SmsContactType;
      const id = Number(c?.id);
      if (
        !CONTACT_TYPES.includes(type) ||
        !Number.isFinite(id) ||
        id <= 0
      ) {
        return NextResponse.json(
          {
            error:
              "Each contact must be { type: family|inquiry|camp, id: number }",
          },
          { status: 400 }
        );
      }
      const key = `${type}-${id}`;
      if (seen.has(key)) continue; // client double-added — harmless
      seen.add(key);
      contacts.push({ type, id });
    }

    const text = typeof body.body === "string" ? body.body.trim() : "";
    if (!text) {
      return NextResponse.json(
        { error: "Message body is required" },
        { status: 400 }
      );
    }

    const blastId = typeof body.blastId === "string" ? body.blastId : "";
    if (!BLAST_ID_RE.test(blastId)) {
      return NextResponse.json(
        { error: "A valid blastId is required" },
        { status: 400 }
      );
    }

    // ── Resolve reachability for the named contacts (batch reads —
    //    three table scans max, never N round-trips) ─────────────────
    const wantFamilies = contacts.some((c) => c.type === "family");
    const wantInquiries = contacts.some((c) => c.type === "inquiry");
    const wantCamp = contacts.some((c) => c.type === "camp");
    const [families, inquiries, campRows] = await Promise.all([
      wantFamilies
        ? xano.families.getAllDetails().catch(() => [])
        : Promise.resolve([]),
      wantInquiries
        ? xano.inquiries.getAll().catch(() => [])
        : Promise.resolve([]),
      wantCamp
        ? xano.summerCamp.getAll().catch(() => [])
        : Promise.resolve([]),
    ]);
    const familyById = new Map(families.map((f) => [f.id, f]));
    const inquiryById = new Map(inquiries.map((i) => [i.id, i]));
    const campById = new Map(campRows.map((c) => [c.id, c]));

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
            author: { email: admin.email, name: admin.name },
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
          send: {
            contact: ref,
            yearId,
            body: text,
            author: { email: admin.email, name: admin.name },
          },
          firstName: row?.primary_first_name ?? "",
          sendable: Boolean(row) && Boolean(e164) && !optedOut,
          optedOut,
          hasPhone: Boolean(e164),
        };
      }
      const row = campById.get(ref.id);
      const e164 = toE164(row?.primary_phone ?? "");
      return {
        ref,
        send: {
          contact: ref,
          yearId,
          body: text,
          author: { email: admin.email, name: admin.name },
        },
        firstName: row?.primary_parent_first_name ?? "",
        sendable: Boolean(row) && Boolean(e164),
        optedOut: false,
        hasPhone: Boolean(e164),
      };
    });

    // One template value per blast — greppable, renders as a staff
    // message on each thread, and doubles as the idempotency key.
    const template = `group:${yearId}:${blastId}`;

    // Resume support across ALL contact types — skip anyone this
    // exact blast already texted. Best-effort: on a failed log read
    // we proceed; failed sends were logged "failed" so they retry.
    const alreadySent = new Set<string>();
    try {
      const prior = await xano.smsMessages.getAll();
      for (const m of prior) {
        if (m.template !== template || m.status === "failed") continue;
        if (m.registration_families_id)
          alreadySent.add(`family-${m.registration_families_id}`);
        if (m.registration_inquiry_id)
          alreadySent.add(`inquiry-${m.registration_inquiry_id}`);
        if (m.registration_summer_camp_id)
          alreadySent.add(`camp-${m.registration_summer_camp_id}`);
      }
    } catch {
      // proceed without resume data
    }

    const toSend = targets.filter(
      (t) => t.sendable && !alreadySent.has(`${t.ref.type}-${t.ref.id}`)
    );

    // Bounded concurrency — fast enough for a few hundred contacts
    // without hammering Twilio; the Messaging Service also queues on
    // its side.
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

    return NextResponse.json({
      matched: targets.length,
      sendable: targets.filter((t) => t.sendable).length,
      sent,
      failed,
      alreadySent: alreadySent.size,
      skippedOptedOut: targets.filter((t) => t.optedOut).length,
      skippedNoPhone: targets.filter((t) => !t.hasPhone).length,
    });
  } catch (err) {
    return handleAdminError(err);
  }
}

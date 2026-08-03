import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import {
  xano,
  LEAD_NOTE_SOURCES,
  type LeadNoteSource,
  type XanoSmsMessage,
} from "@/lib/xano";
import { sendSms } from "@/lib/sms/send";
import {
  counterpartyPhone,
  getContactRecipient,
  messageContactRef as messageContact,
  phoneFromAdhocId,
  resolvePrimaryParent,
  type SmsContactType,
} from "@/lib/sms/contacts";
import { computeFamilyStageSets } from "@/lib/sms/stages";
import { bumpLeadReachOut } from "@/lib/leads";

/** Where a conversation's contact sits in the pipeline — the inbox's
 *  filter chips. Family stages come from the shared bucketing in
 *  lib/sms/stages.ts (scoped to the `?yearId=` the inbox passes);
 *  "none" = a family with no activity for that year (and ad-hoc
 *  numbers, which have no pipeline position at all). */
export type ConversationStage =
  | "enrolled"
  | "registration"
  | "application"
  | "inquiry"
  | "camp"
  | "visit"
  | "tasco"
  | "none";

/** One row in the global inbox's conversation list — the latest text
 *  per contact plus a needs-reply flag. A contact is a family, an
 *  inquiry, or a summer-camp parent; threads are one continuous
 *  history per contact, never split by academic year (the stage
 *  annotation is year-scoped display context, not a thread filter). */
export interface SmsConversation {
  contactType: SmsContactType;
  contactId: number;
  /** Display name — family name, or the inquiry/camp parent's name. */
  name: string;
  /** The contact's phone (bare 10-digit), derived from the latest
   *  message's counterparty number — shown beside the name in the
   *  inbox. Empty when it can't be derived. */
  phone: string;
  stage: ConversationStage;
  lastBody: string;
  lastAt: number;
  lastDirection: string;
  /** True when the latest message was part of a group blast
   *  (template `group:…`) — the list renders those distinctly. */
  lastIsGroup: boolean;
  messageCount: number;
  /** True when the most recent message is inbound (contact texted, no
   *  reply yet) — drives the unread dot in the inbox. */
  needsReply: boolean;
  /** Everything the inbox search box should match beyond the display
   *  name — parent + student names for families, the student's name
   *  for lead contacts. Lowercased server-side. */
  searchText: string;
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
      // conversation per contact, keyed on the newest message. When
      // the page passes its `?yearId=`, family conversations also get
      // a pipeline-stage annotation for the filter chips (extra
      // fetches only run in that case).
      const yearIdParam = req.nextUrl.searchParams.get("yearId");
      const yearId = Number(yearIdParam);
      const withStages = Number.isFinite(yearId) && yearId > 0;
      const [
        messages,
        families,
        inquiries,
        campRows,
        waivers,
        tascoRows,
        parents,
        students,
        fap,
        srp,
        apps,
      ] =
        await Promise.all([
          xano.smsMessages.getAll(),
          xano.families.getAll().catch(() => []),
          xano.inquiries.getAll().catch(() => []),
          xano.summerCamp.getAll().catch(() => []),
          xano.websiteWaivers.getAll().catch(() => []),
          xano.tascoSummerVisits.getAll().catch(() => []),
          xano.parents.getAll().catch(() => []),
          xano.students.getAll().catch(() => []),
          withStages
            ? xano.familyApplicationProgress.getByYear(yearId).catch(() => [])
            : Promise.resolve([]),
          withStages
            ? xano.studentRegistrationProgress
                .getByYear(yearId)
                .catch(() => [])
            : Promise.resolve([]),
          withStages
            ? xano.applications.getAll().catch(() => [])
            : Promise.resolve([]),
        ]);
      const stageSets = withStages
        ? computeFamilyStageSets({ yearId, fap, srp, apps })
        : null;
      const familyStage = (id: number): ConversationStage => {
        if (!stageSets) return "none";
        if (stageSets.enrolled.has(id)) return "enrolled";
        if (stageSets.registration.has(id)) return "registration";
        if (stageSets.application.has(id)) return "application";
        return "none";
      };
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
      const visitName = new Map(
        waivers.map((w) => [w.id, (w.parent_name ?? "").trim()])
      );
      const tascoName = new Map(
        tascoRows.map((t) => {
          const student = (t.student_name ?? "").trim();
          return [t.id, student ? `Parent of ${student}` : ""];
        })
      );
      // Per-contact search haystack — the inbox search box matches on
      // this in addition to the display name, so typing a STUDENT's or
      // a parent's name finds the family conversation even though the
      // list shows only the family name.
      const familySearch = new Map<number, string>();
      const parentById = new Map(parents.map((p) => [p.id, p]));
      for (const f of families) {
        const names = xano.families
          .getParentIds(f)
          .map((pid) => parentById.get(pid))
          .filter((p) => p != null)
          .map((p) => `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim());
        familySearch.set(f.id, names.join(" "));
      }
      for (const s of students) {
        const fid = s.registration_families_id;
        if (!fid) continue;
        const name = `${s.first_name ?? ""} ${s.last_name ?? ""}`.trim();
        if (!name) continue;
        familySearch.set(fid, `${familySearch.get(fid) ?? ""} ${name}`);
      }
      const inquirySearch = new Map(
        inquiries.map((i) => [
          i.id,
          `${i.student_first_name ?? ""} ${i.student_last_name ?? ""}`.trim(),
        ])
      );
      const campSearch = new Map(
        campRows.map((c) => [
          c.id,
          `${c.student_first_name ?? ""} ${c.student_last_name ?? ""}`.trim(),
        ])
      );
      const visitSearch = new Map(
        waivers.map((w) => [w.id, (w.student_name ?? "").trim()])
      );
      const tascoSearch = new Map(
        tascoRows.map((t) => [t.id, (t.student_name ?? "").trim()])
      );
      const searchFor = (type: SmsContactType, id: number): string => {
        const extra =
          type === "family"
            ? familySearch.get(id)
            : type === "inquiry"
              ? inquirySearch.get(id)
              : type === "camp"
                ? campSearch.get(id)
                : type === "visit"
                  ? visitSearch.get(id)
                  : type === "tasco"
                    ? tascoSearch.get(id)
                    : "";
        return (extra ?? "").toLowerCase();
      };

      const nameFor = (type: SmsContactType, id: number): string => {
        // Ad-hoc threads have no record — the formatted number IS the
        // name (the inbox shows it verbatim).
        if (type === "adhoc") return phoneFromAdhocId(id);
        const raw =
          type === "family"
            ? familyName.get(id)
            : type === "inquiry"
              ? inquiryName.get(id)
              : type === "camp"
                ? campName.get(id)
                : type === "tasco"
                  ? tascoName.get(id)
                  : visitName.get(id);
        if (raw && raw.trim()) return raw.trim();
        return type === "family"
          ? `Family #${id}`
          : type === "inquiry"
            ? `Inquiry #${id}`
            : type === "camp"
              ? `Camp #${id}`
              : type === "tasco"
                ? `TASCO #${id}`
                : `Visit #${id}`;
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
          phone: counterpartyPhone(last),
          stage:
            type === "inquiry"
              ? ("inquiry" as const)
              : type === "camp"
                ? ("camp" as const)
                : type === "visit"
                  ? ("visit" as const)
                  : type === "tasco"
                    ? ("tasco" as const)
                    : type === "adhoc"
                      ? ("none" as const)
                      : familyStage(id),
          lastBody: last.body,
          lastAt: last.created_at,
          lastDirection: last.direction,
          lastIsGroup:
            typeof last.template === "string" &&
            last.template.startsWith("group"),
          messageCount: count,
          needsReply: last.direction === "inbound",
          searchText: searchFor(type, id),
        }))
        .sort((a, b) => b.lastAt - a.lastAt);
      return NextResponse.json({ conversations });
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
    const [messages, recipient] = await Promise.all([
      messagesPromise,
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
              ? "SMS isn't configured yet (missing Twilio credentials)."
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
    await requireAdmin();
    const body = await req.json().catch(() => null);
    const contactId = Number(body?.contactId);
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

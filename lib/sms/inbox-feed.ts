import {
  xano,
  type XanoCall,
  type XanoSmsMessage,
} from "@/lib/xano";
import {
  callContactRef,
  counterpartyPhone,
  messageContactRef as messageContact,
  normPhone,
  phoneFromAdhocId,
  type SmsContactType,
} from "@/lib/sms/contacts";
import { callNeedsReply, callPreview } from "@/lib/calls";
import { computeFamilyStageSets } from "@/lib/sms/stages";
import { getFacultyByPhone } from "@/lib/sms/faculty";
import { isFollowUpTemplate } from "@/lib/nurture/templates";
import { defaultAdminYear } from "@/lib/school-year-default";
import { isMediaOnlyBody, mediaPreviewLabel, smsMedia } from "@/lib/sms/media";
import { readClosedConversations } from "@/lib/app-settings";

/**
 * The admin inbox's conversation list — one row per contact across
 * families, leads and ad-hoc numbers, newest activity first. Built
 * here (not in the route) so the two-stage inbox can ask for it two
 * ways with one definition:
 *
 *   - `since` set   → the WINDOW: only texts and calls at or after
 *                     that instant are read (the list endpoints'
 *                     `created_at_from` / `started_at_from` inputs),
 *                     and the parent/student search haystack is
 *                     skipped. This is what paints first.
 *   - `since` unset → the FULL feed: the whole message log, every
 *                     call, and the search text for every family.
 *
 * Both return the same `SmsConversation[]` shape; the client merges
 * them by contact key, so a row's position never changes when the
 * full feed lands under it.
 */

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
  /** True when the newest thing on the thread is a phone call rather
   *  than a text — `lastBody` is then the call's one-line description
   *  ("Missed call", "Incoming call · 4 min", "Voicemail: …"). */
  lastIsCall: boolean;
  /** True when the newest text carries a photo or file — the list
   *  shows an attachment icon, and `lastBody` reads "Photo" / "File"
   *  when the text had no words of its own. */
  lastHasMedia: boolean;
  /** Texts only — calls aren't counted. In a WINDOW response this is
   *  the count inside the window, not the thread's lifetime total. */
  messageCount: number;
  /** True when the most recent message is inbound (contact texted, no
   *  reply yet) — drives the unread dot in the inbox. Never true on a
   *  closed thread. */
  needsReply: boolean;
  /** When staff closed this thread (unix ms), 0 when never. */
  closedAt: number;
  /** True while the close stamp is newer than everything on the
   *  thread — the inbox lists hide these. A text or call after the
   *  close reopens the thread without anyone touching it. */
  closed: boolean;
  /** Everything the inbox search box should match beyond the display
   *  name — parent + student names for families, the student's name
   *  for lead contacts. Lowercased server-side. Empty for family rows
   *  in a WINDOW response (the full feed fills it in). */
  searchText: string;
  /** The enrolled family this thread belongs to, when there is one —
   *  the family itself for family threads, or the family a lead
   *  (inquiry / camp / visit / TASCO) converted into. Set only when
   *  that family is enrolled; the inbox uses it to keep enrolled
   *  parents off the Recruitment page and to join crew / bus / grade
   *  on the enrolled page. */
  enrolledFamilyId?: number;
}

export interface InboxFeedOptions {
  /** School year the family stages are computed for. `null` resolves
   *  the same default the YearSelector would inject into the URL
   *  (lib/school-year-default.ts), so a page that fetches before the
   *  selector has run gets the answer it would have asked for. */
  yearId: number | null;
  /** Window start (unix ms). When set, only texts and calls at or
   *  after it are read and the search haystack is skipped. */
  since?: number | null;
}

/** How far back the FULL feed reads calls. The list only ever shows
 *  each contact's newest call, and a call is only the newest thing on
 *  a thread for as long as nobody texts — three months is well past
 *  that for anyone still in touch. (Calls have only been mirrored
 *  since 2026-09-23, so today this is the whole table anyway.) */
export const FULL_CALLS_LOOKBACK_MS = 90 * 24 * 60 * 60 * 1000;

/** The few facts the list needs about a call. Built the moment the
 *  rows arrive so the transcripts, summaries and next-steps JSON that
 *  make `registration_calls` a 400 KB table are dropped before the
 *  rest of the feed is assembled — none of it reaches the inbox list. */
interface CallSummary {
  id: number;
  /** `started_at`, else `created_at`. */
  at: number;
  direction: string;
  counterparty: string;
  contact: { type: SmsContactType; id: number } | null;
  /** `callPreview` — the list's one-line description. */
  preview: string;
  needsReply: boolean;
}

/** The full feed's call window start, snapped to the hour: the read
 *  is cached by URL (lib/xano-fetch.ts), and a start that moved with
 *  the clock would make every poll a cache miss. */
function fullCallsSince(): number {
  const HOUR = 60 * 60 * 1000;
  return Math.floor((Date.now() - FULL_CALLS_LOOKBACK_MS) / HOUR) * HOUR;
}

function slimCalls(rows: XanoCall[]): CallSummary[] {
  return rows.map((c) => ({
    id: c.id,
    at: c.started_at || c.created_at,
    direction: c.direction,
    counterparty: c.counterparty,
    contact: callContactRef(c),
    preview: callPreview(c),
    needsReply: callNeedsReply(c),
  }));
}

export interface InboxFeed {
  conversations: SmsConversation[];
  /** The year the stages were computed for (resolved when the caller
   *  passed null); 0 when no year could be resolved. */
  yearId: number;
}

export async function buildInboxFeed(
  options: InboxFeedOptions
): Promise<InboxFeed> {
  const since =
    typeof options.since === "number" && Number.isFinite(options.since) && options.since > 0
      ? Math.floor(options.since)
      : null;
  const isWindow = since !== null;

  // The year list comes first because the stage reads below depend on
  // it (the default year when the caller passed none, and the
  // "enrolled" split, which unions the selected year with the live +
  // upcoming ones). It's a cached 3 KB table, so this round trip is
  // nearly free — and folding the dependent reads into ONE second
  // round beats the old shape of a third serial round for them.
  const years = await xano.schoolYears.getAll().catch(() => []);
  const yearId =
    options.yearId === null
      ? (defaultAdminYear(years)?.id ?? 0)
      : options.yearId;
  const withStages = Number.isFinite(yearId) && yearId > 0;
  const extraYearIds = years
    .filter((y) => (y.isActive || y.isNextYear) && y.id !== yearId)
    .map((y) => y.id);

  const [
    messages,
    calls,
    families,
    inquiries,
    campRows,
    waivers,
    tascoRows,
    parents,
    students,
    fap,
    srp,
    extraSrp,
    facultyByPhone,
    closedMap,
  ] = await Promise.all([
    isWindow ? xano.smsMessages.getSince(since) : xano.smsMessages.getAll(),
    // Main Line calls (mirrored from Quo) — a call is the newest
    // thing on a thread as often as a text is, and a contact who
    // has only ever called still belongs in the list. Windowed in
    // both stages (see FULL_CALLS_LOOKBACK_MS) and slimmed on arrival.
    xano.calls
      .getSince(since ?? fullCallsSince())
      .then(slimCalls)
      .catch((): CallSummary[] => []),
    // Name tables — all cached for 30 s, and the lead tables also
    // carry the lead → family link, so the window keeps them.
    xano.families.getAll().catch(() => []),
    xano.inquiries.getAll().catch(() => []),
    xano.summerCamp.getAll().catch(() => []),
    xano.websiteWaivers.getAll().catch(() => []),
    xano.tascoSummerVisits.getAll().catch(() => []),
    // Search haystack only — the window skips both.
    isWindow ? Promise.resolve([]) : xano.parents.getAll().catch(() => []),
    isWindow ? Promise.resolve([]) : xano.students.getAll().catch(() => []),
    withStages
      ? xano.familyApplicationProgress.getByYear(yearId).catch(() => [])
      : Promise.resolve([]),
    withStages
      ? xano.studentRegistrationProgress.getByYear(yearId).catch(() => [])
      : Promise.resolve([]),
    Promise.all(
      extraYearIds.map((id) =>
        xano.studentRegistrationProgress.getByYear(id).catch(() => [])
      )
    ),
    // Faculty are texted as ad-hoc numbers — name their threads.
    // (closedMap, the last entry, is appended below.)
    getFacultyByPhone(),
    readClosedConversations(),
  ]);

  const stageSets = withStages ? computeFamilyStageSets({ fap, srp }) : null;
  // "Enrolled" for the inbox split isn't only the selected year:
  // a family confirmed for the current year who hasn't re-enrolled
  // for next year is still an enrolled parent, and shouldn't land
  // in Recruitment just because the admin is viewing next year.
  // Union the selected year with the active + upcoming years.
  const enrolledFamilies = new Set<number>(stageSets?.enrolled ?? []);
  for (const rows of extraSrp) {
    const { enrolled } = computeFamilyStageSets({ fap: [], srp: rows });
    for (const fid of enrolled) enrolledFamilies.add(fid);
  }

  // Leads that converted into a family — a camp or inquiry thread
  // with a parent who's since enrolled belongs with that family.
  const leadFamily = new Map<string, number>();
  const linkLeads = (
    type: SmsContactType,
    rows: { id: number; registration_families_id?: number | null }[]
  ) => {
    for (const r of rows) {
      const fid = Number(r.registration_families_id) || 0;
      if (fid > 0) leadFamily.set(`${type}:${r.id}`, fid);
    }
  };
  linkLeads("inquiry", inquiries);
  linkLeads("camp", campRows);
  linkLeads("visit", waivers);
  linkLeads("tasco", tascoRows);
  const enrolledFamilyFor = (
    type: SmsContactType,
    id: number
  ): number | undefined => {
    const fid = type === "family" ? id : leadFamily.get(`${type}:${id}`);
    return fid && enrolledFamilies.has(fid) ? fid : undefined;
  };
  const familyStage = (id: number): ConversationStage => {
    if (!stageSets) return "none";
    if (enrolledFamilies.has(id)) return "enrolled";
    if (stageSets.registration.has(id)) return "registration";
    if (stageSets.application.has(id)) return "application";
    return "none";
  };
  const familyName = new Map(families.map((f) => [f.id, f.family_name]));
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
  // list shows only the family name. (Family entries stay empty in
  // the window — parents/students weren't read.)
  const familySearch = new Map<number, string>();
  const parentById = new Map(parents.map((p) => [p.id, p]));
  if (!isWindow) {
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
    if (type === "adhoc") {
      const phone = phoneFromAdhocId(id);
      return facultyByPhone.get(phone)?.name || phone;
    }
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
      /** Newest text, or null on a thread that is calls only. */
      last: XanoSmsMessage | null;
      /** Newest message that isn't an automated follow-up — what
       *  "needs a reply" is judged on, so a tour reminder going
       *  out can't hide a parent's unanswered question. */
      lastForReply: XanoSmsMessage | null;
      /** Newest phone call with this contact. */
      lastCall: CallSummary | null;
      count: number;
    }
  >();
  for (const m of messages) {
    const c = messageContact(m);
    if (!c) continue;
    const key = `${c.type}:${c.id}`;
    const counts = !(
      m.direction === "outbound" && isFollowUpTemplate(m.template)
    );
    const existing = byContact.get(key);
    if (!existing) {
      byContact.set(key, {
        ...c,
        last: m,
        lastForReply: counts ? m : null,
        lastCall: null,
        count: 1,
      });
    } else {
      existing.count += 1;
      if (!existing.last || m.created_at > existing.last.created_at) {
        existing.last = m;
      }
      if (
        counts &&
        (!existing.lastForReply ||
          m.created_at > existing.lastForReply.created_at)
      ) {
        existing.lastForReply = m;
      }
    }
  }
  for (const call of calls) {
    const c = call.contact;
    if (!c) continue;
    const key = `${c.type}:${c.id}`;
    const existing = byContact.get(key);
    if (!existing) {
      byContact.set(key, {
        ...c,
        last: null,
        lastForReply: null,
        lastCall: call,
        count: 0,
      });
    } else if (!existing.lastCall || call.at > existing.lastCall.at) {
      existing.lastCall = call;
    }
  }
  // Needs-reply looks at the newest thing that counts — an inbound
  // text, a non-follow-up outbound text, or a call — and lights
  // when it's an unanswered inbound text, a missed call or a
  // voicemail. Same rule as the nav badge's unread endpoint.
  const conversations: SmsConversation[] = [...byContact.values()]
    .map(({ type, id, last, lastForReply, lastCall, count }) => {
      const callAt = lastCall?.at ?? 0;
      const callIsNewest = !!lastCall && (!last || callAt > last.created_at);
      const replyAt = lastForReply?.created_at ?? 0;
      const lastMedia = last ? smsMedia(last) : [];
      const lastAt = callIsNewest ? callAt : (last?.created_at ?? 0);
      const closedAt = closedMap[`${type}:${id}`] ?? 0;
      const closed = closedAt > 0 && closedAt >= lastAt;
      const needsReply =
        !closed &&
        (lastCall && callAt > replyAt
          ? lastCall.needsReply
          : lastForReply?.direction === "inbound");
      return {
        contactType: type,
        contactId: id,
        name: nameFor(type, id),
        phone: last
          ? counterpartyPhone(last)
          : normPhone(lastCall?.counterparty ?? ""),
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
        lastBody:
          callIsNewest && lastCall
            ? lastCall.preview
            : lastMedia.length > 0 && isMediaOnlyBody(last?.body)
              ? mediaPreviewLabel(lastMedia)
              : (last?.body ?? ""),
        lastAt,
        lastDirection:
          callIsNewest && lastCall
            ? lastCall.direction === "outgoing"
              ? "outbound"
              : "inbound"
            : (last?.direction ?? ""),
        lastIsGroup:
          !callIsNewest &&
          typeof last?.template === "string" &&
          last.template.startsWith("group"),
        lastIsCall: callIsNewest,
        lastHasMedia: !callIsNewest && lastMedia.length > 0,
        messageCount: count,
        needsReply,
        closedAt,
        closed,
        searchText: searchFor(type, id),
        enrolledFamilyId: enrolledFamilyFor(type, id),
      };
    })
    .sort((a, b) => b.lastAt - a.lastAt);
  return { conversations, yearId: withStages ? yearId : 0 };
}

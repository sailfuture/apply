import {
  tourLeadScope,
  type LeadNoteSource,
  type XanoAdminNote,
  type XanoCall,
  type XanoInquiry,
  type XanoSmsMessage,
  type XanoSummerCampInquiry,
  type XanoTascoSummerVisit,
  type XanoTour,
  type XanoWebsiteLiabilityWaiver,
} from "@/lib/xano";
import { SCHOOL_TIME_ZONE } from "@/lib/school-calendar";
import type { NurtureSettings, SmsProvider } from "@/lib/app-settings";
import { leadConvertedFamilyId } from "@/lib/lead-conversion";
import * as tpl from "@/lib/nurture/templates";
import { NURTURE_TEMPLATE_PREFIX } from "@/lib/nurture/templates";

/**
 * The follow-up journey for leads, as a PURE function of a data
 * snapshot: given every lead, tour, text and note, which automated
 * texts are due right now — and which qualify but are being held, and
 * why. The cron sends the due ones (`lib/nurture/run.ts`); the admin
 * Follow-ups page shows the same plan, so what staff preview is
 * exactly what the next run does.
 *
 * Steps (all from the texting number, each logged on the lead's
 * thread with a `nurture:` template — the log IS the dedupe record,
 * like the lifecycle triggers):
 *
 *   inquiry_day2   2–4 days after an inquiry, no tour booked
 *   inquiry_day7   7–10 days after, still no tour — the last nudge
 *   tour_reminder  2–30 hours before a scheduled tour
 *   tour_thanks    within 3 days after a tour marked completed
 *   tour_noshow    within 3 days after a tour marked no-show
 *
 * Stop rules: a parent reply ends the inquiry nudges (staff take it
 * from there); a booked tour switches the lead to the tour texts; an
 * application (lead linked to a family) ends the nudges; STOP / "not
 * interested" / archived end everything; a pause note holds
 * everything. Tour reminders ignore replies — they're about a booked
 * appointment, and a canceled tour stops them by itself.
 *
 * Guard rails: texts go out 9 AM–7 PM school time, at most one
 * automated text per lead per 20 hours, and inquiry/post-tour texts
 * only reach leads and tours from after follow-ups were first
 * switched on — turning it on never texts the backlog.
 */

export type NurtureStep =
  | "inquiry_day2"
  | "inquiry_day7"
  | "tour_reminder"
  | "tour_thanks"
  | "tour_noshow";

export { NURTURE_TEMPLATE_PREFIX };

/** Admin-note category for the per-lead pause/resume notes. */
export const AUTOMATION_NOTE_CATEGORY = "automation";
export const PAUSED_NOTE_BODY = "Automated follow-up texts paused.";
export const RESUMED_NOTE_BODY = "Automated follow-up texts resumed.";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Sending hours in school time: 9 AM up to (not including) 7 PM. */
export const SEND_WINDOW = { startHour: 9, endHour: 19 } as const;
/** One automated text per lead per this long. */
export const DAILY_GAP_MS = 20 * HOUR;
/** Staff contact this recent holds the inquiry nudges. */
const RECENT_CONTACT_MS = 3 * DAY;

export const STEP_LABEL: Record<NurtureStep, string> = {
  inquiry_day2: "Day-2 follow-up",
  inquiry_day7: "Day-7 follow-up",
  tour_reminder: "Tour reminder",
  tour_thanks: "Post-tour thank-you",
  tour_noshow: "Missed-tour follow-up",
};

/** The sender the thread shows for each step. */
export const STEP_AUTHOR: Record<NurtureStep, string> = {
  inquiry_day2: "Automated follow-up",
  inquiry_day7: "Automated follow-up",
  tour_reminder: "Automated tour reminder",
  tour_thanks: "Automated tour thank-you",
  tour_noshow: "Automated tour follow-up",
};

/** When a lead qualifies for several texts at once, the most
 *  time-sensitive goes first; the rest wait for tomorrow. */
const PRIORITY: NurtureStep[] = [
  "tour_reminder",
  "tour_noshow",
  "tour_thanks",
  "inquiry_day7",
  "inquiry_day2",
];

export interface NurtureLead {
  source: LeadNoteSource;
  id: number;
  parentFirst: string;
  parentName: string;
  studentFirst: string;
  studentName: string;
  hasPhone: boolean;
  /** Bare 10-digit phone ("" when missing) — the PARENT's identity.
   *  One parent can sit behind several lead records (a duplicate
   *  inquiry, a camp sign-up, an enrolled sibling's family), and the
   *  webhook files their replies under just one of them, so replies,
   *  staff contact and dedupe are all checked per phone too. */
  phoneKey: string;
  createdAt: number;
  /** Lowercased lifecycle status: "", "active", "converted",
   *  "not_interested", "archived". */
  status: string;
  /** Linked applying family (0 = none) — i.e. they've applied. */
  familyId: number;
  lastReachOut: number;
  /** Texting consent on the lead's own form. Only an explicit "no"
   *  blocks tour texts (the same gate `sendSms` applies); inquiry
   *  nudges need an explicit "yes". */
  consent: "yes" | "no" | "unknown";
}

export interface NurtureInput {
  now: number;
  settings: NurtureSettings;
  inquiries: XanoInquiry[];
  camps: XanoSummerCampInquiry[];
  visits: XanoWebsiteLiabilityWaiver[];
  tascos: XanoTascoSummerVisit[];
  tours: XanoTour[];
  messages: XanoSmsMessage[];
  /** Main Line calls — an answered call or a voicemail is contact. */
  calls: XanoCall[];
  notes: XanoAdminNote[];
  /** Which number the texts go out from. "Have we texted them before"
   *  (the opt-out line on a first text) is about that number. */
  provider: SmsProvider;
}

export interface NurtureItem {
  step: NurtureStep;
  lead: NurtureLead;
  /** The `sms_messages.template` it logs under — its dedupe key. */
  template: string;
  body: string;
  tourId: number | null;
  /** "due" goes out on the next run inside sending hours; "held"
   *  qualifies but a rule is holding it (`reason`). */
  state: "due" | "held";
  reason: string | null;
}

export interface NurturePlan {
  inWindow: boolean;
  items: NurtureItem[];
}

export function leadKey(l: { source: LeadNoteSource; id: number }): string {
  return `${l.source}:${l.id}`;
}

/* ─────────────────────────── Snapshot → facts ─────────────────────────── */

/** Names as parents typed them, tidied for a text: "rae" → "Rae",
 *  "MARY-KATE" → "Mary-Kate". Mixed case is deliberate ("McDonald",
 *  "DeAngelo") and left alone. */
export function tidyName(raw: unknown): string {
  const t = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (!t || (t !== t.toLowerCase() && t !== t.toUpperCase())) return t;
  return t
    .toLowerCase()
    .replace(/(^|[\s\-'])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

function firstWord(s: unknown): string {
  return tidyName(String(s ?? "").trim().split(/\s+/)[0] ?? "");
}

function joinName(a: unknown, b: unknown): string {
  return tidyName(`${String(a ?? "").trim()} ${String(b ?? "").trim()}`);
}

/** Bare 10-digit form, or "" — same rule as `normPhone`. */
function phoneKeyOf(raw: unknown): string {
  const d = String(raw ?? "").replace(/\D/g, "");
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  return ten.length === 10 ? ten : "";
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Every lead, keyed `source:id`. */
export function buildLeads(input: NurtureInput): Map<string, NurtureLead> {
  const leads = new Map<string, NurtureLead>();
  const add = (lead: NurtureLead) => leads.set(leadKey(lead), lead);
  const base = (row: {
    id: number;
    created_at: number;
    status?: string | null;
    registration_families_id?: unknown;
    last_reach_out?: number | null;
  }) => ({
    id: row.id,
    createdAt: num(row.created_at),
    status: String(row.status ?? "").trim().toLowerCase(),
    familyId: leadConvertedFamilyId(row),
    lastReachOut: num(row.last_reach_out),
  });

  for (const r of input.inquiries) {
    add({
      ...base(r),
      source: "inquiry",
      parentFirst: tidyName(r.primary_first_name),
      parentName: joinName(r.primary_first_name, r.primary_last_name),
      studentFirst: tidyName(r.student_first_name),
      studentName: joinName(r.student_first_name, r.student_last_name),
      phoneKey: phoneKeyOf(r.primary_phone),
      hasPhone: phoneKeyOf(r.primary_phone) !== "",
      consent:
        r.messaging_opt_in === true
          ? "yes"
          : r.messaging_opt_in === false
            ? "no"
            : "unknown",
    });
  }
  for (const r of input.camps) {
    add({
      ...base(r),
      source: "camp",
      parentFirst: tidyName(r.primary_parent_first_name),
      parentName: joinName(r.primary_parent_first_name, r.primary_parent_last_name),
      studentFirst: tidyName(r.student_first_name),
      studentName: joinName(r.student_first_name, r.student_last_name),
      phoneKey: phoneKeyOf(r.primary_phone),
      hasPhone: phoneKeyOf(r.primary_phone) !== "",
      // No consent column — the camp sign-up is the consent signal.
      consent: "unknown",
    });
  }
  for (const r of input.visits) {
    add({
      ...base(r),
      source: "visit",
      parentFirst: firstWord(r.parent_name),
      parentName: tidyName(r.parent_name),
      studentFirst: firstWord(r.student_name),
      studentName: tidyName(r.student_name),
      phoneKey: phoneKeyOf(r.parent_phone),
      hasPhone: phoneKeyOf(r.parent_phone) !== "",
      // Waiver signers are only textable with the marketing opt-in.
      consent: r.marketing_opt_in === true ? "yes" : "no",
    });
  }
  for (const r of input.tascos) {
    add({
      ...base(r),
      source: "tasco",
      parentFirst: "",
      parentName: "",
      studentFirst: firstWord(r.student_name),
      studentName: tidyName(r.student_name),
      phoneKey: phoneKeyOf(r.parent_phone),
      hasPhone: phoneKeyOf(r.parent_phone) !== "",
      // Rec-center sign-up = implied consent (same as `sendSms`).
      consent: r.marketing_opt_in === true ? "yes" : "unknown",
    });
  }
  return leads;
}

/** What the text log says about one lead (or one parent's phone). */
interface Facts {
  /** Every template ever sent — the dedupe record (failed sends too). */
  templates: Set<string>;
  hasOutbound: boolean;
  lastInboundAt: number;
  /** Newest staff-written text (manual or group). */
  lastStaffTextAt: number;
  lastNurtureAt: number;
  /** Newest call where someone actually talked (answered, either
   *  direction) or the parent left a voicemail. An unanswered call
   *  isn't contact — nobody spoke. */
  lastCallContactAt: number;
}

function emptyFacts(): Facts {
  return {
    templates: new Set(),
    hasOutbound: false,
    lastInboundAt: 0,
    lastStaffTextAt: 0,
    lastNurtureAt: 0,
    lastCallContactAt: 0,
  };
}

function callLeadKey(c: XanoCall): string | null {
  if (num(c.registration_families_id)) return null; // family thread
  if (num(c.registration_inquiry_id)) return `inquiry:${num(c.registration_inquiry_id)}`;
  if (num(c.registration_summer_camp_id)) return `camp:${num(c.registration_summer_camp_id)}`;
  if (num(c.website_liability_waiver_id)) return `visit:${num(c.website_liability_waiver_id)}`;
  if (num(c.tasco_summer_visit_id)) return `tasco:${num(c.tasco_summer_visit_id)}`;
  return null;
}

function addCall(f: Facts, c: XanoCall): void {
  const spoke = num(c.answered_at) > 0 || num(c.duration_seconds) > 0 || Boolean(c.has_voicemail);
  if (!spoke) return;
  f.lastCallContactAt = Math.max(f.lastCallContactAt, num(c.started_at) || num(c.created_at));
}

function addMessage(f: Facts, m: XanoSmsMessage, provider: SmsProvider): void {
  const at = num(m.created_at);
  if (m.direction === "inbound") {
    f.lastInboundAt = Math.max(f.lastInboundAt, at);
    return;
  }
  // "Have we texted them before" is about the number the automated
  // texts come from: a text from the other number doesn't carry this
  // one's opt-out line.
  const rowProvider: SmsProvider = m.provider === "quo" ? "quo" : "twilio";
  if (rowProvider === provider) f.hasOutbound = true;
  const template = m.template ?? "";
  if (template) f.templates.add(template);
  if (template.startsWith(NURTURE_TEMPLATE_PREFIX)) {
    f.lastNurtureAt = Math.max(f.lastNurtureAt, at);
  } else if (
    (!template || template === "manual" || template.startsWith("group")) &&
    // A text that never arrived isn't contact.
    m.status !== "failed" &&
    m.status !== "undelivered"
  ) {
    f.lastStaffTextAt = Math.max(f.lastStaffTextAt, at);
  }
}

function messageLeadKey(m: XanoSmsMessage): string | null {
  if (num(m.registration_families_id)) return null; // family thread
  if (num(m.registration_inquiry_id)) return `inquiry:${num(m.registration_inquiry_id)}`;
  if (num(m.registration_summer_camp_id)) return `camp:${num(m.registration_summer_camp_id)}`;
  if (num(m.website_liability_waiver_id)) return `visit:${num(m.website_liability_waiver_id)}`;
  if (num(m.tasco_summer_visit_id)) return `tasco:${num(m.tasco_summer_visit_id)}`;
  return null;
}

/** Facts per lead thread AND per counterparty phone — every thread,
 *  family and number-only ones included, since a parent's reply is
 *  filed under just one of the records that share their number. */
function buildFacts(
  messages: XanoSmsMessage[],
  calls: XanoCall[],
  provider: SmsProvider
): {
  byLead: Map<string, Facts>;
  byPhone: Map<string, Facts>;
} {
  const byLead = new Map<string, Facts>();
  const byPhone = new Map<string, Facts>();
  const into = (map: Map<string, Facts>, key: string) => {
    let f = map.get(key);
    if (!f) map.set(key, (f = emptyFacts()));
    return f;
  };
  for (const m of messages) {
    const lead = messageLeadKey(m);
    if (lead) addMessage(into(byLead, lead), m, provider);
    const phone = phoneKeyOf(m.direction === "inbound" ? m.from_number : m.to_number);
    if (phone) addMessage(into(byPhone, phone), m, provider);
  }
  for (const c of calls) {
    const lead = callLeadKey(c);
    if (lead) addCall(into(byLead, lead), c);
    const phone = phoneKeyOf(c.counterparty);
    if (phone) addCall(into(byPhone, phone), c);
  }
  return { byLead, byPhone };
}

function mergeFacts(a: Facts | undefined, b: Facts | undefined): Facts {
  const f = emptyFacts();
  for (const x of [a, b]) {
    if (!x) continue;
    for (const t of x.templates) f.templates.add(t);
    f.hasOutbound ||= x.hasOutbound;
    f.lastInboundAt = Math.max(f.lastInboundAt, x.lastInboundAt);
    f.lastStaffTextAt = Math.max(f.lastStaffTextAt, x.lastStaffTextAt);
    f.lastNurtureAt = Math.max(f.lastNurtureAt, x.lastNurtureAt);
    f.lastCallContactAt = Math.max(f.lastCallContactAt, x.lastCallContactAt);
  }
  return f;
}

const NOTE_LEAD_COLUMNS: Array<[LeadNoteSource, keyof XanoAdminNote]> = [
  ["inquiry", "registration_inquiry_id"],
  ["camp", "registration_summer_camp_id"],
  ["visit", "website_liability_waiver_id"],
  ["tasco", "tasco_summer_visit_id"],
];

/** Lead keys whose newest automation note is a pause. */
export function pausedLeadKeys(notes: XanoAdminNote[]): Set<string> {
  const latest = new Map<string, XanoAdminNote>();
  for (const n of notes) {
    if (n.category !== AUTOMATION_NOTE_CATEGORY) continue;
    for (const [source, column] of NOTE_LEAD_COLUMNS) {
      const id = num(n[column]);
      if (!id) continue;
      const key = `${source}:${id}`;
      const prev = latest.get(key);
      if (
        !prev ||
        n.created_at > prev.created_at ||
        (n.created_at === prev.created_at && n.id > prev.id)
      ) {
        latest.set(key, n);
      }
      break;
    }
  }
  const paused = new Set<string>();
  for (const [key, note] of latest) {
    if (/paused/i.test(note.body ?? "")) paused.add(key);
  }
  return paused;
}

function toursByLead(tours: XanoTour[]): Map<string, XanoTour[]> {
  const map = new Map<string, XanoTour[]>();
  for (const t of tours) {
    const scope = tourLeadScope(t);
    if (!scope) continue;
    const key = leadKey(scope);
    map.set(key, [...(map.get(key) ?? []), t]);
  }
  return map;
}

/** Hour of day (0–23) in school time. */
export function schoolHour(ms: number): number {
  const h = new Intl.DateTimeFormat("en-US", {
    timeZone: SCHOOL_TIME_ZONE,
    hour: "numeric",
    hourCycle: "h23",
  }).format(new Date(ms));
  return Number(h) % 24;
}

export function inSendWindow(ms: number): boolean {
  const h = schoolHour(ms);
  return h >= SEND_WINDOW.startHour && h < SEND_WINDOW.endHour;
}

/* ─────────────────────────────── The plan ─────────────────────────────── */

interface Candidate {
  step: NurtureStep;
  template: string;
  body: string;
  tourId: number | null;
  /** A reason this specific text is being held (null = ready). */
  hold: string | null;
}

function isStopped(lead: NurtureLead): boolean {
  return lead.status === "not_interested" || lead.status === "archived";
}

function hasApplied(lead: NurtureLead): boolean {
  return lead.familyId > 0 || lead.status === "converted";
}

function candidatesFor(
  lead: NurtureLead,
  facts: Facts,
  tours: XanoTour[],
  input: NurtureInput
): Candidate[] {
  const out: Candidate[] = [];
  if (!lead.hasPhone || isStopped(lead)) return out;
  const { now, settings } = input;
  // Before the first switch-on, preview as if switching on right now.
  const startedAt = settings.startedAt ?? now;
  const sent = (template: string) => facts.templates.has(template);
  const names = { parentFirst: lead.parentFirst, studentFirst: lead.studentFirst };

  // ── Inquiry nudges ──────────────────────────────────────────────────
  if (
    lead.source === "inquiry" &&
    lead.consent === "yes" &&
    lead.createdAt >= startedAt &&
    !hasApplied(lead) &&
    tours.length === 0 &&
    facts.lastInboundAt < lead.createdAt &&
    // …and nobody has spoken with them by phone since, either.
    facts.lastCallContactAt < lead.createdAt
  ) {
    const age = now - lead.createdAt;
    const lastContact = Math.max(lead.lastReachOut, facts.lastStaffTextAt);
    const hold =
      lastContact >= now - RECENT_CONTACT_MS
        ? "Staff reached out in the last 3 days"
        : null;
    if (age >= 2 * DAY && age < 4 * DAY && !sent("nurture:inquiry_day2")) {
      out.push({
        step: "inquiry_day2",
        template: "nurture:inquiry_day2",
        body: tpl.inquiryDay2Sms({ ...names, senderName: settings.senderName }),
        tourId: null,
        hold,
      });
    }
    if (age >= 7 * DAY && age < 10 * DAY && !sent("nurture:inquiry_day7")) {
      out.push({
        step: "inquiry_day7",
        template: "nurture:inquiry_day7",
        body: tpl.inquiryDay7Sms(names),
        tourId: null,
        hold,
      });
    }
  }

  // ── Tour texts ──────────────────────────────────────────────────────
  // Keyed by the tour's TIME SLOT, not its row id: two rows for one
  // booking (a sync race) still make one text, and a rescheduled tour
  // gets a fresh reminder for its new slot.
  if (lead.consent !== "no") {
    for (const tour of tours) {
      const at = num(tour.scheduled_at);
      if (!at) continue;
      if (tour.status === "scheduled" && tour.rsvp_status !== "declined") {
        const until = at - now;
        const template = `nurture:tour_reminder:${at}`;
        if (until >= 2 * HOUR && until <= 30 * HOUR && !sent(template)) {
          out.push({
            step: "tour_reminder",
            template,
            body: tpl.tourReminderSms({ ...names, scheduledAt: at }),
            tourId: tour.id,
            hold: null,
          });
        }
      }
      const since = now - at;
      const recentPast = since >= 0 && since <= 3 * DAY && at >= startedAt;
      if (!recentPast || hasApplied(lead)) continue;
      if (tour.status === "completed") {
        const template = `nurture:tour_thanks:${at}`;
        if (!sent(template)) {
          out.push({
            step: "tour_thanks",
            template,
            body: tpl.tourThanksSms(names),
            tourId: tour.id,
            hold: null,
          });
        }
      } else if (tour.status === "no_show") {
        const template = `nurture:tour_noshow:${at}`;
        const rebooked = tours.some(
          (t) =>
            t.id !== tour.id &&
            num(t.scheduled_at) > at &&
            (t.status === "scheduled" || t.status === "completed")
        );
        const replied = facts.lastInboundAt >= at;
        if (!sent(template) && !rebooked && !replied) {
          out.push({
            step: "tour_noshow",
            template,
            body: tpl.tourNoShowSms(names),
            tourId: tour.id,
            hold: null,
          });
        }
      }
    }
  }

  // The first text a parent ever gets from us carries the opt-out line.
  if (!facts.hasOutbound) {
    for (const c of out) {
      if (!c.body.includes(tpl.OPT_OUT_LINE)) c.body += `\n${tpl.OPT_OUT_LINE}`;
    }
  }
  // Two rows for one slot (a duplicated tour) make one candidate.
  const unique = new Map(out.map((c) => [c.template, c]));
  return [...unique.values()].sort(
    (a, b) => PRIORITY.indexOf(a.step) - PRIORITY.indexOf(b.step)
  );
}

export function planNurture(input: NurtureInput): NurturePlan {
  const leads = buildLeads(input);
  const { byLead, byPhone } = buildFacts(input.messages, input.calls, input.provider);
  const paused = pausedLeadKeys(input.notes);
  const tours = toursByLead(input.tours);
  const items: NurtureItem[] = [];
  const pending: Array<{
    key: string;
    lead: NurtureLead;
    facts: Facts;
    candidates: Candidate[];
  }> = [];

  for (const [key, lead] of leads) {
    const facts = mergeFacts(byLead.get(key), byPhone.get(lead.phoneKey));
    const candidates = candidatesFor(lead, facts, tours.get(key) ?? [], input);
    if (candidates.length) pending.push({ key, lead, facts, candidates });
  }
  // Most time-sensitive first, so when two records share a phone the
  // one allowed through this run is the one that can't wait.
  pending.sort(
    (a, b) =>
      PRIORITY.indexOf(a.candidates[0].step) -
        PRIORITY.indexOf(b.candidates[0].step) ||
      b.lead.createdAt - a.lead.createdAt
  );

  // One automated text per PARENT per run: several lead records can
  // share one number, and each would otherwise send its own.
  const duePhones = new Set<string>();
  for (const { key, lead, facts, candidates } of pending) {
    for (const c of candidates) {
      let reason: string | null = null;
      if (paused.has(key)) {
        reason = "Paused for this lead";
      } else if (
        // Reminders are exempt from the daily gap: they're once per
        // slot anyway, and a gap-held reminder can run past its window
        // (a tour booked the morning after a day-2 text).
        c.step !== "tour_reminder" &&
        facts.lastNurtureAt >= input.now - DAILY_GAP_MS
      ) {
        reason = "Already got an automated text today";
      } else if (c.hold) {
        reason = c.hold;
      } else if (duePhones.has(lead.phoneKey)) {
        reason = "One automated text a day - goes out later";
      }
      if (!reason) duePhones.add(lead.phoneKey);
      items.push({
        step: c.step,
        lead,
        template: c.template,
        body: c.body,
        tourId: c.tourId,
        state: reason ? "held" : "due",
        reason,
      });
    }
  }

  items.sort(
    (a, b) =>
      (a.state === b.state ? 0 : a.state === "due" ? -1 : 1) ||
      PRIORITY.indexOf(a.step) - PRIORITY.indexOf(b.step) ||
      b.lead.createdAt - a.lead.createdAt
  );
  return { inWindow: inSendWindow(input.now), items };
}

/** A log row standing in for a text the projection assumes was sent. */
function simulatedSend(item: NurtureItem, at: number): XanoSmsMessage {
  const fk =
    item.lead.source === "inquiry"
      ? { registration_inquiry_id: item.lead.id }
      : item.lead.source === "camp"
        ? { registration_summer_camp_id: item.lead.id }
        : item.lead.source === "visit"
          ? { website_liability_waiver_id: item.lead.id }
          : { tasco_summer_visit_id: item.lead.id };
  return {
    id: -at,
    created_at: at,
    registration_families_id: null,
    ...fk,
    direction: "outbound",
    to_number: item.lead.phoneKey ? `+1${item.lead.phoneKey}` : "",
    from_number: "",
    body: item.body,
    status: "delivered",
    template: item.template,
  };
}

/**
 * When each not-yet-due text will come due over the next `hours`,
 * assuming nothing else changes — an estimate for the admin preview
 * (a reply or a booking in the meantime can still cancel one).
 * Re-runs the plan at each half-hour tick in sending hours, treating
 * every text it projects (and everything due now) as sent, so held
 * texts surface when their hold lifts and the daily gap is honored.
 */
export function projectUpcoming(
  input: NurtureInput,
  hours = 48
): Array<{ item: NurtureItem; at: number }> {
  const simulated: XanoSmsMessage[] = [];
  const seen = new Set<string>();
  for (const item of planNurture(input).items) {
    if (item.state !== "due") continue;
    seen.add(`${leadKey(item.lead)}|${item.template}`);
    simulated.push(simulatedSend(item, input.now));
  }
  const upcoming: Array<{ item: NurtureItem; at: number }> = [];
  // Half-hour ticks, matching the cron cadence.
  const start = Math.ceil(input.now / (HOUR / 2)) * (HOUR / 2);
  for (let t = start; t <= input.now + hours * HOUR; t += HOUR / 2) {
    if (!inSendWindow(t)) continue;
    const plan = planNurture({
      ...input,
      now: t,
      messages: [...input.messages, ...simulated],
    });
    for (const item of plan.items) {
      const key = `${leadKey(item.lead)}|${item.template}`;
      if (item.state !== "due" || seen.has(key)) continue;
      seen.add(key);
      upcoming.push({ item, at: t });
      simulated.push(simulatedSend(item, t));
    }
  }
  return upcoming;
}

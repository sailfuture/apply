/**
 * Recruitment events, and which one a lead or applicant came from.
 *
 * The events themselves are NOT stored in Apply: they all live in the
 * recruitment app (recruitment.sailfutureacademy.org, repo
 * sfa-recruitment-events), which serves them at `/api/apply/events`
 * to callers holding the registration API key. Apply only stores the
 * link, in Xano `registration_lead_events` — one row per lead, with a
 * title/date snapshot so the link still reads if the event later
 * leaves the feed.
 *
 * Replaced the Recruitment → Events tracker (2026-11-24); its old
 * table `registration_recruitment_events` was left in Xano, unused.
 */

/** Who a link belongs to: one of the four lead sources, or a family
 *  (an applicant), keyed by family id. */
export type LeadEventSource = "inquiry" | "camp" | "visit" | "tasco" | "family";

export const LEAD_EVENT_SOURCES: readonly LeadEventSource[] = [
  "inquiry",
  "camp",
  "visit",
  "tasco",
  "family",
];

export function isLeadEventSource(v: unknown): v is LeadEventSource {
  return LEAD_EVENT_SOURCES.includes(v as LeadEventSource);
}

/** A `registration_lead_events` row. */
export interface LeadEventLink {
  id: number;
  created_at: number;
  lead_source: LeadEventSource;
  lead_id: number;
  event_id: string;
  event_title: string;
  event_date: string;
  linked_by: string;
}

export type LeadEventLinkInput = Omit<LeadEventLink, "id" | "created_at">;

/** One event as the recruitment app's feed sends it. */
export interface RecruitmentEvent {
  id: string;
  /** "event" = researched, dated; "yearly" = annual entry (date may be
   *  an estimate); "added" = added by staff in the recruitment app. */
  kind: "event" | "yearly" | "added";
  title: string;
  /** YYYY-MM-DD, or null when unannounced. */
  date: string | null;
  estimated: boolean;
  venue: string | null;
  hosts: string | null;
  zip: string | null;
  /** new | planned | going | skip */
  status: string;
  attended: boolean;
}

export const RECRUITMENT_APP_URL = (
  process.env.RECRUITMENT_APP_URL?.trim() ||
  "https://recruitment.sailfutureacademy.org"
).replace(/\/$/, "");

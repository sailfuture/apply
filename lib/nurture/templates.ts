import { SCHOOL_TIME_ZONE } from "@/lib/school-calendar";

/**
 * Wording for the automated follow-up texts (`lib/nurture/plan.ts`).
 * Plain GSM-7 characters only — a single em dash or curly quote
 * switches a text to UCS-2 and roughly doubles its segment count.
 * Links sit at the end of a line so a trailing period can't break
 * them in the parent's messaging app.
 */

/** Every follow-up text logs under a `nurture:<step>…` template. */
export const NURTURE_TEMPLATE_PREFIX = "nurture:";

/** An automated follow-up text — never an answer to a parent, so the
 *  inbox's "needs a reply" and unread logic look past it. */
export function isFollowUpTemplate(template: string | null | undefined): boolean {
  return typeof template === "string" && template.startsWith(NURTURE_TEMPLATE_PREFIX);
}

export const TOUR_BOOKING_URL = "https://sailfutureacademy.org/tour";
const CAMPUS = "2154 27th Ave N, St. Petersburg";
export const OPT_OUT_LINE = "Reply STOP to opt out.";

function applyUrl(): string {
  const base = (
    process.env.NEXT_PUBLIC_APP_URL ?? "https://apply.sailfutureacademy.org"
  ).replace(/\/$/, "");
  return `${base}/sign-up`;
}

function hi(parentFirst: string): string {
  return parentFirst ? `Hi ${parentFirst}` : "Hi there";
}

/** "Tue, Sep 30 at 10:00 AM" in school time. No "tomorrow": the
 *  reminder may go out the same morning, and a date can't be wrong. */
export function tourWhen(ms: number): string {
  const d = new Date(ms);
  const day = d.toLocaleDateString("en-US", {
    timeZone: SCHOOL_TIME_ZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const time = d.toLocaleTimeString("en-US", {
    timeZone: SCHOOL_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  });
  return `${day} at ${time}`;
}

export interface TemplateNames {
  parentFirst: string;
  studentFirst: string;
}

/** Day 2 after the inquiry, no tour booked yet. Signed by a person
 *  when a sender name is set, otherwise by the admissions team. */
export function inquiryDay2Sms(
  n: TemplateNames & { senderName: string }
): string {
  const who = n.senderName
    ? `it's ${n.senderName} from SailFuture Academy`
    : "this is the SailFuture Academy admissions team";
  const we = n.senderName ? "I" : "we";
  const about = n.studentFirst
    ? `about SailFuture for ${n.studentFirst}`
    : "about SailFuture";
  return `${hi(n.parentFirst)}, ${who}. Do you have any questions ${we} can answer ${about}? The best next step is a campus tour - pick a time here: ${TOUR_BOOKING_URL}\n${OPT_OUT_LINE}`;
}

/** Day 7, still no tour — the last automated nudge. */
export function inquiryDay7Sms(n: TemplateNames): string {
  const who = n.studentFirst || "your student";
  return `${hi(n.parentFirst)}, just checking in from SailFuture Academy. If a campus tour would help ${who} decide, you can pick a time here: ${TOUR_BOOKING_URL}\nOr reply here with any questions.`;
}

/** The day before a booked tour (or that morning, for a late booking). */
export function tourReminderSms(
  n: TemplateNames & { scheduledAt: number }
): string {
  const whose = n.studentFirst ? `${n.studentFirst}'s` : "your";
  return `Reminder: ${whose} campus tour at SailFuture Academy is ${tourWhen(n.scheduledAt)}, ${CAMPUS}. Please park near the north entrance by the overpass. Reply here if you need to reschedule.`;
}

/** After staff mark a tour completed — the nudge to apply. */
export function tourThanksSms(n: TemplateNames): string {
  const name = n.parentFirst ? `, ${n.parentFirst}` : "";
  const forWho = n.studentFirst ? ` for ${n.studentFirst}` : "";
  return `Thanks for visiting SailFuture Academy${name}! When you're ready to apply${forWho}, start here: ${applyUrl()}\nReply with any questions - we're happy to help.`;
}

/** After staff mark a tour as a no-show. */
export function tourNoShowSms(n: TemplateNames): string {
  return `${hi(n.parentFirst)}, we missed you at your SailFuture Academy tour - no problem! You can pick a new time here: ${TOUR_BOOKING_URL}\nOr reply and we'll find a time that works.`;
}

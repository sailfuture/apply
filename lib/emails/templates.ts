/**
 * SailFuture Academy transactional email templates.
 *
 * Each template exports a function that takes a typed context object
 * and returns `{ subject, html, text }`. Templates own their HTML +
 * plain-text bodies so the per-message copy stays close to the
 * subject line. Shared chrome (header, button, footer) is rendered by
 * the `layout()` helper so visual changes (logo, color, sign-off)
 * only need to land in one place.
 *
 * All templates accept the same envelope props:
 *   - parent_first_name   — primary parent's first name
 *   - student_first_name  — joined student first names ("Sam", "Sam
 *                           and Jane", "Sam, Jane, and Jack") for
 *                           family-level events; the specific
 *                           student's first name for per-application
 *                           events (Email 8).
 *   - login_url           — landing URL that routes the parent into
 *                           the right step of their family portal.
 *
 * Returned bodies are static once produced — no streaming, no
 * placeholders left unfilled. Callers can feed them directly to the
 * Resend `send` API.
 */

import { formatDob } from "@/lib/dob";

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

export interface BaseContext {
  parent_first_name: string;
  student_first_name: string;
  login_url: string;
}

/** Phone + emails surfaced in every footer. Centralized so we touch
 *  one constant if the line / inbox ever changes. */
const SUPPORT_EMAIL = "admissions@sailfuture.org";
const SUPPORT_PHONE = "727-902-7641";
const TEAM_SIGNATURE = "The SailFuture Academy admissions team";
/** Absolute logo URL for email chrome. Must be absolute — email
 *  clients don't resolve relative paths against the original sender
 *  domain. Falls back to the production host so transactional sends
 *  out of a preview deployment still render the brand mark. */
const LOGO_URL = `${process.env.NEXT_PUBLIC_APP_URL ?? "https://apply.sailfutureacademy.org"}/logo.jpg`;

/* ────────────────────────── HTML layout helpers ────────────────────────── */

/** Shared email chrome. Plain inline-styled HTML — table-based for
 *  legacy client compat (Outlook, older Gmail). One column, max 560px,
 *  generous line-height. */
function layout({
  preheader,
  body,
  buttonHref,
  buttonLabel,
}: {
  preheader: string;
  body: string;
  buttonHref?: string;
  buttonLabel?: string;
}): string {
  const button = buttonHref && buttonLabel
    ? `<div style="text-align:center;margin:32px 0;">
        <a href="${escapeAttr(buttonHref)}"
           style="display:inline-block;background:#0F2A4A;color:#ffffff;
                  padding:14px 28px;border-radius:6px;text-decoration:none;
                  font-weight:600;font-size:16px;">
          ${escapeHtml(buttonLabel)}
        </a>
      </div>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>SailFuture Academy</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#111827;">
  <div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;color:transparent;">${escapeHtml(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,0.04);">
          <tr>
            <td align="center" style="background:#0F2A4A;padding:32px 32px 28px;">
              <img src="${LOGO_URL}" alt="SailFuture Academy" width="72" height="72" style="display:block;width:72px;height:72px;border-radius:50%;border:2px solid #ffffff;outline:none;text-decoration:none;">
            </td>
          </tr>
          <tr>
            <td style="padding:24px 32px 8px;font-size:16px;line-height:1.6;">
              ${body}
              ${button}
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px 28px;font-size:14px;color:#4b5563;border-top:1px solid #e5e7eb;line-height:1.6;">
              Questions? Email
              <a href="mailto:${SUPPORT_EMAIL}" style="color:#0F2A4A;">${SUPPORT_EMAIL}</a>
              or call <a href="tel:${SUPPORT_PHONE.replace(/-/g, "")}" style="color:#0F2A4A;">${SUPPORT_PHONE}</a>.
            </td>
          </tr>
        </table>
        <div style="font-size:12px;color:#9ca3af;margin-top:16px;">
          SailFuture Academy · St. Petersburg, FL
        </div>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function p(text: string): string {
  return `<p style="margin:0 0 14px;">${escapeHtml(text)}</p>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, "&quot;");
}

/* ─────────────────────────────── Email 1 ─────────────────────────────── */
/* Application received (parent submitted). */

export function applicationReceived(ctx: BaseContext): EmailContent {
  const subject = "We received your SailFuture Academy application";
  const preheader = `Thanks for applying — ${ctx.student_first_name}'s application is under review.`;
  const html = layout({
    preheader,
    body:
      p(`Hi ${ctx.parent_first_name},`) +
      p(
        `Thanks for applying to SailFuture Academy. We've received ${ctx.student_first_name}'s application and it's now under review by our admissions team.`
      ) +
      p(
        `You'll hear from us within a few business days with next steps. In the meantime, you can check your application status anytime by logging into your family portal.`
      ) +
      p(TEAM_SIGNATURE),
    buttonHref: ctx.login_url,
    buttonLabel: "Log in to your account",
  });
  const text = [
    `Hi ${ctx.parent_first_name},`,
    "",
    `Thanks for applying to SailFuture Academy. We've received ${ctx.student_first_name}'s application and it's now under review by our admissions team.`,
    "",
    `You'll hear from us within a few business days with next steps. In the meantime, you can check your application status anytime by logging into your family portal.`,
    "",
    `Log in: ${ctx.login_url}`,
    "",
    `Questions in the meantime? Email ${SUPPORT_EMAIL} or call ${SUPPORT_PHONE}.`,
    "",
    TEAM_SIGNATURE,
  ].join("\n");
  return { subject, html, text };
}

/* ─────────────────────────────── Email 2 ─────────────────────────────── */
/* Accepted — sign enrollment agreement. */

export function accepted(ctx: BaseContext): EmailContent {
  // `student_first_name` may be a single name ("Hunter") or a
  // joined list ("Hunter and Tom") for families with multiple
  // accepted students. Verb agreement on "X has/have been
  // accepted" needs a count — instead of branching, we phrase
  // around the agreement issue entirely: "we'd like to welcome X
  // to SailFuture Academy" reads naturally for both singular and
  // plural names ("welcome Hunter" / "welcome Hunter and Tom").
  const subject = `Welcome to SailFuture Academy`;
  const preheader = `Sign the enrollment agreement to reserve your spot for the 2026/2027 school year.`;
  const html = layout({
    preheader,
    body:
      p(`Congratulations ${ctx.parent_first_name},`) +
      p(
        `We'd like to welcome ${ctx.student_first_name} to SailFuture Academy for the 2026/2027 school year.`
      ) +
      p(
        `To reserve your spot, sign the enrollment agreement and complete the registration paperwork inside your family portal. Spots are limited and assigned in the order families complete enrollment, so we recommend signing as soon as you can.`
      ) +
      p(
        `If you have questions about acceptance or what comes next, email ${SUPPORT_EMAIL} or call ${SUPPORT_PHONE}.`
      ) +
      p(`Welcome to the SailFuture family,`) +
      p(`The admissions team`),
    buttonHref: ctx.login_url,
    buttonLabel: "Sign enrollment agreement",
  });
  const text = [
    `Congratulations ${ctx.parent_first_name},`,
    "",
    `We'd like to welcome ${ctx.student_first_name} to SailFuture Academy for the 2026/2027 school year.`,
    "",
    `To reserve your spot, sign the enrollment agreement and complete the registration paperwork inside your family portal. Spots are limited and assigned in the order families complete enrollment, so we recommend signing as soon as you can.`,
    "",
    `Sign enrollment agreement: ${ctx.login_url}`,
    "",
    `If you have questions about acceptance or what comes next, email ${SUPPORT_EMAIL} or call ${SUPPORT_PHONE}.`,
    "",
    `Welcome to the SailFuture family,`,
    `The admissions team`,
  ].join("\n");
  return { subject, html, text };
}

/* ─────────────────────────────── Email 3 ─────────────────────────────── */
/* Registration submitted (parent finished the post-acceptance packet). */

export function registrationReceived(ctx: BaseContext): EmailContent {
  const subject = `We received ${ctx.student_first_name}'s registration`;
  const preheader = `Your registration paperwork is in — we'll review and follow up.`;
  const html = layout({
    preheader,
    body:
      p(`Hi ${ctx.parent_first_name},`) +
      p(
        `Your registration paperwork for ${ctx.student_first_name} is in. Our team will review everything and reach out if we need anything else from you.`
      ) +
      p(
        `You'll get a final confirmation email once registration is approved and ${ctx.student_first_name} is officially enrolled for the 2026/2027 school year.`
      ) +
      p(TEAM_SIGNATURE),
    buttonHref: ctx.login_url,
    buttonLabel: "View registration status",
  });
  const text = [
    `Hi ${ctx.parent_first_name},`,
    "",
    `Your registration paperwork for ${ctx.student_first_name} is in. Our team will review everything and reach out if we need anything else from you.`,
    "",
    `You'll get a final confirmation email once registration is approved and ${ctx.student_first_name} is officially enrolled for the 2026/2027 school year.`,
    "",
    `View registration status: ${ctx.login_url}`,
    "",
    `Questions? Email ${SUPPORT_EMAIL} or call ${SUPPORT_PHONE}.`,
    "",
    TEAM_SIGNATURE,
  ].join("\n");
  return { subject, html, text };
}

/* ─────────────────────────────── Email 4 ─────────────────────────────── */
/* Officially enrolled (admin confirmed the registration). */

export function enrolled(ctx: BaseContext): EmailContent {
  const subject = `${ctx.student_first_name} is officially enrolled for 2026/2027`;
  const preheader = `Welcome aboard — here's what to know before August 24th.`;
  const html = layout({
    preheader,
    body:
      p(`Hi ${ctx.parent_first_name},`) +
      p(
        `It's official. ${ctx.student_first_name} is enrolled at SailFuture Academy for the 2026/2027 school year. We can't wait to get started.`
      ) +
      p(
        `A couple of things to know as you plan ahead. Monthly tuition invoices will begin on the 1st of each month and can be viewed and paid through your family portal. The first day of school is Monday, August 24th, 2026. We'll send a back to school packet later this summer with the full calendar and first day logistics.`
      ) +
      p(
        `For anything else between now and August, email ${SUPPORT_EMAIL} or call ${SUPPORT_PHONE}.`
      ) +
      p(`Welcome aboard,`) +
      p(`The SailFuture Academy team`),
    buttonHref: ctx.login_url,
    buttonLabel: "View your account",
  });
  const text = [
    `Hi ${ctx.parent_first_name},`,
    "",
    `It's official. ${ctx.student_first_name} is enrolled at SailFuture Academy for the 2026/2027 school year. We can't wait to get started.`,
    "",
    `A couple of things to know as you plan ahead. Monthly tuition invoices will begin on the 1st of each month and can be viewed and paid through your family portal. The first day of school is Monday, August 24th, 2026. We'll send a back to school packet later this summer with the full calendar and first day logistics.`,
    "",
    `View your account: ${ctx.login_url}`,
    "",
    `For anything else between now and August, email ${SUPPORT_EMAIL} or call ${SUPPORT_PHONE}.`,
    "",
    `Welcome aboard,`,
    `The SailFuture Academy team`,
  ].join("\n");
  return { subject, html, text };
}

/* ─────────────────────────────── Email 5 ─────────────────────────────── */
/* Application started but not submitted (sent 3-5 days after starting). */

export function draftReminder(ctx: BaseContext): EmailContent {
  const subject = "Finish your SailFuture Academy application";
  const preheader = `${ctx.student_first_name}'s application is waiting — about 10 minutes to finish.`;
  const html = layout({
    preheader,
    body:
      p(`Hi ${ctx.parent_first_name},`) +
      p(
        `You started an application for ${ctx.student_first_name} a few days ago but haven't submitted it yet. We don't want you to miss out, so we wanted to make sure you know it's still waiting for you in your portal.`
      ) +
      p(`It only takes about 10 minutes to wrap up the remaining sections.`) +
      p(
        `If you ran into a question you couldn't answer or hit a roadblock, email ${SUPPORT_EMAIL} or call ${SUPPORT_PHONE}. We're happy to walk you through it.`
      ) +
      p(TEAM_SIGNATURE),
    buttonHref: ctx.login_url,
    buttonLabel: "Finish your application",
  });
  const text = [
    `Hi ${ctx.parent_first_name},`,
    "",
    `You started an application for ${ctx.student_first_name} a few days ago but haven't submitted it yet. We don't want you to miss out, so we wanted to make sure you know it's still waiting for you in your portal.`,
    "",
    `It only takes about 10 minutes to wrap up the remaining sections.`,
    "",
    `Finish your application: ${ctx.login_url}`,
    "",
    `If you ran into a question you couldn't answer or hit a roadblock, email ${SUPPORT_EMAIL} or call ${SUPPORT_PHONE}. We're happy to walk you through it.`,
    "",
    TEAM_SIGNATURE,
  ].join("\n");
  return { subject, html, text };
}

/* ─────────────────────────────── Email 6 ─────────────────────────────── */
/* Enrollment agreement reminder (sent 5 days after acceptance if unsigned). */

export function enrollmentAgreementReminder(ctx: BaseContext): EmailContent {
  const subject = "Reminder, your spot at SailFuture Academy is waiting";
  const preheader = `Sign the enrollment agreement to reserve ${ctx.student_first_name}'s spot.`;
  const html = layout({
    preheader,
    body:
      p(`Hi ${ctx.parent_first_name},`) +
      p(
        `We're following up on ${ctx.student_first_name}'s acceptance to SailFuture Academy. The enrollment agreement still needs to be signed to officially reserve their spot for the 2026/2027 school year.`
      ) +
      p(
        `Spots are assigned in the order families complete enrollment, and we'd hate for you to lose yours. Please sign as soon as you can.`
      ) +
      p(
        `If you have hesitations or questions about anything in the agreement, reach out. We'd rather talk it through than have you miss the window. Email ${SUPPORT_EMAIL} or call ${SUPPORT_PHONE}.`
      ) +
      p(TEAM_SIGNATURE),
    buttonHref: ctx.login_url,
    buttonLabel: "Sign enrollment agreement",
  });
  const text = [
    `Hi ${ctx.parent_first_name},`,
    "",
    `We're following up on ${ctx.student_first_name}'s acceptance to SailFuture Academy. The enrollment agreement still needs to be signed to officially reserve their spot for the 2026/2027 school year.`,
    "",
    `Spots are assigned in the order families complete enrollment, and we'd hate for you to lose yours. Please sign as soon as you can.`,
    "",
    `Sign enrollment agreement: ${ctx.login_url}`,
    "",
    `If you have hesitations or questions about anything in the agreement, reach out. We'd rather talk it through than have you miss the window. Email ${SUPPORT_EMAIL} or call ${SUPPORT_PHONE}.`,
    "",
    TEAM_SIGNATURE,
  ].join("\n");
  return { subject, html, text };
}

/* ─────────────────────────────── Email 11 ─────────────────────────────── */
/* Back-to-school welcome (sent 1-2 weeks before August 24th). */

export function backToSchool(ctx: BaseContext): EmailContent {
  const subject = `Back to school info for ${ctx.student_first_name}`;
  const preheader = `School starts Monday, August 24th, 2026 — here's what to know.`;
  const html = layout({
    preheader,
    body:
      p(`Hi ${ctx.parent_first_name},`) +
      p(
        `School starts Monday, August 24th, 2026, and we're getting ready to welcome ${ctx.student_first_name} to campus. Here's what you need to know to start the year strong.`
      ) +
      p(
        `Full first day logistics, the academic calendar, drop-off and pick-up details, and uniform expectations are all in your family portal. Please take a few minutes to review everything before the first day so ${ctx.student_first_name} arrives ready.`
      ) +
      p(
        `There's no supply list to shop for. We provide all school supplies, so ${ctx.student_first_name} just needs to show up.`
      ) +
      p(
        `Questions before August 24th? Email ${SUPPORT_EMAIL} or call ${SUPPORT_PHONE}.`
      ) +
      p(`See you soon,`) +
      p(`The SailFuture Academy team`),
    buttonHref: ctx.login_url,
    buttonLabel: "View first day info",
  });
  const text = [
    `Hi ${ctx.parent_first_name},`,
    "",
    `School starts Monday, August 24th, 2026, and we're getting ready to welcome ${ctx.student_first_name} to campus. Here's what you need to know to start the year strong.`,
    "",
    `Full first day logistics, the academic calendar, drop-off and pick-up details, and uniform expectations are all in your family portal. Please take a few minutes to review everything before the first day so ${ctx.student_first_name} arrives ready.`,
    "",
    `There's no supply list to shop for. We provide all school supplies, so ${ctx.student_first_name} just needs to show up.`,
    "",
    `View first day info: ${ctx.login_url}`,
    "",
    `Questions before August 24th? Email ${SUPPORT_EMAIL} or call ${SUPPORT_PHONE}.`,
    "",
    `See you soon,`,
    `The SailFuture Academy team`,
  ].join("\n");
  return { subject, html, text };
}

/* ───────────────────── Inbound SMS notification ───────────────────── */
/* Staff-facing: a family texted our number. Sent by the Twilio inbound
 * webhook to the admissions inbox (dean@ CC'd via the default CC list)
 * with the sender resolved to a parent + family + student(s) so staff
 * know who's texting without a phone-number lookup. Replaces the
 * unattributed number-only email the Twilio-side forwarder produced. */

export interface SmsReplyReceivedContext {
  /** Full parent name ("Steven Petros"), or null when the sender's
   *  number didn't match any contact on file. */
  parent_name: string | null;
  /** Family display name ("Petros Family"), null when the sender is
   *  an inquiry/camp contact or unattributed. */
  family_name: string | null;
  /** Joined full names of the family's (non-archived) students —
   *  "Steven Petros III" / "Steven Petros III and Jane Petros" — or
   *  the inquiry/camp row's student. Null when unattributed. */
  student_names: string | null;
  /** Which record type the number matched: an applying/enrolled
   *  family, a prospective-family inquiry, or a summer-camp parent.
   *  Null when unattributed. */
  contact_type:
    | "family"
    | "inquiry"
    | "camp"
    | "visit"
    | "tasco"
    | "adhoc"
    | null;
  /** Sender's number as Twilio delivered it (E.164). */
  from_number: string;
  /** The text they sent, verbatim. */
  message_body: string;
  /** Twilio message SID for console lookups. */
  message_sid: string | null;
  /** Deep link to the admin two-way inbox. */
  inbox_url: string;
  /** True when the message was a STOP-family opt-out keyword. */
  opted_out: boolean;
}

const CONTACT_TYPE_LABEL: Record<string, string> = {
  family: "Family",
  inquiry: "Inquiry",
  camp: "Summer camp",
  visit: "Liability waiver visit",
  tasco: "TASCO summer visit",
  adhoc: "Unmatched number",
};

/**
 * The office Main Line texted STOP (or START) to the school's texting
 * number — almost always someone answering a forwarded parent text in
 * Quo. Twilio then blocks (or restores) every text from the texting
 * number to the Main Line, which silently stops the parent-reply
 * copies, so staff hear about it right away.
 */
export function mainLineTextingChanged(ctx: {
  blocked: boolean;
  appUrl: string;
}): EmailContent {
  const subject = ctx.blocked
    ? "Parent reply copies to the Main Line are blocked"
    : "Parent reply copies to the Main Line are back on";
  const lines = ctx.blocked
    ? [
        "The Main Line, (727) 209-7846, just texted STOP to the school texting number, (727) 604-8321. Twilio now blocks every text from the texting number to the Main Line, so copies of parents' replies will stop arriving in Quo.",
        "To turn them back on, text START from the Main Line (in Quo) to (727) 604-8321.",
        "Parents' replies still land in Apply's messages inbox either way.",
      ]
    : [
        "The Main Line texted START to (727) 604-8321, so copies of parents' replies will arrive in Quo again.",
      ];
  const html = layout({
    preheader: lines[0].slice(0, 120),
    body:
      `<h2 style="margin:0 0 16px;font-size:18px;">${escapeHtml(subject)}</h2>` +
      lines.map((l) => p(l)).join(""),
    buttonHref: `${ctx.appUrl}/admin/follow-ups`,
    buttonLabel: "Open Follow-ups",
  });
  return { subject, html, text: [subject, "", ...lines].join("\n") };
}

/**
 * Carriers are filtering the texts Apply sends from the Main Line
 * (code 30007 on most of the recent sends) — see
 * lib/sms/delivery-alert.ts. One email per episode, to staff.
 */
export function smsDeliveryFiltered(ctx: {
  delivered: number;
  filtered: number;
  undeliveredOther: number;
  windowHours: number;
  /** Unix ms of the first filtered text in this episode. */
  filteredSince: number;
  examples: Array<{ to: string; at: number; kind: string }>;
  appUrl: string;
}): EmailContent {
  const subject = "Texts from the Main Line are being filtered by carriers";
  const total = ctx.delivered + ctx.filtered + ctx.undeliveredOther;
  const since = new Date(ctx.filteredSince).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const lines = [
    `In the last ${ctx.windowHours} hours, ${ctx.filtered} of ${total} texts sent from the Main Line, (727) 209-7846, came back undelivered with carrier code 30007 ("message filtered"); ${ctx.delivered} were delivered. The first filtered one went out ${since}.`,
    "Carriers do this to a number they see as new or as sending a burst of similar texts, especially ones with links. On September 30 it lasted from 11:14 AM until about 10 PM. Nothing in Apply has changed; each affected text shows as Not delivered in its thread.",
    "What to do: hold group texts for a few hours. If it is still happening the next morning, ask Quo support to check the Main Line's carrier registration. Apply will email again when delivery recovers.",
  ];
  const fmt = (ms: number) =>
    new Date(ms).toLocaleTimeString("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      minute: "2-digit",
    });
  const list = ctx.examples.length
    ? `<p style="margin:16px 0 4px;font-size:14px;color:#6b7280;">Filtered texts, newest first:</p><ul style="margin:0 0 16px;padding-left:20px;font-size:14px;color:#111827;">` +
      ctx.examples
        .map((e) => `<li>${escapeHtml(fmt(e.at))} — ${escapeHtml(e.kind)} to ${escapeHtml(e.to)}</li>`)
        .join("") +
      "</ul>"
    : "";
  const html = layout({
    preheader: lines[0].slice(0, 120),
    body:
      `<h2 style="margin:0 0 16px;font-size:18px;">${escapeHtml(subject)}</h2>` +
      lines.map((l) => p(l)).join("") +
      list,
    buttonHref: `${ctx.appUrl}/admin/messages`,
    buttonLabel: "Open Messages",
  });
  const text = [
    subject,
    "",
    ...lines,
    "",
    ...ctx.examples.map((e) => `${fmt(e.at)} - ${e.kind} to ${e.to}`),
  ].join("\n");
  return { subject, html, text };
}

/** The follow-up to smsDeliveryFiltered: the window is clean again. */
export function smsDeliveryRecovered(ctx: {
  delivered: number;
  alertedAt: number;
  appUrl: string;
}): EmailContent {
  const subject = "Texts from the Main Line are delivering again";
  const when = new Date(ctx.alertedAt).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const lines = [
    `Since the filtering alert at ${when}, the most recent ${ctx.delivered} texts from the Main Line were delivered and none were filtered.`,
    "Texts that were filtered during the episode were not re-sent; they still read Not delivered in their threads.",
  ];
  const html = layout({
    preheader: lines[0].slice(0, 120),
    body:
      `<h2 style="margin:0 0 16px;font-size:18px;">${escapeHtml(subject)}</h2>` +
      lines.map((l) => p(l)).join(""),
    buttonHref: `${ctx.appUrl}/admin/messages`,
    buttonLabel: "Open Messages",
  });
  return { subject, html, text: [subject, "", ...lines].join("\n") };
}

export function smsReplyReceived(ctx: SmsReplyReceivedContext): EmailContent {
  // Subject context: the family name for families ("Steven Petros
  // (Petros Family)"), the record type for inquiry/camp contacts
  // ("John Smith (inquiry)").
  const whoContext =
    ctx.family_name ??
    (ctx.contact_type && ctx.contact_type !== "family"
      ? (CONTACT_TYPE_LABEL[ctx.contact_type] ?? ctx.contact_type).toLowerCase()
      : null);
  const who = ctx.parent_name
    ? whoContext
      ? `${ctx.parent_name} (${whoContext})`
      : ctx.parent_name
    : ctx.from_number;
  const subject = ctx.opted_out
    ? `SMS opt-out from ${who}`
    : `New text from ${who}`;
  const preheader = ctx.message_body.slice(0, 120);

  const row = (label: string, value: string, muted = false) =>
    `<tr>
      <td style="padding:6px 12px 6px 0;font-size:14px;color:#6b7280;white-space:nowrap;vertical-align:top;">${escapeHtml(label)}</td>
      <td style="padding:6px 0;font-size:14px;color:${muted ? "#9ca3af" : "#111827"};word-break:break-word;">${escapeHtml(value)}</td>
    </tr>`;

  const detailRows = [
    row("Parent", ctx.parent_name ?? "Not recognized"),
    ctx.student_names ? row("Student", ctx.student_names) : "",
    ctx.family_name ? row("Family", ctx.family_name) : "",
    ctx.contact_type
      ? row("Type", CONTACT_TYPE_LABEL[ctx.contact_type] ?? ctx.contact_type)
      : "",
    row("Phone", ctx.from_number),
    ctx.message_sid ? row("Message ID", ctx.message_sid, true) : "",
  ].join("");

  const optOutNote = ctx.opted_out
    ? p(
        `This was an opt-out keyword — the parent will no longer receive texts until they reply START.`
      )
    : "";

  const unrecognizedNote = !ctx.parent_name
    ? p(
        `This number doesn't match any family, inquiry, or summer-camp contact on file, so the message couldn't be attributed.`
      )
    : "";

  const html = layout({
    preheader,
    body:
      `<h2 style="margin:0 0 16px;font-size:18px;">${escapeHtml(
        ctx.opted_out ? "SMS opt-out received" : "New SMS reply received"
      )}</h2>` +
      `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px;">${detailRows}</table>` +
      `<div style="background:#f4f4f5;border-radius:8px;padding:14px 16px;margin:0 0 16px;font-size:15px;line-height:1.6;white-space:pre-wrap;word-break:break-word;">${escapeHtml(
        ctx.message_body
      )}</div>` +
      optOutNote +
      unrecognizedNote +
      p(`Reply from the messages inbox, or text them directly at ${ctx.from_number}.`),
    buttonHref: ctx.inbox_url,
    buttonLabel: "Open messages inbox",
  });

  const text = [
    ctx.opted_out ? "SMS opt-out received" : "New SMS reply received",
    "",
    `Parent: ${ctx.parent_name ?? "Not recognized"}`,
    ...(ctx.student_names ? [`Student: ${ctx.student_names}`] : []),
    ...(ctx.family_name ? [`Family: ${ctx.family_name}`] : []),
    ...(ctx.contact_type
      ? [`Type: ${CONTACT_TYPE_LABEL[ctx.contact_type] ?? ctx.contact_type}`]
      : []),
    `Phone: ${ctx.from_number}`,
    ...(ctx.message_sid ? [`Message ID: ${ctx.message_sid}`] : []),
    "",
    "Message:",
    ctx.message_body,
    "",
    ...(ctx.opted_out
      ? [
          "This was an opt-out keyword — the parent will no longer receive texts until they reply START.",
          "",
        ]
      : []),
    ...(!ctx.parent_name
      ? [
          "This number doesn't match any family, inquiry, or summer-camp contact on file, so the message couldn't be attributed.",
          "",
        ]
      : []),
    `Reply from the messages inbox (${ctx.inbox_url}), or text them directly at ${ctx.from_number}.`,
  ].join("\n");

  return { subject, html, text };
}

/* ───────────────────────── Records request ───────────────────────── */
/* Admin-initiated request to a student's previous school to transfer
 * their academic records. Unlike the templates above, this goes to an
 * external institution (not a parent), and the substantive content is
 * the attached PDF letter — this email is just the cover note that
 * carries it. */

export interface RecordsRequestContext {
  /** Full student name, e.g. "Charlee Howard". */
  student_name: string;
}

export function recordsRequest(ctx: RecordsRequestContext): EmailContent {
  const subject = `Records request — ${ctx.student_name}`;
  const preheader = `A request to transfer ${ctx.student_name}'s academic records to SailFuture Academy.`;
  const html = layout({
    preheader,
    body:
      p(`To Whom It May Concern,`) +
      p(
        `Please find attached a formal request for the transfer of ${ctx.student_name}'s academic records to SailFuture Academy.`
      ) +
      p(
        `The attached letter outlines the specific records we are requesting and how to reach us with any questions.`
      ) +
      p(`Thank you,`) +
      p(`The SailFuture Academy admissions team`),
  });
  const text = [
    `To Whom It May Concern,`,
    "",
    `Please find attached a formal request for the transfer of ${ctx.student_name}'s academic records to SailFuture Academy.`,
    "",
    `The attached letter outlines the specific records we are requesting and how to reach us with any questions.`,
    "",
    `Thank you,`,
    `The SailFuture Academy admissions team`,
  ].join("\n");
  return { subject, html, text };
}

/* ─────────────────────── Staff notification ─────────────────────── */
/* A residential/foster family added a new student mid-cycle. */

export interface ResidentialStudentAddedContext {
  /** New student's full name. */
  student_name: string;
  /** Date of birth as stored ("YYYY-MM-DD"), or null when the family
   *  skipped it. Rendered MM/DD/YYYY by the template. */
  student_dob: string | null;
  /** The residential family that added them. */
  family_name: string;
  /** Which home the placement is in, once staff assign it. Null at
   *  creation time — the family doesn't pick it, staff do. */
  residential_house: string | null;
  /** School year label the application was opened against. */
  year_name: string;
  /** Deep link to the student's admin record. */
  student_url: string;
}

/**
 * Fired when a residential family creates a new student from their
 * enrolled dashboard. Unlike every other template here this one is
 * STAFF-facing: foster placements arrive mid-year with no admissions
 * queue to surface them, so without this email a new student could sit
 * unnoticed until someone happened to open the roster.
 *
 * The residential home is deliberately shown as "Not assigned yet" at
 * creation rather than omitted — assigning it is the action this email
 * is asking someone to take.
 */
export function residentialStudentAdded(
  ctx: ResidentialStudentAddedContext
): EmailContent {
  const subject = `New residential placement: ${ctx.student_name}`;
  const preheader = `${ctx.family_name} added ${ctx.student_name} for ${ctx.year_name}.`;

  const row = (label: string, value: string, muted = false) =>
    `<tr>
      <td style="padding:6px 12px 6px 0;font-size:14px;color:#6b7280;white-space:nowrap;vertical-align:top;">${escapeHtml(label)}</td>
      <td style="padding:6px 0;font-size:14px;color:${muted ? "#9ca3af" : "#111827"};word-break:break-word;">${escapeHtml(value)}</td>
    </tr>`;

  const houseLabel = ctx.residential_house ?? "Not assigned yet";
  const detailRows = [
    row("Student", ctx.student_name),
    ctx.student_dob ? row("Date of birth", formatDob(ctx.student_dob)) : "",
    row("Family", ctx.family_name),
    row("Residential home", houseLabel, !ctx.residential_house),
    row("School year", ctx.year_name),
  ].join("");

  const html = layout({
    preheader,
    body:
      `<h2 style="margin:0 0 16px;font-size:18px;">New residential placement added</h2>` +
      p(
        `${escapeHtml(ctx.family_name)} added a new student from their family dashboard. The registration packet is open for them to complete — no admissions review is required for residential placements.`
      ) +
      `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px;">${detailRows}</table>` +
      (ctx.residential_house
        ? ""
        : p(
            `Set the residential home on the student's Placement card so the roster reflects where they're living.`
          )),
    buttonHref: ctx.student_url,
    buttonLabel: "Open student record",
  });

  const text = [
    `New residential placement added`,
    "",
    `Student: ${ctx.student_name}`,
    ctx.student_dob ? `Date of birth: ${formatDob(ctx.student_dob)}` : "",
    `Family: ${ctx.family_name}`,
    `Residential home: ${houseLabel}`,
    `School year: ${ctx.year_name}`,
    "",
    `${ctx.family_name} added this student from their family dashboard. The registration packet is open for them to complete — no admissions review is required for residential placements.`,
    "",
    ctx.residential_house
      ? ""
      : `Set the residential home on the student's Placement card so the roster reflects where they're living.`,
    "",
    `Open student record: ${ctx.student_url}`,
  ]
    .filter((line) => line !== "")
    .join("\n");

  return { subject, html, text };
}

export interface BillingAmountChangedContext extends BaseContext {
  /** School year label, e.g. "2026-2027". */
  year_name: string;
  previous_monthly: number;
  new_monthly: number;
  /** When the first invoice at the new amount goes out, or null when
   *  Stripe couldn't say — the copy falls back to "your next monthly
   *  invoice". */
  first_invoice_at: number | null;
}

/**
 * Sent after admin changes a student's confirmed tuition amounts and
 * the Stripe subscription was re-priced (the "Edit amounts" override
 * on the Determination card). Says only what changed and when — the
 * admin's reason for the change is internal and stays in the audit
 * note.
 */
export function billingAmountChanged(
  ctx: BillingAmountChangedContext
): EmailContent {
  const money = (v: number) =>
    v.toLocaleString("en-US", { style: "currency", currency: "USD" });
  const startsWith =
    ctx.first_invoice_at === null
      ? "your next monthly invoice"
      : `your ${new Date(ctx.first_invoice_at).toLocaleDateString("en-US", {
          month: "long",
          day: "numeric",
          timeZone: "America/New_York",
        })} invoice`;

  const subject = `${ctx.student_first_name}'s monthly tuition payment has changed`;
  const preheader = `Your new monthly payment is ${money(ctx.new_monthly)}, starting with ${startsWith}.`;
  const intro = `We've updated the monthly tuition and fees payment for ${ctx.student_first_name} for the ${ctx.year_name} school year.`;
  const timing = `The new amount starts with ${startsWith}. Invoices already issued aren't affected, and there's nothing you need to do.`;

  const row = (label: string, value: string, strong = false) =>
    `<tr>
      <td style="padding:6px 16px 6px 0;font-size:15px;color:#6b7280;">${escapeHtml(label)}</td>
      <td style="padding:6px 0;font-size:15px;text-align:right;${strong ? "font-weight:600;color:#111827;" : "color:#6b7280;"}">${escapeHtml(value)}</td>
    </tr>`;

  const html = layout({
    preheader,
    body:
      p(`Hi ${ctx.parent_first_name},`) +
      p(intro) +
      `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px;">${
        row("Previous monthly payment", money(ctx.previous_monthly)) +
        row("New monthly payment", money(ctx.new_monthly), true)
      }</table>` +
      p(timing) +
      p(`The SailFuture Academy team`),
    buttonHref: ctx.login_url,
    buttonLabel: "View your account",
  });

  const text = [
    `Hi ${ctx.parent_first_name},`,
    "",
    intro,
    "",
    `Previous monthly payment: ${money(ctx.previous_monthly)}`,
    `New monthly payment: ${money(ctx.new_monthly)}`,
    "",
    timing,
    "",
    `View your account: ${ctx.login_url}`,
    "",
    `Questions? Email ${SUPPORT_EMAIL} or call ${SUPPORT_PHONE}.`,
    "",
    `The SailFuture Academy team`,
  ].join("\n");

  return { subject, html, text };
}

export interface TuitionPastDueContext extends BaseContext {
  /** Every past-due invoice on the account, oldest first. */
  invoices: Array<{
    amount_cents: number;
    /** Unix ms. Printed as its UTC calendar date, the date Stripe puts
     *  on the invoice and its hosted page. */
    due_date: number;
    days_past_due: number;
    /** Public pay link for this one invoice. */
    pay_url: string;
  }>;
  /** Parent Tuition & Fees page, which lists every invoice (sign-in
   *  required). */
  tuition_url: string;
}

/**
 * Past-due tuition reminder. The daily cron sends it 7, 14 and 21 days
 * after an invoice's due date (lib/billing-past-due.ts) to every parent
 * on the family. It lists every past-due invoice on the account with
 * its own pay link, so the family can clear the whole balance from one
 * email.
 */
export function tuitionPastDue(ctx: TuitionPastDueContext): EmailContent {
  const money = (cents: number) =>
    (cents / 100).toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
    });
  const date = (ms: number) =>
    new Date(ms).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    });
  const late = (days: number) =>
    `${days} day${days === 1 ? "" : "s"} past due`;
  const total = ctx.invoices.reduce((sum, inv) => sum + inv.amount_cents, 0);
  const single = ctx.invoices.length === 1 ? ctx.invoices[0] : null;

  const subject = single
    ? `Past due: ${money(single.amount_cents)} tuition payment (due ${date(single.due_date)})`
    : `Past due: ${ctx.invoices.length} tuition payments totaling ${money(total)}`;
  const preheader = single
    ? `Your ${money(single.amount_cents)} tuition payment was due ${date(single.due_date)}. You can pay it online now.`
    : `${ctx.invoices.length} tuition payments totaling ${money(total)} are past due. You can pay each one online now.`;
  const intro = single
    ? `We haven't received the ${money(single.amount_cents)} tuition and fees payment for ${ctx.student_first_name} that was due ${date(single.due_date)}. It is now ${late(single.days_past_due)}.`
    : `We haven't received these tuition and fees payments for ${ctx.student_first_name}:`;
  const already = single
    ? `If you've already sent this payment, thank you, and please disregard this reminder.`
    : `If you've already sent these payments, thank you, and please disregard this reminder.`;
  const portal = `You can see every invoice, and turn on autopay so future payments go through on their own, on the Tuition & Fees page of your family portal.`;

  const cell = "padding:10px 0;border-bottom:1px solid #e5e7eb;";
  const invoiceTable = single
    ? ""
    : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;border-collapse:collapse;">${ctx.invoices
        .map(
          (inv) => `<tr>
        <td style="${cell}font-size:15px;">
          <div style="color:#111827;">Due ${escapeHtml(date(inv.due_date))}</div>
          <div style="color:#6b7280;font-size:13px;">${escapeHtml(late(inv.days_past_due))}</div>
        </td>
        <td style="${cell}padding-right:12px;font-size:15px;font-weight:600;text-align:right;white-space:nowrap;">${escapeHtml(money(inv.amount_cents))}</td>
        <td style="${cell}text-align:right;white-space:nowrap;">
          <a href="${escapeAttr(inv.pay_url)}" style="display:inline-block;background:#0F2A4A;color:#ffffff;padding:8px 16px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;">Pay</a>
        </td>
      </tr>`
        )
        .join("")}<tr>
        <td style="padding:10px 0;font-size:15px;color:#6b7280;">Total past due</td>
        <td style="padding:10px 12px 10px 0;font-size:15px;font-weight:600;text-align:right;white-space:nowrap;">${escapeHtml(money(total))}</td>
        <td></td>
      </tr></table>`;

  const html = layout({
    preheader,
    body:
      p(`Hi ${ctx.parent_first_name},`) +
      p(intro) +
      invoiceTable +
      p(already) +
      `<p style="margin:0 0 14px;">You can see every invoice, and turn on autopay so future payments go through on their own, on the <a href="${escapeAttr(ctx.tuition_url)}" style="color:#0F2A4A;">Tuition &amp; Fees page</a> of your family portal.</p>` +
      p(`The SailFuture Academy team`),
    // One invoice gets the big button; several get a Pay button per
    // row in the table above.
    buttonHref: single?.pay_url,
    buttonLabel: single ? `Pay ${money(single.amount_cents)}` : undefined,
  });

  const text = [
    `Hi ${ctx.parent_first_name},`,
    "",
    intro,
    "",
    ...(single
      ? [`Pay online: ${single.pay_url}`]
      : [
          ...ctx.invoices.map(
            (inv) =>
              `- ${money(inv.amount_cents)}, due ${date(inv.due_date)} (${late(inv.days_past_due)}). Pay: ${inv.pay_url}`
          ),
          `Total past due: ${money(total)}`,
        ]),
    "",
    already,
    "",
    `${portal} ${ctx.tuition_url}`,
    "",
    `Questions? Email ${SUPPORT_EMAIL} or call ${SUPPORT_PHONE}.`,
    "",
    `The SailFuture Academy team`,
  ].join("\n");

  return { subject, html, text };
}

export interface AutopayOnContext extends BaseContext {
  /** Who switched it on. Sets the opening line. "default" is the
   *  automatic switch for a family with a payment method saved. */
  source: "parent" | "admin" | "default";
  /** e.g. "Visa ending in 4242". */
  payment_method_label: string;
  /** When the next monthly invoice is charged (unix ms), or null. */
  next_charge_at: number | null;
  /** Open invoices charged when autopay switched on. */
  charges: Array<{
    amount_cents: number;
    /** Unix ms, printed as its UTC calendar date like Stripe does. */
    due_date: number | null;
    outcome: "paid" | "processing" | "failed";
    pay_url: string;
  }>;
  tuition_url: string;
}

/**
 * Autopay confirmation, sent every time a family's tuition switches to
 * autopay (lib/autopay.ts): by the parent, by staff, or automatically
 * because a payment method is on file. It names the payment method and
 * the next charge, lists any open invoices the switch just charged, and
 * says where to turn it off.
 */
export function autopayOn(ctx: AutopayOnContext): EmailContent {
  const money = (cents: number) =>
    (cents / 100).toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
    });
  const dueDate = (ms: number) =>
    new Date(ms).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    });
  const chargeDate = (ms: number) =>
    new Date(ms).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      timeZone: "America/New_York",
    });
  const outcomeLabel = {
    paid: "Paid",
    processing: "Processing (bank payments take a few business days)",
    failed: "Didn't go through",
  } as const;

  const opening = {
    parent: "Thanks for turning on autopay.",
    admin: "We've turned on autopay for your tuition.",
    default:
      "You have a payment method saved with us, so we've turned on autopay for your tuition.",
  }[ctx.source];
  const how =
    `From now on, each monthly tuition and fees invoice for ${ctx.student_first_name} is charged to your ${ctx.payment_method_label} when it's issued.` +
    (ctx.next_charge_at ? ` The next one is on ${chargeDate(ctx.next_charge_at)}.` : "");
  const chargedIntro = `We also charged the invoices that were already open on your account:`;
  const failed = ctx.charges.filter((c) => c.outcome === "failed");
  const failedNote =
    failed.length > 0
      ? `${failed.length === 1 ? "One payment" : "Some payments"} didn't go through. Please pay ${failed.length === 1 ? "it" : "them"} with the link above, or update your payment method on the Tuition & Fees page.`
      : "";
  const control = `You can turn autopay off or change your payment method anytime on the Tuition & Fees page of your family portal.`;

  const subject = `Autopay is on for your SailFuture Academy tuition`;
  const preheader = `Each monthly invoice is now charged to your ${ctx.payment_method_label}.`;

  const cell = "padding:8px 0;border-bottom:1px solid #e5e7eb;font-size:15px;";
  const chargeTable =
    ctx.charges.length === 0
      ? ""
      : p(chargedIntro) +
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;border-collapse:collapse;">${ctx.charges
          .map(
            (c) => `<tr>
        <td style="${cell}">${escapeHtml(c.due_date ? `Due ${dueDate(c.due_date)}` : "Invoice")}</td>
        <td style="${cell}padding:8px 12px;font-weight:600;text-align:right;white-space:nowrap;">${escapeHtml(money(c.amount_cents))}</td>
        <td style="${cell}text-align:right;color:${c.outcome === "failed" ? "#b91c1c" : "#6b7280"};">${
          c.outcome === "failed"
            ? `${escapeHtml(outcomeLabel.failed)} · <a href="${escapeAttr(c.pay_url)}" style="color:#0F2A4A;">Pay</a>`
            : escapeHtml(outcomeLabel[c.outcome])
        }</td>
      </tr>`
          )
          .join("")}</table>`;

  const html = layout({
    preheader,
    body:
      p(`Hi ${ctx.parent_first_name},`) +
      p(opening) +
      p(how) +
      chargeTable +
      (failedNote ? p(failedNote) : "") +
      p(control) +
      p(`The SailFuture Academy team`),
    buttonHref: ctx.tuition_url,
    buttonLabel: "View Tuition & Fees",
  });

  const text = [
    `Hi ${ctx.parent_first_name},`,
    "",
    opening,
    "",
    how,
    ...(ctx.charges.length > 0
      ? [
          "",
          chargedIntro,
          ...ctx.charges.map(
            (c) =>
              `- ${money(c.amount_cents)}${c.due_date ? `, due ${dueDate(c.due_date)}` : ""}: ${outcomeLabel[c.outcome]}${c.outcome === "failed" ? `. Pay: ${c.pay_url}` : ""}`
          ),
        ]
      : []),
    ...(failedNote ? ["", failedNote] : []),
    "",
    `${control} ${ctx.tuition_url}`,
    "",
    `Questions? Email ${SUPPORT_EMAIL} or call ${SUPPORT_PHONE}.`,
    "",
    `The SailFuture Academy team`,
  ].join("\n");

  return { subject, html, text };
}

export interface AutopayPaymentFailedContext extends BaseContext {
  amount_cents: number;
  /** Public pay link for the invoice. */
  pay_url: string;
  tuition_url: string;
}

/**
 * An autopay charge was declined (Stripe webhook `invoice.payment_failed`
 * on a `charge_automatically` invoice). Autopay invoices carry no due
 * date, so the billing texts never fire for them, and this is the
 * parent's notice until the 7-day past-due email. Once per invoice.
 */
export function autopayPaymentFailed(
  ctx: AutopayPaymentFailedContext
): EmailContent {
  const money = (cents: number) =>
    (cents / 100).toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
    });
  const subject = `Your ${money(ctx.amount_cents)} tuition payment didn't go through`;
  const preheader = `Autopay couldn't charge your saved payment method. You can pay online now.`;
  const intro = `We tried to charge your saved payment method for the ${money(ctx.amount_cents)} tuition and fees payment for ${ctx.student_first_name}, but it didn't go through.`;
  // Plain-text version only; the HTML says "button" and links the page.
  const next = `You can pay it now at the link below. To keep autopay working, please update your payment method on the Tuition & Fees page of your family portal.`;

  const html = layout({
    preheader,
    body:
      p(`Hi ${ctx.parent_first_name},`) +
      p(intro) +
      `<p style="margin:0 0 14px;">You can pay it now with the button below. To keep autopay working, please update your payment method on the <a href="${escapeAttr(ctx.tuition_url)}" style="color:#0F2A4A;">Tuition &amp; Fees page</a> of your family portal.</p>` +
      p(`The SailFuture Academy team`),
    buttonHref: ctx.pay_url,
    buttonLabel: `Pay ${money(ctx.amount_cents)}`,
  });

  const text = [
    `Hi ${ctx.parent_first_name},`,
    "",
    intro,
    "",
    next,
    "",
    `Pay online: ${ctx.pay_url}`,
    `Tuition & Fees: ${ctx.tuition_url}`,
    "",
    `Questions? Email ${SUPPORT_EMAIL} or call ${SUPPORT_PHONE}.`,
    "",
    `The SailFuture Academy team`,
  ].join("\n");

  return { subject, html, text };
}

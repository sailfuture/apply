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
            <td style="padding:28px 32px 16px;border-bottom:1px solid #e5e7eb;">
              <div style="font-size:18px;font-weight:700;color:#0F2A4A;letter-spacing:0.3px;">SailFuture Academy</div>
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
  const subject = `${ctx.student_first_name} has been accepted to SailFuture Academy`;
  const preheader = `Congratulations — sign the enrollment agreement to reserve ${ctx.student_first_name}'s spot.`;
  const html = layout({
    preheader,
    body:
      p(`Congratulations ${ctx.parent_first_name},`) +
      p(
        `We're excited to share that ${ctx.student_first_name} has been accepted to SailFuture Academy for the 2026/2027 school year.`
      ) +
      p(
        `To reserve ${ctx.student_first_name}'s spot, sign the enrollment agreement and complete the registration paperwork inside your family portal. Spots are limited and assigned in the order families complete enrollment, so we recommend signing as soon as you can.`
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
    `We're excited to share that ${ctx.student_first_name} has been accepted to SailFuture Academy for the 2026/2027 school year.`,
    "",
    `To reserve ${ctx.student_first_name}'s spot, sign the enrollment agreement and complete the registration paperwork inside your family portal. Spots are limited and assigned in the order families complete enrollment, so we recommend signing as soon as you can.`,
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
        `A couple of things to know as you plan ahead. Monthly tuition invoices will begin on the 1st of each month and can be viewed and paid through your family portal. The first day of school is Monday, August 24th, 2026. We'll send a back to school packet later this summer with the full calendar, supply list, and first day logistics.`
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
    `A couple of things to know as you plan ahead. Monthly tuition invoices will begin on the 1st of each month and can be viewed and paid through your family portal. The first day of school is Monday, August 24th, 2026. We'll send a back to school packet later this summer with the full calendar, supply list, and first day logistics.`,
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

/* ─────────────────────────────── Email 8 ─────────────────────────────── */
/* Not accepted. */

export function notAccepted(ctx: BaseContext): EmailContent {
  const subject = `Update on ${ctx.student_first_name}'s SailFuture Academy application`;
  const preheader = `An update on ${ctx.student_first_name}'s application for 2026/2027.`;
  const html = layout({
    preheader,
    body:
      p(`Hi ${ctx.parent_first_name},`) +
      p(
        `Thank you for applying to SailFuture Academy and trusting us with ${ctx.student_first_name}'s application. After careful review, we're unable to offer ${ctx.student_first_name} a spot for the 2026/2027 school year.`
      ) +
      p(
        `This decision isn't a reflection of ${ctx.student_first_name}'s potential or worth. We had far more applicants than spots available, and these decisions are some of the hardest our team makes.`
      ) +
      p(
        `If you'd like to talk through the decision, learn what could make a future application stronger, or get connected with other educational resources in the area, we're glad to help. Email ${SUPPORT_EMAIL} or call ${SUPPORT_PHONE}.`
      ) +
      p(`We wish ${ctx.student_first_name} the very best,`) +
      p(TEAM_SIGNATURE),
    // Intentionally no CTA button — this is a closing communication.
  });
  const text = [
    `Hi ${ctx.parent_first_name},`,
    "",
    `Thank you for applying to SailFuture Academy and trusting us with ${ctx.student_first_name}'s application. After careful review, we're unable to offer ${ctx.student_first_name} a spot for the 2026/2027 school year.`,
    "",
    `This decision isn't a reflection of ${ctx.student_first_name}'s potential or worth. We had far more applicants than spots available, and these decisions are some of the hardest our team makes.`,
    "",
    `If you'd like to talk through the decision, learn what could make a future application stronger, or get connected with other educational resources in the area, we're glad to help. Email ${SUPPORT_EMAIL} or call ${SUPPORT_PHONE}.`,
    "",
    `We wish ${ctx.student_first_name} the very best,`,
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
        `Full first day logistics, the academic calendar, the supply list, drop-off and pick-up details, and uniform expectations are all in your family portal. Please take a few minutes to review everything before the first day so ${ctx.student_first_name} arrives ready.`
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
    `Full first day logistics, the academic calendar, the supply list, drop-off and pick-up details, and uniform expectations are all in your family portal. Please take a few minutes to review everything before the first day so ${ctx.student_first_name} arrives ready.`,
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

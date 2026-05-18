import { getResend, getFromAddress, getReplyToAddress } from "./resend";
import type { EmailContent } from "./templates";

/**
 * Low-level email send. Wraps the Resend SDK with the SailFuture
 * envelope defaults (CC dean@ + admissions@, branded from address,
 * reply-to inbox).
 *
 * All sends are guarded — never throw out of this function. The
 * caller (status-change endpoint, cron job) shouldn't fail the
 * primary operation just because a notification didn't go out.
 * Failures are logged with enough context to debug.
 *
 * Returns `{ ok, id?, error? }` so callers can inspect what
 * happened if they care, but most won't.
 */

export interface SendArgs {
  /** Primary recipient email(s). Empty array = skip the send. */
  to: string[];
  /** Subject + body produced by a template function. */
  content: EmailContent;
  /** Extra CCs beyond the defaults. Most events don't need this. */
  extraCc?: string[];
  /** Optional override of the default CC list (dean + admissions). Pass
   *  an empty array to suppress the default CCs entirely. */
  cc?: string[];
  /** Short tag for log lines (e.g. "application-received"). Helps
   *  trace which template fired in production logs. */
  tag: string;
}

export interface SendResult {
  ok: boolean;
  id?: string;
  error?: string;
}

/** Default CCs every transactional email gets. Internal awareness —
 *  the admissions team needs to see what families received. */
const DEFAULT_CC = ["dean@sailfuture.org", "admissions@sailfuture.org"];

export async function sendEmail(args: SendArgs): Promise<SendResult> {
  const tag = args.tag;
  const to = uniqueEmails(args.to);
  if (to.length === 0) {
    console.warn(`[email/${tag}] skipped — no recipient addresses`);
    return { ok: false, error: "no-recipients" };
  }

  const cc = uniqueEmails([
    ...(args.cc ?? DEFAULT_CC),
    ...(args.extraCc ?? []),
  ]).filter((addr) => !to.includes(addr));

  // Dev short-circuit: if RESEND_API_KEY isn't set (typical local
  // dev), log the would-be send and bail. Lets contributors run the
  // app without billing for fake Resend events.
  if (!process.env.RESEND_API_KEY) {
    console.log(
      `[email/${tag}] DRY RUN (no RESEND_API_KEY) → to=${to.join(",")} cc=${cc.join(",")} subject="${args.content.subject}"`
    );
    return { ok: true, id: "dry-run" };
  }

  try {
    const resend = getResend();
    const { data, error } = await resend.emails.send({
      from: getFromAddress(),
      to,
      cc,
      replyTo: getReplyToAddress(),
      subject: args.content.subject,
      html: args.content.html,
      text: args.content.text,
      tags: [{ name: "template", value: tag }],
    });
    if (error) {
      console.error(`[email/${tag}] resend error:`, error);
      return { ok: false, error: error.message ?? String(error) };
    }
    console.log(
      `[email/${tag}] sent id=${data?.id ?? "?"} to=${to.join(",")}`
    );
    return { ok: true, id: data?.id };
  } catch (err) {
    console.error(`[email/${tag}] threw:`, err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Lower-case, trim, dedupe a list of addresses. Filters out blanks
 *  and obvious garbage (no @). Order-preserving. */
function uniqueEmails(addresses: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of addresses) {
    if (!raw) continue;
    const cleaned = raw.trim().toLowerCase();
    if (!cleaned || !cleaned.includes("@")) continue;
    if (seen.has(cleaned)) continue;
    seen.add(cleaned);
    out.push(cleaned);
  }
  return out;
}

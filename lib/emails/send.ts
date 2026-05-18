import { xano } from "@/lib/xano";
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
   *  trace which template fired in production logs AND becomes the
   *  `template` column on the email-notifications audit row. */
  tag: string;
  /** Family this send belongs to. Required for the audit log — when
   *  omitted, the send still goes out but no log row is written.
   *  Triggers in `lib/emails/triggers.ts` always pass this. */
  familyId?: number;
  /** School-year scope for the audit log. Optional because some
   *  notifications (e.g. a future global announcement) might not
   *  be year-scoped. */
  yearId?: number;
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
  // app without billing for fake Resend events. Audit row still
  // lands so the log table renders identically in dev — useful
  // when iterating on the log UI.
  if (!process.env.RESEND_API_KEY) {
    console.log(
      `[email/${tag}] DRY RUN (no RESEND_API_KEY) → to=${to.join(",")} cc=${cc.join(",")} subject="${args.content.subject}"`
    );
    await logNotification({
      args,
      to,
      cc,
      status: "dry_run",
      resendId: null,
      errorMessage: null,
    });
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
      const errorMessage = error.message ?? String(error);
      await logNotification({
        args,
        to,
        cc,
        status: "failed",
        resendId: null,
        errorMessage,
      });
      return { ok: false, error: errorMessage };
    }
    console.log(
      `[email/${tag}] sent id=${data?.id ?? "?"} to=${to.join(",")}`
    );
    await logNotification({
      args,
      to,
      cc,
      status: "sent",
      resendId: data?.id ?? null,
      errorMessage: null,
    });
    return { ok: true, id: data?.id };
  } catch (err) {
    console.error(`[email/${tag}] threw:`, err);
    const errorMessage = err instanceof Error ? err.message : String(err);
    await logNotification({
      args,
      to,
      cc,
      status: "failed",
      resendId: null,
      errorMessage,
    });
    return {
      ok: false,
      error: errorMessage,
    };
  }
}

/** Append a row to the email-notifications audit table. Best-effort:
 *  any failure (network, missing table, Xano down) logs to the
 *  console and returns silently — we never let an audit-write failure
 *  bubble up into the caller's `sendEmail` result. Skipped entirely
 *  when no `familyId` is supplied, since the table requires it. */
async function logNotification({
  args,
  to,
  cc,
  status,
  resendId,
  errorMessage,
}: {
  args: SendArgs;
  to: string[];
  cc: string[];
  status: "sent" | "failed" | "dry_run";
  resendId: string | null;
  errorMessage: string | null;
}): Promise<void> {
  if (!args.familyId) return;
  try {
    await xano.emailNotifications.create({
      registration_families_id: args.familyId,
      registration_school_years_id: args.yearId ?? null,
      template: args.tag,
      subject: args.content.subject,
      recipient_emails: to.join(", "),
      cc_emails: cc.join(", "),
      status,
      resend_id: resendId,
      error_message: errorMessage,
    });
  } catch (err) {
    console.error(
      `[email/${args.tag}] audit log write failed (family=${args.familyId}, year=${args.yearId}):`,
      err
    );
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

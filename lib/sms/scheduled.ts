import crypto from "crypto";
import { xano, type XanoScheduledSend } from "@/lib/xano";
import {
  GroupSendError,
  parseContacts,
  sendGroupText,
  type ContactRef,
} from "@/lib/sms/group-send";
import type { SmsContactType } from "@/lib/sms/contacts";

/**
 * Texts scheduled to go out later. A row is written when staff press
 * "Send later" in the group composer or the event-reminder dialog; the
 * cron (every 5 minutes) claims each row that has come due and sends
 * it through the same engine the Send button uses.
 *
 * Claiming: the cron writes a random token with status "sending", then
 * reads the row back — only the claimer that sees its own token sends.
 * Two overlapping cron runs can't both send, and even if they did, the
 * blast id (minted when the row was scheduled) makes the engine skip
 * anyone already reached.
 *
 * A row that comes due while the cron was down is sent as long as it's
 * less than three hours late; after that it's marked failed rather than
 * texting a stale reminder in the middle of the night.
 */

export const SCHEDULED_STATUSES = ["scheduled", "sending", "sent", "canceled", "failed"] as const;

/** How late a due send may still go out. */
export const MISSED_WINDOW_MS = 3 * 3_600_000;
/** How far ahead a send may be scheduled. */
export const MAX_AHEAD_MS = 90 * 86_400_000;
/** The soonest a send may be scheduled for. */
export const MIN_AHEAD_MS = 60_000;

export interface RunScheduledResult {
  ok: boolean;
  error?: string;
  due: number;
  sent: number;
  failed: number;
  missed: number;
  /** Claimed by another run, or no longer scheduled when re-read. */
  skipped: number;
  /** Refused by the engine (log unreadable) — left scheduled to retry. */
  retried: number;
}

/** The recipient list as stored: the validated refs plus each one's
 *  display name from the composer, so the pending list and the edit
 *  sheet need no lookups. Returns the list, or the message to show. */
export function snapshotContacts(
  raw: unknown
): Array<{ type: string; id: number; name: string }> | string {
  const refs = parseContacts(raw);
  if (typeof refs === "string") return refs;
  const names = new Map<string, string>();
  for (const c of raw as Array<{ type?: unknown; id?: unknown; name?: unknown }>) {
    const key = `${String(c?.type)}-${Number(c?.id)}`;
    if (!names.has(key) && typeof c?.name === "string" && c.name.trim()) {
      names.set(key, c.name.trim());
    }
  }
  return refs.map((r) => ({
    type: r.type,
    id: r.id,
    name: names.get(`${r.type}-${r.id}`) ?? "",
  }));
}

/** A send time from the client (ISO string or unix ms), or the message
 *  to show when it isn't usable. */
export function parseSendAt(raw: unknown, now = Date.now()): number | string {
  const at = typeof raw === "number" ? raw : Date.parse(String(raw ?? ""));
  if (!Number.isFinite(at)) return "Pick a date and time to send it";
  if (at < now + MIN_AHEAD_MS) return "The send time has to be at least a minute from now";
  if (at > now + MAX_AHEAD_MS) return "Texts can be scheduled up to 90 days ahead";
  return at;
}

export function mintBlastId(): string {
  return `sched-${crypto.randomUUID()}`;
}

export function scheduledContacts(row: XanoScheduledSend): ContactRef[] {
  return (Array.isArray(row.contacts) ? row.contacts : [])
    .map((c) => ({ type: c.type as SmsContactType, id: Number(c.id) }))
    .filter((c) => Number.isInteger(c.id) && c.id > 0);
}

/** Send one scheduled row now. Claims it first; returns what happened. */
export async function runScheduledSend(
  row: XanoScheduledSend,
  now = Date.now()
): Promise<"sent" | "failed" | "missed" | "skipped" | "retry"> {
  if (row.status !== "scheduled") return "skipped";

  if (now - row.send_at > MISSED_WINDOW_MS) {
    await xano.scheduledSends.update(row.id, {
      status: "failed",
      error: "Missed its send time — the app wasn't able to send it within three hours.",
    });
    return "missed";
  }

  // Claim.
  const token = crypto.randomUUID();
  await xano.scheduledSends.update(row.id, { status: "sending", claim_token: token });
  const claimed = await xano.scheduledSends.getById(row.id);
  if (!claimed || claimed.status !== "sending" || claimed.claim_token !== token) {
    return "skipped";
  }

  const contacts = scheduledContacts(claimed);
  try {
    if (contacts.length === 0) throw new GroupSendError("No recipients", 400);
    const result = await sendGroupText({
      yearId: Number(claimed.registration_school_years_id) || 0,
      contacts,
      body: claimed.body,
      blastId: claimed.blast_id,
      author: { email: claimed.created_by_email, name: claimed.created_by_name },
    });
    const reached = result.sent + result.alreadySent;
    const outcome =
      result.sendable === 0
        ? "failed"
        : reached === 0 && result.failed > 0
          ? "failed"
          : "sent";
    await xano.scheduledSends.update(claimed.id, {
      status: outcome,
      sent_at: now,
      recipients_count: result.matched,
      sent_count: result.sent,
      failed_count: result.failed,
      skipped_count: result.skippedOptedOut + result.skippedNoPhone,
      error:
        outcome === "failed"
          ? result.sendable === 0
            ? "No recipient could be reached (no number on file or opted out)."
            : "Every send failed."
          : "",
    });
    return outcome;
  } catch (err) {
    // The engine refused (couldn't read the log) or something threw
    // before any text went out: put the row back for the next run.
    // The missed-window rule keeps this from retrying forever.
    const message = err instanceof Error ? err.message : "Send failed";
    console.error(`[scheduled-sends] row ${claimed.id} will retry:`, message);
    await xano.scheduledSends
      .update(claimed.id, { status: "scheduled", error: message })
      .catch((e) => console.error(`[scheduled-sends] couldn't reset row ${claimed.id}:`, e));
    return "retry";
  }
}

let inFlight: Promise<RunScheduledResult> | null = null;

/** Send everything that has come due. One run per process at a time. */
export function runDueScheduledSends(now = Date.now()): Promise<RunScheduledResult> {
  if (inFlight) return inFlight;
  inFlight = run(now).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function run(now: number): Promise<RunScheduledResult> {
  const result: RunScheduledResult = {
    ok: true,
    due: 0,
    sent: 0,
    failed: 0,
    missed: 0,
    skipped: 0,
    retried: 0,
  };
  try {
    const rows = await xano.scheduledSends.getScheduledStrict();
    const due = rows
      .filter((r) => r.send_at && r.send_at <= now)
      .sort((a, b) => a.send_at - b.send_at);
    result.due = due.length;
    for (const row of due) {
      const outcome = await runScheduledSend(row, now);
      if (outcome === "sent") result.sent += 1;
      else if (outcome === "failed") result.failed += 1;
      else if (outcome === "missed") result.missed += 1;
      else if (outcome === "retry") result.retried += 1;
      else result.skipped += 1;
    }
    return result;
  } catch (err) {
    console.error("[scheduled-sends] run failed:", err);
    return { ...result, ok: false, error: err instanceof Error ? err.message : "Run failed" };
  }
}

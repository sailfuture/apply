import { xano, type XanoSmsMessage } from "@/lib/xano";
import { getTwilioClient, isTwilioConfigured } from "@/lib/twilio";

/**
 * One-time repair for SMS rows whose `created_at` is the moment the
 * Twilio backfill IMPORTED them rather than the moment Twilio actually
 * sent/received them.
 *
 * Cause: `syncMessagesFromTwilio` always passed the real `dateSent`,
 * but the Xano `POST /sms_messages` endpoint didn't expose
 * `created_at` as an input, so Xano dropped it and stamped "now".
 * Every message imported by a single sweep therefore shares one clock
 * time — the symptom being a whole back-history reading "Delivered ·
 * 9:30 AM". The input is wired now, so new imports are correct; this
 * fixes the rows written before that.
 *
 * Re-running the sync can't fix them — it dedupes on SID and skips
 * anything already logged. So this walks our own rows instead, asks
 * Twilio what each SID's real timestamp is, and PATCHes the drifted
 * ones.
 *
 * Safe to re-run: it only writes rows that are off by more than a
 * minute, so a second pass is a no-op. Never throws — callers get a
 * structured result either way.
 */

/** How far a stored timestamp may sit from Twilio's before we call it
 *  drift. Live sends log a second or two after Twilio accepts them;
 *  the import-time damage is hours to weeks. */
const TOLERANCE_MS = 60_000;

/** Per-SID lookups run in small concurrent batches — enough to finish
 *  a few hundred rows inside the route's budget without tripping
 *  Twilio's rate limiter. */
const LOOKUP_CONCURRENCY = 10;

export interface SmsTimestampRepairResult {
  ok: boolean;
  /** Why the repair couldn't run at all (a guard, not an error). */
  skipped?: "not_configured";
  error?: string;
  /** True when nothing was written — the preview mode. */
  dryRun: boolean;
  /** Logged rows carrying a Twilio SID (the only repairable ones). */
  scanned: number;
  /** Of those, how many Twilio still knows about. */
  matched: number;
  /** Rows whose stored time is off by more than the tolerance. */
  drifted: number;
  /** Rows actually PATCHed — always 0 on a dry run. */
  repaired: number;
  /** Rows whose PATCH failed (Xano error). */
  failed: number;
  /** Rows Twilio no longer has (outside its retention) — left alone. */
  notFoundInTwilio: number;
  /** Up to 20 drifted rows, for eyeballing a dry run before applying. */
  samples: Array<{
    id: number;
    sid: string;
    stored: string;
    actual: string;
  }>;
}

/** Twilio's `dateSent` is null while a message is still queued; fall
 *  back to `dateCreated` so those rows aren't skipped forever. */
function twilioTimestamp(msg: {
  dateSent?: Date | null;
  dateCreated?: Date | null;
}): number | null {
  const ts = msg.dateSent ?? msg.dateCreated ?? null;
  const ms = ts?.getTime();
  return typeof ms === "number" && Number.isFinite(ms) ? ms : null;
}

export async function repairSmsTimestamps({
  days = 120,
  dryRun = true,
}: { days?: number; dryRun?: boolean } = {}): Promise<SmsTimestampRepairResult> {
  const base: SmsTimestampRepairResult = {
    ok: true,
    dryRun,
    scanned: 0,
    matched: 0,
    drifted: 0,
    repaired: 0,
    failed: 0,
    notFoundInTwilio: 0,
    samples: [],
  };
  if (!isTwilioConfigured()) {
    return { ...base, ok: false, skipped: "not_configured" };
  }

  try {
    const twilio = getTwilioClient();
    // One bulk list covers the common case cheaply; anything older
    // than the window falls through to per-SID lookups below.
    const [ourRows, listed] = await Promise.all([
      xano.smsMessages.getAll(),
      twilio.messages.list({
        dateSentAfter: new Date(Date.now() - days * 86_400_000),
        limit: 2000,
      }),
    ]);

    const truth = new Map<string, number>();
    for (const m of listed) {
      const ts = twilioTimestamp(m);
      if (m.sid && ts != null) truth.set(m.sid, ts);
    }

    const repairable = ourRows.filter(
      (r): r is XanoSmsMessage & { twilio_message_sid: string } =>
        typeof r.twilio_message_sid === "string" && !!r.twilio_message_sid
    );
    base.scanned = repairable.length;

    // Rows the bulk list didn't cover (sent before the window) —
    // fetch those SIDs individually so an old back-history is still
    // repairable without pulling Twilio's entire log.
    const missing = repairable.filter(
      (r) => !truth.has(r.twilio_message_sid)
    );
    for (let i = 0; i < missing.length; i += LOOKUP_CONCURRENCY) {
      const batch = missing.slice(i, i + LOOKUP_CONCURRENCY);
      await Promise.all(
        batch.map(async (row) => {
          try {
            const msg = await twilio.messages(row.twilio_message_sid).fetch();
            const ts = twilioTimestamp(msg);
            if (ts != null) truth.set(row.twilio_message_sid, ts);
          } catch {
            // Deleted / outside retention / bad SID — counted below.
          }
        })
      );
    }

    for (const row of repairable) {
      const actual = truth.get(row.twilio_message_sid);
      if (actual == null) {
        base.notFoundInTwilio += 1;
        continue;
      }
      base.matched += 1;
      if (Math.abs((row.created_at ?? 0) - actual) <= TOLERANCE_MS) continue;
      base.drifted += 1;
      if (base.samples.length < 20) {
        base.samples.push({
          id: row.id,
          sid: row.twilio_message_sid,
          stored: new Date(row.created_at ?? 0).toISOString(),
          actual: new Date(actual).toISOString(),
        });
      }
      if (dryRun) continue;

      try {
        const updated = await xano.smsMessages.update(row.id, {
          created_at: actual,
        });
        // Guard against the exact failure mode this repair exists to
        // fix: if the Xano EDIT endpoint doesn't accept `created_at`
        // either, the write silently no-ops. Stop on the first one
        // rather than issuing hundreds of pointless PATCHes.
        if (Math.abs((updated?.created_at ?? 0) - actual) > TOLERANCE_MS) {
          return {
            ...base,
            ok: false,
            error:
              "Xano ignored `created_at` on PATCH /sms_messages/{id} — " +
              "expose it as an input on that endpoint, then re-run.",
          };
        }
        base.repaired += 1;
      } catch (err) {
        base.failed += 1;
        console.error(
          `[sms/repair-timestamps] row ${row.id} failed:`,
          err
        );
      }
    }

    return base;
  } catch (err) {
    console.error("[sms/repair-timestamps] failed:", err);
    return {
      ...base,
      ok: false,
      error: err instanceof Error ? err.message : "Repair failed",
    };
  }
}

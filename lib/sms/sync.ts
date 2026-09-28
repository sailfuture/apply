import { xano } from "@/lib/xano";
import { getTwilioClient, isTwilioConfigured } from "@/lib/twilio";
import { isSchoolNumber } from "@/lib/school-phones";
import {
  adhocIdFromPhone,
  buildSmsDirectory,
  contactMessageKeys,
  normPhone,
} from "@/lib/sms/contacts";

/**
 * Reconcile the app's `sms_messages` log against Twilio's OWN message
 * log — the fix for "I can see the text in the Twilio console but not
 * in the Messages tab."
 *
 * The app only logs texts that pass through it: outbound sends via
 * `sendSms`, inbound via the Twilio webhook. Anything else is
 * invisible — staff replying from the Twilio console, the legacy
 * forward-to-email function sending directly, or inbound texts from
 * before the webhook was pointed at the app. This sweep pulls the
 * recent Twilio log, skips every SID we already have, attributes the
 * rest to families by phone number (same last-10-digits rule as the
 * inbound webhook), and inserts them so the thread history is
 * complete.
 *
 * Attribution is by the counterparty number (the contact side of the
 * text: `to` for outbound, `from` for inbound) matched against the
 * unified contact directory — family parents, summer-camp parents,
 * and inquiries, with family > camp > inquiry priority. Numbers that
 * match no contact still import — as ad-hoc rows (every FK null),
 * which the inbox threads by the phone number itself, same as the
 * webhook does for unknown inbound texters. Only numbers that can't
 * thread by phone at all (shortcodes, alphanumeric senders) are
 * skipped, counted in `unmatched`.
 *
 * Safe to run repeatedly: the Twilio SID is the natural key, so
 * re-running imports nothing new — as long as the sweep can SEE what
 * is already logged. `sms_messages` has no unique index on the SID to
 * fall back on, so every read that gates an insert fails closed (see
 * "Dedupe guards" below). Never throws — callers (admin button, cron)
 * get a structured result either way.
 *
 * Dedupe guards. On 2026-09-11 one sweep wrote 341 duplicate rows: it
 * knew none of the SIDs already in the log (the list accessor it used
 * answers [] whenever the read fails), so every message in its 30-day
 * window looked new and was re-imported as an `external` copy of a
 * row the app had already logged. Nothing in Xano stops a second row
 * with the same SID, so the sweep has to be sure on its own:
 *
 *  1. The log is read straight from Xano and fail-closed; a failed
 *     read aborts the sweep before it writes anything.
 *  2. A log with no SIDs in it, while Twilio has messages, is treated
 *     as a failed read rather than as news (`allowEmptyLog` is the
 *     one-time override for a brand-new table).
 *  3. Each SID is looked up again immediately before its insert. A hit
 *     on a row the first read should have contained proves that read
 *     was incomplete — the sweep stops there.
 *  4. Messages Twilio accepted in the last couple of minutes are left
 *     for the next sweep: the app may still be writing its own row
 *     (a group blast logs each send AFTER Twilio takes it).
 *  5. Sweeps in one process share a single run, and each insert is
 *     read back — if a sweep in another process won the same race,
 *     the row this one just wrote is removed again.
 */

/** How long after Twilio accepts a message the app's own log row may
 *  still be on its way — the send → log write, plus its one retry. */
const IN_FLIGHT_GRACE_MS = 2 * 60_000;

export interface SmsSyncResult {
  ok: boolean;
  /** Why the sync couldn't run at all (result of a guard, not an error). */
  skipped?: "not_configured";
  error?: string;
  /** Twilio messages inspected in the window. */
  scanned: number;
  /** New rows written to `sms_messages`. */
  imported: number;
  /** Already present (SID match) — the common case on re-runs. */
  alreadyLogged: number;
  /** Not logged yet, but too recent to call missing — the app may
   *  still be writing its own row. The next sweep decides. */
  deferred: number;
  /** Messages whose counterparty can't thread by phone at all
   *  (shortcodes, alphanumeric senders) — record-less US numbers
   *  import as ad-hoc rows and are NOT counted here. */
  unmatched: number;
  /** Texts between two school numbers — parent-reply forwards to the
   *  Main Line and the "answer in Apply" bounces. Staff plumbing, not
   *  conversations, so never imported. */
  internal: number;
  /** Previously FK-less (ad-hoc) rows whose number now matches a
   *  contact — re-attributed so the thread lands on the named record
   *  (lead created after the text, or the directory was unavailable
   *  when the row was first written). */
  reattributed: number;
  /** Rows stuck on a non-terminal status (usually "queued") whose
   *  real Twilio status is settled — repaired from Twilio's own log.
   *  See the reconciliation block for why they get stuck. */
  statusRepaired: number;
  /** Distinct unmatched numbers (up to 10) for the admin to inspect. */
  unmatchedNumbers: string[];
}

export interface SmsSyncOptions {
  days?: number;
  /** Import into a log that holds no SIDs at all. Only ever right for
   *  the first backfill of a brand-new table; everywhere else an empty
   *  log means the read failed (guard 2). */
  allowEmptyLog?: boolean;
}

/**
 * The sweep in flight in THIS process, if any. The inbox fires a sync
 * on every mount and the cron fires one daily, with nothing to keep
 * them apart — a second caller joins the running sweep instead of
 * starting one beside it. Cross-process overlap is what the
 * read-back in `removeIfDuplicate` is for.
 */
let sweepInFlight: Promise<SmsSyncResult> | null = null;

export function syncMessagesFromTwilio(
  options: SmsSyncOptions = {}
): Promise<SmsSyncResult> {
  if (sweepInFlight) return sweepInFlight;
  sweepInFlight = runSweep(options).finally(() => {
    sweepInFlight = null;
  });
  return sweepInFlight;
}

/**
 * Read a SID back after inserting it. Two sweeps in different
 * processes can both pass the look-before-insert check and both
 * write; the lowest id wins — the later writer always sees the
 * earlier row by the time it looks — and the loser removes only the
 * row it just created. Best-effort: if the read-back fails the insert
 * stands, since the SID was verified absent a moment earlier.
 */
async function removeIfDuplicate(
  createdId: number,
  sid: string
): Promise<boolean> {
  try {
    const rows = await xano.smsMessages.findAllByMessageSidStrict(sid);
    if (!rows.some((r) => r.id < createdId)) return false;
    await xano.smsMessages.delete(createdId);
    return true;
  } catch (err) {
    console.error(
      `[sms/sync] read-back failed for row ${createdId}; leaving it:`,
      err
    );
    return false;
  }
}

async function runSweep({
  days = 30,
  allowEmptyLog = false,
}: SmsSyncOptions): Promise<SmsSyncResult> {
  const base: SmsSyncResult = {
    ok: true,
    scanned: 0,
    imported: 0,
    alreadyLogged: 0,
    deferred: 0,
    unmatched: 0,
    internal: 0,
    unmatchedNumbers: [],
    reattributed: 0,
    statusRepaired: 0,
  };
  if (!isTwilioConfigured()) {
    return { ...base, ok: false, skipped: "not_configured" };
  }

  try {
    // One round trip each: Twilio's log for the window, our existing
    // rows (for SID dedupe), and the unified phone → contact directory
    // (families + summer-camp parents + inquiries). The log read
    // throws rather than degrading to [] (guard 1) — and because this
    // is a Promise.all, that stops the sweep before its first write.
    const [twilioMessages, existing, directory] = await Promise.all([
      getTwilioClient().messages.list({
        dateSentAfter: new Date(Date.now() - days * 86_400_000),
        limit: 1000,
      }),
      xano.smsMessages.getAllStrict(),
      buildSmsDirectory(),
    ]);

    const knownSids = new Set(
      existing.map((m) => m.twilio_message_sid).filter(Boolean)
    );

    base.scanned = twilioMessages.length;

    // Guard 2. A 200 can still be wrong — an endpoint edit that adds
    // a filter or drops a column answers 200 with nothing useful in
    // it. The production log is never empty, so "no SIDs" is a
    // symptom, not a state.
    if (knownSids.size === 0 && twilioMessages.length > 0 && !allowEmptyLog) {
      throw new Error(
        `sms_messages came back with ${existing.length} rows and no ` +
          `Twilio SIDs while Twilio lists ${twilioMessages.length} ` +
          "messages — that is what a failed or truncated read looks " +
          "like, so nothing was imported. If the table really is new, " +
          "run the sync once with allowEmptyLog."
      );
    }

    // Ids only grow, so any row above this was written after the read
    // above — the line between "the read missed it" and "it's new".
    const highestKnownId = existing.reduce((max, m) => Math.max(max, m.id), 0);
    const inFlightSince = Date.now() - IN_FLIGHT_GRACE_MS;
    const unmatchedSet = new Set<string>();

    // Oldest-first so sequential inserts get ascending `created_at`
    // even if the Xano endpoint ignores the explicit timestamp below —
    // thread order stays correct either way.
    const ordered = [...twilioMessages].sort(
      (a, b) => (a.dateSent?.getTime() ?? 0) - (b.dateSent?.getTime() ?? 0)
    );

    for (const msg of ordered) {
      if (!msg.sid || knownSids.has(msg.sid)) {
        base.alreadyLogged += 1;
        continue;
      }
      // Guard 4. Not logged, but Twilio only just took it — `sendSms`
      // and the inbound webhook both write their row a beat later.
      // Importing now would race them into a duplicate; a text that
      // really was sent outside the app is still here next sweep.
      const acceptedAt = (msg.dateCreated ?? msg.dateSent)?.getTime();
      if (acceptedAt == null || acceptedAt > inFlightSince) {
        base.deferred += 1;
        continue;
      }
      const inbound = msg.direction === "inbound";
      const counterparty = inbound ? msg.from : msg.to;
      if (isSchoolNumber(counterparty)) {
        base.internal += 1;
        continue;
      }
      const contact = directory.get(normPhone(counterparty)) ?? null;
      // No record match → import as an ad-hoc row (all FKs null; the
      // inbox threads it by the number). Only a counterparty that
      // can't shape into a 10-digit US number has no thread to land
      // on — skip and report those.
      if (!contact && adhocIdFromPhone(counterparty) === null) {
        base.unmatched += 1;
        if (counterparty) unmatchedSet.add(counterparty);
        continue;
      }

      // Guard 3. The list above is a snapshot; ask Xano about this
      // one SID right now. A failed lookup throws and ends the sweep.
      const logged = await xano.smsMessages.findAllByMessageSidStrict(msg.sid);
      if (logged.length > 0) {
        if (logged[0].id <= highestKnownId) {
          throw new Error(
            `The sms_messages read was incomplete: it returned ` +
              `${existing.length} rows but not row ${logged[0].id}, which ` +
              "already holds a message this sweep was about to import. " +
              `Stopped after ${base.imported} imports.`
          );
        }
        // Written since our read — another sweep, or a slow log write.
        knownSids.add(msg.sid);
        base.alreadyLogged += 1;
        continue;
      }

      const created = await xano.smsMessages.create({
        ...contactMessageKeys(contact),
        registration_students_id: null,
        registration_school_years_id: null,
        direction: inbound ? "inbound" : "outbound",
        to_number: msg.to ?? "",
        from_number: msg.from ?? "",
        // Trimmed for the same reason as the webhook's inbound log:
        // Xano trims text on save, and untrimmed carrier text made the
        // create echo-guard false-positive — which here aborted the
        // WHOLE sweep and re-wedged on every run (Aug 2026 incident).
        body: (msg.body ?? "").trim() || "(no text)",
        status: msg.status || (inbound ? "received" : "sent"),
        twilio_message_sid: msg.sid,
        // "external" renders these with the automated (tinted) bubble
        // so staff can tell them apart from texts typed in the app.
        template: inbound ? null : "external",
        error_code: msg.errorCode ? String(msg.errorCode) : null,
        author_email: null,
        author_name: inbound ? null : "Sent outside Apply",
        segments: msg.numSegments ? Number(msg.numSegments) : null,
        // Preserve Twilio's actual send time. Before `created_at` was
        // exposed as an input on the Xano endpoint (2026-08-03) this
        // was silently dropped, so every row imported by one sweep
        // carried that sweep's clock time — "delivered at 9:30am" on
        // an entire back-history. Rows written before the fix are
        // repaired by `lib/sms/repair-timestamps.ts`.
        created_at: msg.dateSent?.getTime(),
      });
      knownSids.add(msg.sid);
      // Guard 5. Someone else logged it between our lookup and our
      // insert — theirs stands, ours is already gone.
      if (await removeIfDuplicate(created.id, msg.sid)) {
        base.alreadyLogged += 1;
        continue;
      }
      base.imported += 1;
    }

    base.unmatchedNumbers = [...unmatchedSet].slice(0, 10);

    // Heal stale delivery statuses.
    //
    // `sendSms` logs the row AFTER Twilio accepts the message, stamped
    // with Twilio's status at that instant — almost always "queued".
    // The real status arrives later on the statusCallback webhook,
    // which matches rows by SID. But a fast delivery can fire that
    // callback BEFORE the row exists, and the webhook drops updates it
    // can't match (`if (existing)`), leaving the row stuck on "queued"
    // forever even though the text was delivered.
    //
    // Twilio's list above already carries the true status, so
    // reconciling costs nothing extra and is self-healing for rows
    // that lost the race.
    const TERMINAL = new Set([
      "delivered",
      "undelivered",
      "failed",
      "received",
    ]);
    const truthBySid = new Map<string, string>();
    for (const m of twilioMessages) {
      if (m.sid && m.status) truthBySid.set(m.sid, String(m.status));
    }
    for (const row of existing) {
      const sid = row.twilio_message_sid;
      if (!sid) continue;
      // Only rows we believe are still in flight — never overwrite a
      // status the callback already settled.
      if (TERMINAL.has(row.status)) continue;
      const actual = truthBySid.get(sid);
      if (!actual || actual === row.status || !TERMINAL.has(actual)) {
        continue;
      }
      try {
        await xano.smsMessages.update(row.id, { status: actual });
        base.statusRepaired += 1;
      } catch (err) {
        console.error(
          `[sms/sync] status repair failed for row ${row.id}:`,
          err
        );
      }
    }

    // Heal ad-hoc rows: a logged message with NO contact FK whose
    // counterparty now matches the directory gets its FK stamped, so
    // the thread moves from a bare-number conversation onto the named
    // contact. Covers two real cases: the lead/family record was
    // created AFTER the text, and a partially-failed directory fetch
    // at import time (rate limit) that left attributable rows ad-hoc.
    for (const row of existing) {
      const hasFk =
        row.registration_families_id ||
        row.registration_inquiry_id ||
        row.registration_summer_camp_id ||
        row.website_liability_waiver_id ||
        row.tasco_summer_visit_id;
      if (hasFk) continue;
      const phone = normPhone(
        row.direction === "inbound" ? row.from_number : row.to_number
      );
      if (isSchoolNumber(phone)) continue;
      const contact = directory.get(phone);
      if (!contact) continue;
      try {
        // Only the matched FK is non-null; Xano drops the null inputs,
        // so the other columns stay untouched.
        await xano.smsMessages.update(row.id, contactMessageKeys(contact));
        base.reattributed += 1;
      } catch (err) {
        console.error(
          `[sms/sync] re-attribution failed for row ${row.id}:`,
          err
        );
      }
    }

    return base;
  } catch (err) {
    console.error("[sms/sync] failed:", err);
    return {
      ...base,
      ok: false,
      error: err instanceof Error ? err.message : "Sync failed",
    };
  }
}

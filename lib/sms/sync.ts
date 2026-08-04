import { xano } from "@/lib/xano";
import { getTwilioClient, isTwilioConfigured } from "@/lib/twilio";
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
 * re-running imports nothing new. Never throws — callers (admin
 * button, cron) get a structured result either way.
 */

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
  /** Messages whose counterparty can't thread by phone at all
   *  (shortcodes, alphanumeric senders) — record-less US numbers
   *  import as ad-hoc rows and are NOT counted here. */
  unmatched: number;
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

export async function syncMessagesFromTwilio({
  days = 30,
}: { days?: number } = {}): Promise<SmsSyncResult> {
  const base: SmsSyncResult = {
    ok: true,
    scanned: 0,
    imported: 0,
    alreadyLogged: 0,
    unmatched: 0,
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
    // (families + summer-camp parents + inquiries).
    const [twilioMessages, existing, directory] = await Promise.all([
      getTwilioClient().messages.list({
        dateSentAfter: new Date(Date.now() - days * 86_400_000),
        limit: 1000,
      }),
      xano.smsMessages.getAll(),
      buildSmsDirectory(),
    ]);

    const knownSids = new Set(
      existing.map((m) => m.twilio_message_sid).filter(Boolean)
    );

    base.scanned = twilioMessages.length;
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
      const inbound = msg.direction === "inbound";
      const counterparty = inbound ? msg.from : msg.to;
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

      await xano.smsMessages.create({
        ...contactMessageKeys(contact),
        registration_students_id: null,
        registration_school_years_id: null,
        direction: inbound ? "inbound" : "outbound",
        to_number: msg.to ?? "",
        from_number: msg.from ?? "",
        body: msg.body || "(no text)",
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

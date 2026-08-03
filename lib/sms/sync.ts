import { xano } from "@/lib/xano";
import { getTwilioClient, isTwilioConfigured } from "@/lib/twilio";
import {
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
 * match no contact at all are counted and reported, not written —
 * `sms_messages` is contact-keyed, so an unattributable text has no
 * thread to land on.
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
  /** Messages whose counterparty number matched no contact on file
   *  (no family parent, no summer-camp parent, no inquiry). */
  unmatched: number;
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
      const contact = directory.get(normPhone(counterparty));
      if (!contact) {
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

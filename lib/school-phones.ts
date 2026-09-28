/**
 * The school's own phone numbers. One texting number, one calling
 * number (user decision, 2026-09-28):
 *
 *   - (727) 604-8321 — the Twilio number in the "SFA Application
 *     Pipeline" Messaging Service. Every text a family gets, automated
 *     or typed in Apply, comes from it.
 *   - (727) 209-7846 — the office Main Line, ported into Quo. Calls to
 *     the texting number forward here, and parents' texts are
 *     forwarded here as notifications.
 *
 * Texts between these numbers are staff plumbing, not conversations:
 * they never become inbox threads, and the reply forwarder never
 * forwards a text that came from one of them (that would loop).
 */

/** Bare 10-digit form — the same rule as `normPhone` in
 *  lib/sms/contacts.ts, inlined so this module (imported by the voice
 *  webhook) stays free of the Xano client. */
function tenDigits(raw: string | null | undefined): string {
  const d = String(raw ?? "").replace(/\D/g, "");
  return d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
}

export const TEXTING_NUMBER = "+17276048321";
export const MAIN_LINE = "+17272097846";
export const MAIN_LINE_DISPLAY = "(727) 209-7846";

const SCHOOL_NUMBERS = new Set(
  [
    TEXTING_NUMBER,
    MAIN_LINE,
    "+17273532318", // Quo Faculty Line (teacher dashboard notices)
    "+18773606475", // unused Twilio toll-free
    "+17272952299", // unused Twilio local number
  ].map(tenDigits)
);

/** True for any number the school itself owns (any format). */
export function isSchoolNumber(raw: string | null | undefined): boolean {
  const key = tenDigits(raw);
  return key.length === 10 && SCHOOL_NUMBERS.has(key);
}

/**
 * US phone number helpers — normalize, validate, and format.
 *
 * Scope: US numbers only (NANP). The North American Numbering Plan
 * specifies a 10-digit subscriber number that can be prefixed by a
 * single `1` country code (giving 11 digits total). Anything outside
 * that — international numbers, extensions, vanity strings — gets
 * rejected.
 *
 * Why centralize: phone inputs lived ad-hoc across the codebase
 * (parent profile, emergency contacts, inquiries form, etc.) with
 * each surface doing its own ad-hoc strip + length check. Pulling
 * the rules into one module means new surfaces only have to wire in
 * `PhoneInput` (or call `validateUSPhone`) and get consistent
 * behavior — same error messages, same formatting, same max length.
 */

/** Strip every non-digit. Used as the canonical "input is just
 *  digits" coercion before any length check or formatting. */
export function digitsOnly(raw: string): string {
  return (raw ?? "").replace(/\D/g, "");
}

/** First non-zero NANP area code digit must be 2–9 (the leading 0/1
 *  prefixes are reserved). Used by `validateUSPhone` to reject
 *  obvious garbage early. */
const NANP_FIRST_DIGIT = /^[2-9]/;

export interface PhoneValidation {
  /** Whether the input is a valid US phone. Empty string is treated
   *  as valid (caller decides if the field is required); callers
   *  that need to enforce non-empty should check `digits.length`
   *  separately. */
  valid: boolean;
  /** The canonical 10-digit form, e.g. "8135053539". Empty when
   *  the input is empty or invalid. Strips the optional leading
   *  `1` country code so downstream storage stays uniform. */
  digits: string;
  /** Human-readable error string when `valid === false`, otherwise
   *  null. Tuned to be terse enough to render under an input
   *  without wrapping awkwardly. */
  error: string | null;
}

/**
 * Validate + normalize a US phone number string.
 *
 * Accepts any input format — parens, dashes, spaces, dots, an
 * optional leading `+1` or `1` country code. Returns the canonical
 * 10-digit form for storage and a precise error string for
 * surfacing under the input.
 *
 * Empty input is `valid: true` (we don't enforce required-ness
 * here). Callers that need a required field should additionally
 * check `digits.length === 10`.
 */
export function validateUSPhone(raw: string): PhoneValidation {
  const trimmed = (raw ?? "").trim();
  if (trimmed.length === 0) {
    return { valid: true, digits: "", error: null };
  }
  const all = digitsOnly(trimmed);
  // 11 digits is fine only when the leading digit is the `1` US
  // country code. Anything longer (e.g. "+44 ..." international)
  // is rejected outright.
  let core = all;
  if (core.length === 11) {
    if (core[0] !== "1") {
      return {
        valid: false,
        digits: "",
        error: "Only US phone numbers are accepted.",
      };
    }
    core = core.slice(1);
  }
  if (core.length < 10) {
    return {
      valid: false,
      digits: "",
      error: "Phone number must be 10 digits.",
    };
  }
  if (core.length > 10) {
    return {
      valid: false,
      digits: "",
      error: "Phone number can't be longer than 10 digits.",
    };
  }
  if (!NANP_FIRST_DIGIT.test(core)) {
    return {
      valid: false,
      digits: "",
      error: "US area codes must start with 2–9.",
    };
  }
  // Exchange (middle three digits) also can't start with 0 or 1
  // under NANP rules. Catches obvious mis-types like "813-1234567".
  if (!NANP_FIRST_DIGIT.test(core.slice(3, 4))) {
    return {
      valid: false,
      digits: "",
      error: "Phone exchange must start with 2–9.",
    };
  }
  return { valid: true, digits: core, error: null };
}

/**
 * Pretty-print a normalized 10-digit phone for display. The input
 * can be any format — the helper strips non-digits and trims the
 * optional country code itself, so callers can pass raw storage
 * values without pre-cleaning.
 *
 * Returns the original input untouched when the digit count
 * doesn't land on a valid US shape; that way unexpected legacy
 * values render visibly (rather than appearing as an empty cell)
 * and admin can correct them.
 */
export function formatUSPhone(raw: string | number | null | undefined): string {
  if (raw === null || raw === undefined) return "";
  const str = typeof raw === "number" ? String(raw) : raw;
  const d = digitsOnly(str);
  if (d.length === 10) {
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  }
  if (d.length === 11 && d.startsWith("1")) {
    return `+1 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  }
  return str;
}

/**
 * Light formatting while the user is typing. Adds parens + dashes
 * incrementally so the field reads like a real phone number
 * mid-stroke, but doesn't reject partial input — the user can keep
 * typing and the formatter just keeps catching up.
 *
 * Caps at 10 digits so the field can't accept a longer string.
 * Strips a leading `1` country code so users who paste full
 * international format end up with a normalized 10-digit value.
 */
export function formatPhoneInputProgress(raw: string): string {
  let d = digitsOnly(raw);
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  d = d.slice(0, 10);
  if (d.length === 0) return "";
  if (d.length < 4) return `(${d}`;
  if (d.length < 7) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

/**
 * Convert any US phone input to E.164 (`+1XXXXXXXXXX`) for Twilio.
 *
 * Storage is bare 10-digit (Clerk sync strips non-digits), but the
 * Twilio API requires E.164. Returns `null` when the value isn't a
 * valid US number — Twilio would reject it anyway, so callers should
 * skip the send and log the reason rather than fire a doomed request.
 */
export function toE164(raw: string | number | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const { valid, digits } = validateUSPhone(String(raw));
  if (!valid || digits.length !== 10) return null;
  return `+1${digits}`;
}

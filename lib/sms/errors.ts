/**
 * Human explanations for a failed text.
 *
 * `sms_messages.error_code` carries TWO different kinds of value, and
 * the UI has to read both:
 *
 *   1. A numeric Twilio error code ("30034") — the carrier or Twilio
 *      rejected the message. Looked up below.
 *   2. A raw error string from our own send path ("timeout of 30000ms
 *      exceeded", "The Messaging Service Sid … is invalid.") — when
 *      the Twilio API call itself threw, `sendSms` stores
 *      `err.message`. That text IS the explanation, so it's shown
 *      as-is rather than flattened into a generic "Delivery error".
 *
 * Every entry says what actually went wrong in the admin's terms, and
 * `retryable` says whether sending the same text again could plausibly
 * work — an opted-out recipient never will, a phone that was off might.
 */

export interface SmsErrorInfo {
  /** One-line cause, written for an admin, not an engineer. */
  message: string;
  /** Whether re-sending the identical text could succeed. */
  retryable: boolean;
  /** The numeric code, when there was one — shown in the tooltip so
   *  the raw value is still reachable for support tickets. */
  code: string | null;
}

const TWILIO_ERRORS: Record<
  string,
  { message: string; retryable: boolean }
> = {
  "21211": {
    message: "That phone number isn't valid.",
    retryable: false,
  },
  "21408": {
    message: "Texting isn't enabled for that number's region.",
    retryable: false,
  },
  "21610": {
    message: "They replied STOP — they must text START to hear from us again.",
    retryable: false,
  },
  "21614": {
    message: "That number can't receive texts (not a mobile line).",
    retryable: false,
  },
  "30001": {
    message: "Twilio's queue backed up. Sending again usually works.",
    retryable: true,
  },
  "30002": {
    message: "The Twilio account is suspended — billing needs attention.",
    retryable: false,
  },
  "30003": {
    message: "Their phone was off or out of service.",
    retryable: true,
  },
  "30004": {
    message: "Their carrier is blocking messages from us.",
    retryable: false,
  },
  "30005": {
    message: "That number is unknown or no longer in service.",
    retryable: false,
  },
  "30006": {
    message: "That's a landline, so it can't receive texts.",
    retryable: false,
  },
  "30007": {
    message: "Their carrier filtered it as spam.",
    retryable: false,
  },
  "30008": {
    message: "Their carrier rejected it without saying why.",
    retryable: true,
  },
  "30034": {
    message:
      "Our number isn't A2P 10DLC registered, so carriers are rejecting our texts. This is an account setup issue, not this contact — finish A2P registration in Twilio.",
    retryable: false,
  },
};

/** True when the stored value is one of Twilio's numeric codes. */
function isNumericCode(raw: string): boolean {
  return /^\d+$/.test(raw.trim());
}

/**
 * Explain a stored `error_code`. Returns null when there's nothing to
 * explain (no code recorded), so callers can skip the row entirely.
 */
export function describeSmsError(
  raw: string | null | undefined
): SmsErrorInfo | null {
  const value = (raw ?? "").trim();
  if (!value) return null;

  if (isNumericCode(value)) {
    const known = TWILIO_ERRORS[value];
    if (known) {
      return { ...known, code: value };
    }
    return {
      message: `The carrier rejected it (Twilio code ${value}).`,
      // An unrecognized code is more often transient than permanent,
      // and a retry is cheap — better to offer it than to hide it.
      retryable: true,
      code: value,
    };
  }

  // Free-text error from our own send path. Trim the trailing period
  // so it reads consistently beside the canned messages above.
  return {
    message: value.replace(/\s*\.\s*$/, "") + ".",
    retryable: true,
    code: null,
  };
}

/** Whether a message status means the text did not reach the recipient. */
export function isFailedStatus(status: string): boolean {
  return status === "failed" || status === "undelivered";
}

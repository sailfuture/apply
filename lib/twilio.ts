import twilio, { type Twilio } from "twilio";

/**
 * Singleton Twilio client. Lazy so the module can be imported without
 * the env vars present (e.g. during build, or in preview environments
 * where SMS isn't wired up yet) — we only throw when a send actually
 * fires. Mirrors the `getResend()` pattern in `lib/emails/resend.ts`.
 */
let client: Twilio | null = null;

export function getTwilioClient(): Twilio {
  if (client) return client;
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) {
    throw new Error(
      "TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN are not set — cannot send SMS. Add them to .env.local / Vercel env."
    );
  }
  client = twilio(accountSid, authToken);
  return client;
}

/**
 * Messaging Service SID — the outbound sender for all texts. Preferred
 * over a bare from-number: the Messaging Service owns the A2P 10DLC
 * registration, number pool, and carrier-level opt-out handling, so we
 * don't manage individual numbers here.
 */
export function getMessagingServiceSid(): string {
  const sid = process.env.TWILIO_MESSAGING_SERVICE_SID;
  if (!sid) {
    throw new Error(
      "TWILIO_MESSAGING_SERVICE_SID is not set — cannot send SMS. Add it to .env.local / Vercel env."
    );
  }
  return sid;
}

/** The raw auth token — needed to validate inbound webhook signatures
 *  (`twilio.validateRequest`). Returns null when unset so the webhook
 *  can decide how to fail. */
export function getTwilioAuthToken(): string | null {
  return process.env.TWILIO_AUTH_TOKEN ?? null;
}

/**
 * Whether Twilio is fully configured. Lets callers no-op gracefully in
 * environments where SMS isn't wired up (local, preview) instead of
 * throwing — a missing config is "SMS off", not an error, for the
 * best-effort trigger sends.
 */
export function isTwilioConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_MESSAGING_SERVICE_SID
  );
}

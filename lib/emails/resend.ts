import { Resend } from "resend";

/**
 * Singleton Resend client. Lazy so the module can be imported without
 * the env var present (e.g. during build) — we only throw when a send
 * actually fires.
 */
let client: Resend | null = null;

export function getResend(): Resend {
  if (client) return client;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error(
      "RESEND_API_KEY is not set — cannot send email. Add it to .env.local / Vercel env."
    );
  }
  client = new Resend(apiKey);
  return client;
}

/** From-address for all SailFuture transactional mail. Override per-env
 *  with `RESEND_FROM_EMAIL` if the domain changes. The display name +
 *  address are wrapped together so replies route to admissions@. */
export function getFromAddress(): string {
  return (
    process.env.RESEND_FROM_EMAIL ??
    "SailFuture Academy <admissions@sailfuture.org>"
  );
}

/** Reply-to address. Resend lets us bounce inbound replies to an inbox
 *  the team actually reads. */
export function getReplyToAddress(): string {
  return process.env.RESEND_REPLY_TO ?? "admissions@sailfuture.org";
}

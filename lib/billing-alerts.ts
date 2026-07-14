import { getResend, getFromAddress } from "@/lib/emails/resend";

/**
 * Internal billing alert email — the "a human must know about this"
 * channel for billing failures that would otherwise sit silent: a
 * family's invoice payment failed, Stripe's dunning canceled a
 * subscription, a live subscription has no mirrored invoices, a
 * refund couldn't be recorded, etc.
 *
 * Deliberately NOT the parent-facing email pipeline (`lib/emails`) —
 * no template, no per-family audit row, no dedupe. Plain text to the
 * staff billing inbox. Best-effort: never throws, because every call
 * site is itself inside a billing operation that must not fail on a
 * notification problem.
 */
export async function sendBillingAlert(
  subject: string,
  lines: string[]
): Promise<void> {
  try {
    const to =
      process.env.BILLING_ALERTS_EMAIL ?? "admissions@sailfuture.org";
    await getResend().emails.send({
      from: getFromAddress(),
      to,
      subject: `[Billing alert] ${subject}`,
      text: [
        ...lines,
        "",
        "— Automated alert from the SailFuture Apply billing pipeline.",
      ].join("\n"),
    });
  } catch (err) {
    console.error(
      `[billing-alerts] failed to send alert "${subject}":`,
      err
    );
  }
}

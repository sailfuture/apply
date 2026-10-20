/**
 * SMS copy for the six transactional / billing triggers. Kept terse
 * (one or two segments) and lead with "SailFuture Academy" so the text
 * is identifiable without a saved contact. Personalized with the
 * student name, and — for billing — the amount, due date, and pay link.
 *
 * These mirror the tone of the matching Resend emails in
 * `lib/emails/templates.ts`; SMS goes out alongside the email, not
 * instead of it.
 */

export function applicationReceivedSms(v: { student: string }): string {
  return `SailFuture Academy: We've received ${v.student}'s application — it's now under review. We'll follow up with next steps.`;
}

export function acceptedSms(v: { student: string; link: string }): string {
  return `Congratulations! ${v.student} has been accepted to SailFuture Academy. Complete your registration here: ${v.link}`;
}

export function registrationReceivedSms(v: { student: string }): string {
  return `SailFuture Academy: We've received ${v.student}'s registration packet and will confirm your enrollment shortly.`;
}

export function enrolledSms(v: { student: string; link: string }): string {
  return `${v.student} is officially enrolled at SailFuture Academy — welcome! View the details here: ${v.link}`;
}

export function billingUpcomingSms(v: {
  amount: string;
  date: string;
  link: string;
  /** Formatted total already past due on the account, when there is
   *  one. The upcoming invoice isn't part of it. */
  totalPastDue?: string;
}): string {
  const balance = v.totalPastDue
    ? ` Total past due on your account: ${v.totalPastDue}.`
    : "";
  return `SailFuture Academy: a tuition payment of ${v.amount} is due ${v.date}.${balance} View or pay here: ${v.link}`;
}

export function outstandingTuitionSms(v: {
  amount: string;
  date: string;
  link: string;
  /** Formatted total past due on the account, when it's more than
   *  this one invoice. Left out when this invoice IS the total. */
  totalPastDue?: string;
}): string {
  const balance = v.totalPastDue
    ? ` Total past due on your account: ${v.totalPastDue}.`
    : "";
  return `SailFuture Academy: your tuition payment of ${v.amount} (due ${v.date}) is past due.${balance} Please pay here: ${v.link} — reply with any questions.`;
}

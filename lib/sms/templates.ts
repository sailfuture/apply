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
}): string {
  return `SailFuture Academy: a tuition payment of ${v.amount} is due ${v.date}. View or pay here: ${v.link}`;
}

export function outstandingTuitionSms(v: {
  amount: string;
  date: string;
  link: string;
}): string {
  return `SailFuture Academy: your tuition payment of ${v.amount} (due ${v.date}) is past due. Please pay here: ${v.link} — reply with any questions.`;
}

/**
 * SMS copy for the transactional / billing triggers. Kept terse
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
  /** Tuition page's Autopay panel (`/autopay`). */
  autopayLink: string;
  /** Formatted total already past due on the account, when there is
   *  one. The upcoming invoice isn't part of it. */
  totalPastDue?: string;
}): string {
  const balance = v.totalPastDue
    ? ` Total past due on your account: ${v.totalPastDue}.`
    : "";
  return `SailFuture Academy: a tuition payment of ${v.amount} is due ${v.date}.${balance} Pay here: ${v.link} Or set up autopay so it's paid automatically: ${v.autopayLink}`;
}

/** 7, 14 and 21 days past due. Plain ASCII on purpose: one character
 *  outside the GSM set (an em dash, curly quote) makes the whole text
 *  UCS-2, which more than doubles the segments it costs. */
export function pastDueTuitionSms(v: {
  amount: string;
  date: string;
  daysPastDue: number;
  link: string;
  autopayLink: string;
  /** The family is on autopay, so this invoice's charge failed. */
  onAutopay: boolean;
  /** Formatted total past due on the account, when it's more than
   *  this one invoice. Left out when this invoice IS the total. */
  totalPastDue?: string;
}): string {
  const balance = v.totalPastDue
    ? ` Total past due on your account: ${v.totalPastDue}.`
    : "";
  const what = v.onAutopay
    ? `we couldn't charge your card on file for your tuition payment of ${v.amount} (${v.date}). It is now ${v.daysPastDue} days past due.`
    : `your tuition payment of ${v.amount} (due ${v.date}) is now ${v.daysPastDue} days past due.`;
  const autopay = v.onAutopay
    ? `Update your autopay card: ${v.autopayLink}`
    : `Set up autopay: ${v.autopayLink}`;
  return `SailFuture Academy: ${what}${balance} Pay here: ${v.link} ${autopay} Reply with any questions.`;
}

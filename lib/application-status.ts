/**
 * Single source of truth for an application's lifecycle status.
 *
 * `registration_application` carries four booleans (`isSubmitted`,
 * `isOffered`, `isAccepted`, `isDenied`) plus the per-student packet's
 * `registrationConfirmed` flag. The combination drives status everywhere
 * the UI surfaces it — admin tabs, parent dashboard, status badges,
 * email nudges. We derive instead of storing a `status` string so the
 * booleans stay canonical (no chance of drift between two columns).
 */

export type ApplicationStatus =
  | "draft"      // !isSubmitted — family hasn't finished applying
  | "submitted"  // isSubmitted && !isOffered && !isDenied — awaiting admin decision
  | "denied"     // isDenied — admin rejected
  | "offered"    // isOffered && !isAccepted — waiting on family to accept
  | "accepted"   // isAccepted && !registrationConfirmed — packet pending
  | "enrolled";  // isAccepted && registrationConfirmed — fully enrolled

export interface StatusFlags {
  isSubmitted?: boolean;
  isOffered?: boolean;
  isAccepted?: boolean;
  isDenied?: boolean;
  /** From the per-student `registration_student_registration` packet for the
   *  same year — pass it in if you have it; otherwise we assume false. */
  registrationConfirmed?: boolean;
}

export function deriveApplicationStatus(flags: StatusFlags): ApplicationStatus {
  if (flags.isAccepted && flags.registrationConfirmed) return "enrolled";
  if (flags.isAccepted) return "accepted";
  if (flags.isOffered) return "offered";
  if (flags.isDenied) return "denied";
  if (flags.isSubmitted) return "submitted";
  return "draft";
}

/** Display label + Tailwind class for each status. Used by the admin tabs,
 *  the StatusBadge component, and any other surface that renders status. */
export const STATUS_META: Record<
  ApplicationStatus,
  { label: string; className: string; description: string }
> = {
  draft: {
    label: "Draft",
    className: "bg-yellow-50 text-yellow-700 border-yellow-200",
    description: "Family started but hasn't submitted yet.",
  },
  submitted: {
    label: "Submitted",
    className: "bg-blue-50 text-blue-700 border-blue-200",
    description: "Awaiting admissions decision.",
  },
  denied: {
    label: "Denied",
    className: "bg-red-50 text-red-700 border-red-200",
    description: "Application was not accepted.",
  },
  offered: {
    label: "Offered",
    className: "bg-purple-50 text-purple-700 border-purple-200",
    description: "Offer extended; waiting on family to accept.",
  },
  accepted: {
    label: "Accepted",
    className: "bg-emerald-50 text-emerald-700 border-emerald-200",
    description: "Family accepted; registration packet still pending.",
  },
  enrolled: {
    label: "Enrolled",
    className: "bg-green-100 text-green-800 border-green-300",
    description: "Fully enrolled — packet confirmed by admin.",
  },
};

/** All statuses, in the order they should appear in tabs / pickers. */
export const STATUS_ORDER: ApplicationStatus[] = [
  "submitted",
  "offered",
  "accepted",
  "enrolled",
  "draft",
  "denied",
];

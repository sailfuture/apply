import type { XanoTour } from "@/lib/xano";

/**
 * Shared vocabulary for scheduled campus tours — status labels the
 * UI renders and the note bodies the tour routes write into the
 * lead's comms log. One module so the API and the two tour surfaces
 * (lead sheet, Campus Visits tab) can't drift.
 */

/**
 * SWR keys whose data changes when a tour does. A tour write lands in
 * the lead's activity log, the dashboard's lead-activity feed, the
 * All Leads tour column, and the tours list itself — so every tour
 * mutation invalidates this whole family and any mounted timeline
 * animates the new entry in immediately.
 */
/** SWR key for one lead's tours. Lives here (not in a component) so
 *  the activity log and the tour controls can share it without an
 *  import cycle. */
export function leadToursKey(scope: {
  source: string;
  id: number;
}): string {
  return `/api/admin/tours?leadSource=${scope.source}&leadId=${scope.id}`;
}

export function isTourAffectedKey(key: unknown): boolean {
  if (typeof key !== "string") return false;
  return (
    key.startsWith("/api/admin/notes") ||
    key.startsWith("/api/admin/lead-activity") ||
    key.startsWith("/api/admin/all-leads") ||
    key.startsWith("/api/admin/tours")
  );
}

/** Where tours happen — the campus street address, so the Google
 *  Calendar invite's location pin/directions actually work. Default
 *  for the schedule dialog AND the server-side fallback when a tour
 *  arrives with no location. */
export const TOUR_DEFAULT_LOCATION =
  "SailFuture Academy, 2154 27th Ave N, St. Petersburg, FL 33712";

/** Standard parent-facing invite copy — appears on every calendar
 *  invite the app sends (wording supplied by the school). */
export const TOUR_INVITE_DESCRIPTION = `An in-person tour is an important step in the SailFuture Academy enrollment process. During this 60-minute guided visit, prospective students and families will learn about our nationally recognized school model, curriculum, graduation requirements, and experience-based approach to education.

We strongly encourage applicants to attend with their child to ensure SailFuture Academy is the right fit for the entire family.

Please park near the school’s north entrance by the interstate overpass. For directions or questions, contact our school directly at (727) 209-7846.

We look forward to meeting you!`;

/** Full invite description: the admin's tour-specific notes (if any)
 *  on top — they're the part written for THIS family — then the
 *  standard copy. Used on create and kept through reschedules. */
export function tourInviteDescription(notes: string): string {
  const custom = notes.trim();
  return custom
    ? `${custom}\n\n${TOUR_INVITE_DESCRIPTION}`
    : TOUR_INVITE_DESCRIPTION;
}

export const TOUR_STATUS_LABEL: Record<string, string> = {
  scheduled: "Scheduled",
  completed: "Completed",
  no_show: "No-show",
  canceled: "Canceled",
};

/** Parent RSVP from the Google invite → short admin-facing label. */
export const TOUR_RSVP_LABEL: Record<string, string> = {
  accepted: "Accepted",
  declined: "Declined",
  tentative: "Maybe",
  needsAction: "No reply yet",
};

/** RSVP badge tint — green confirmed, amber still waiting, red
 *  declined (the one that needs a phone call). Unknown/absent RSVPs
 *  fall through to the neutral muted chip. */
export const TOUR_RSVP_BADGE: Record<string, string> = {
  accepted: "bg-green-100 text-green-800 hover:bg-green-100",
  needsAction: "bg-amber-100 text-amber-800 hover:bg-amber-100",
  tentative: "bg-amber-100 text-amber-800 hover:bg-amber-100",
  declined: "bg-red-100 text-red-800 hover:bg-red-100",
};

/** Label + tint for an RSVP value, defaulting to "No reply yet" —
 *  an invite with no response recorded is exactly that. */
export function tourRsvpBadge(rsvp: string): {
  label: string;
  className: string;
} {
  const key = rsvp || "needsAction";
  return {
    label: TOUR_RSVP_LABEL[key] ?? key,
    className:
      TOUR_RSVP_BADGE[key] ?? "bg-muted text-muted-foreground hover:bg-muted",
  };
}

/** Tours happen at the St. Pete campus, so every rendered tour time
 *  is pinned to Eastern — critically for NOTE BODIES, which are
 *  formatted on the SERVER (UTC in production) and were coming out
 *  hours off the actual slot ("5:00 PM" for a 1:00 PM tour). Pinning
 *  the client renders too keeps every surface saying the same time. */
export const TOUR_TIME_ZONE = "America/New_York";

/** "Mon, Aug 10 · 10:00 AM–11:00 AM" — the one way a tour's time is
 *  written everywhere (notes, invite description, UI rows). Always
 *  Eastern time, regardless of where it's rendered. */
export function tourWhenLabel(
  scheduledAt: number,
  durationMinutes: number
): string {
  const start = new Date(scheduledAt);
  const end = new Date(scheduledAt + (durationMinutes || 60) * 60_000);
  const yearOf = (d: Date) =>
    d.toLocaleDateString([], { timeZone: TOUR_TIME_ZONE, year: "numeric" });
  const day = start.toLocaleDateString([], {
    timeZone: TOUR_TIME_ZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: yearOf(start) === yearOf(new Date()) ? undefined : "numeric",
  });
  const t = (d: Date) =>
    d.toLocaleTimeString([], {
      timeZone: TOUR_TIME_ZONE,
      hour: "numeric",
      minute: "2-digit",
    });
  return `${day} · ${t(start)}–${t(end)}`;
}

/** Comms-log note body for a tour lifecycle event. `inviteSent`
 *  matters only for "scheduled"/"rescheduled" — it appends whether
 *  the parent actually got a calendar invite.
 *
 *  There is deliberately NO "booked" event anymore: the activity
 *  timeline renders every tour straight from the tours table, so a
 *  "booked via the website" note landed at the same timeline position
 *  as the tour marker saying the same thing. The remaining events all
 *  record a CHANGE the always-current marker can't show (the old time
 *  of a reschedule, when a cancel/no-show happened, a manual
 *  link/unlink). */
export function tourNoteBody(
  event:
    | "scheduled"
    | "linked"
    | "unlinked"
    | "rescheduled"
    | "completed"
    | "no_show"
    | "canceled",
  tour: XanoTour,
  inviteSent: boolean
): string {
  // Deliberately NO location in these lines: every tour is at the
  // same campus address, so repeating it in each comms-log entry was
  // pure noise. The address still rides on the calendar invite.
  const when = tourWhenLabel(tour.scheduled_at, tour.duration_minutes);
  switch (event) {
    case "linked":
      // Admin attached an existing (usually website-booked) tour to
      // this lead by hand — backfills the comms log the email
      // matcher couldn't write automatically.
      return (
        `Campus tour linked to this lead — ${when}.` +
        (tour.parent_email ? ` Booked by ${tour.parent_email}.` : "")
      );
    case "unlinked":
      // Written on the lead the tour was detached FROM, so its
      // timeline explains why the tour stopped appearing there.
      return (
        `Campus tour (${when}) unlinked from this lead.` +
        (tour.parent_email ? ` Booked by ${tour.parent_email}.` : "")
      );
    case "scheduled":
      return (
        `Campus tour scheduled for ${when}.` +
        (inviteSent && tour.parent_email
          ? ` Sent to ${tour.parent_email}.`
          : " No calendar invite sent.")
      );
    case "rescheduled":
      return (
        `Campus tour rescheduled to ${when}.` +
        (inviteSent && tour.parent_email
          ? ` Updated invite sent to ${tour.parent_email}.`
          : " No updated invite sent.")
      );
    case "completed":
      return `Campus tour completed (${when}).`;
    case "no_show":
      return `Campus tour no-show (was ${when}).`;
    case "canceled":
      return (
        `Campus tour canceled (was ${when}).` +
        (inviteSent && tour.parent_email
          ? ` Sent to ${tour.parent_email}.`
          : "")
      );
  }
}

/** True for the retired "Campus tour booked via the website…" notes.
 *  New bookings no longer write them (the tour marker at the same
 *  timeline position says the same thing — see `tourNoteBody`), and
 *  the triage-sheet timeline uses this to hide the historical ones
 *  already sitting in the notes table. They stay in the DB and in
 *  surfaces that have no tour markers (the dashboard activity feed),
 *  where they're the only trace of the booking. */
export function isRedundantTourBookingNote(note: {
  category?: string | null;
  body?: string | null;
}): boolean {
  return (
    note.category === "tour" &&
    (note.body ?? "").startsWith("Campus tour booked via the website")
  );
}

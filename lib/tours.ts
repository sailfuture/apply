import type { XanoTour } from "@/lib/xano";

/**
 * Shared vocabulary for scheduled campus tours — status labels the
 * UI renders and the note bodies the tour routes write into the
 * lead's comms log. One module so the API and the two tour surfaces
 * (lead sheet, Campus Visits tab) can't drift.
 */

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

/** "Mon, Aug 10 · 10:00 AM–11:00 AM" — the one way a tour's time is
 *  written everywhere (notes, invite description, UI rows). */
export function tourWhenLabel(
  scheduledAt: number,
  durationMinutes: number
): string {
  const start = new Date(scheduledAt);
  const end = new Date(scheduledAt + (durationMinutes || 60) * 60_000);
  const day = start.toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    year:
      start.getFullYear() === new Date().getFullYear()
        ? undefined
        : "numeric",
  });
  const t = (d: Date) =>
    d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `${day} · ${t(start)}–${t(end)}`;
}

/** Comms-log note body for a tour lifecycle event. `inviteSent`
 *  matters only for "scheduled"/"rescheduled" — it appends whether
 *  the parent actually got a calendar invite. */
export function tourNoteBody(
  event:
    | "scheduled"
    | "booked"
    | "rescheduled"
    | "completed"
    | "no_show"
    | "canceled",
  tour: XanoTour,
  inviteSent: boolean
): string {
  const when = tourWhenLabel(tour.scheduled_at, tour.duration_minutes);
  const where = tour.location ? ` at ${tour.location}` : "";
  switch (event) {
    case "booked":
      // Self-service: the family picked the slot on the website
      // booking page — Google already confirmed it to their email.
      return (
        `Campus tour booked via the website for ${when}${where}.` +
        (tour.parent_email
          ? ` Confirmed to ${tour.parent_email}.`
          : "")
      );
    case "scheduled":
      return (
        `Campus tour scheduled for ${when}${where}.` +
        (inviteSent && tour.parent_email
          ? ` Calendar invite sent to ${tour.parent_email}.`
          : " No calendar invite sent.")
      );
    case "rescheduled":
      return (
        `Campus tour rescheduled to ${when}${where}.` +
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
          ? ` Cancellation sent to ${tour.parent_email}.`
          : "")
      );
  }
}

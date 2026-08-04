import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import {
  xano,
  liveTourEventId,
  LEAD_NOTE_SOURCES,
  TOUR_EVENT_CANCELED_PREFIX,
  tourLeadFk,
  tourLeadScope,
  type LeadNoteSource,
  type XanoTour,
} from "@/lib/xano";
import { bumpLeadReachOut } from "@/lib/leads";
import {
  cancelTourEvent,
  isGoogleCalendarConfigured,
  updateTourEvent,
} from "@/lib/google-calendar";
import { tourInviteDescription, tourNoteBody } from "@/lib/tours";
import { writeTourNote } from "@/lib/tour-notes";

/**
 * One tour's lifecycle. PATCH takes an explicit `action` rather than
 * raw column writes so each transition carries its side effects
 * (Google Calendar propagation + comms-log note) exactly once:
 *
 *   - "complete" / "no_show" — outcome bookkeeping; the calendar
 *     event stays (it happened, or the slot was held).
 *   - "cancel"     — Google emails the cancellation, event id rolls
 *     to the `canceled:` sentinel (Xano can't null-clear).
 *   - "reschedule" — new `scheduled_at` (+ optional duration /
 *     location / notes); Google emails the update.
 *
 * Google failures degrade to a `warning` — the app row is the source
 * of truth and always reflects the admin's intent.
 */

const ACTIONS = [
  "complete",
  "no_show",
  "cancel",
  "reschedule",
  "link",
  "unlink",
] as const;
type TourAction = (typeof ACTIONS)[number];

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { admin } = await requireAdmin();
    const { id: idParam } = await params;
    const id = Number(idParam);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: "Invalid tour id" }, { status: 400 });
    }
    const body = await req.json();
    const action = body?.action as TourAction;
    if (!ACTIONS.includes(action)) {
      return NextResponse.json(
        { error: `action must be one of ${ACTIONS.join("|")}` },
        { status: 400 }
      );
    }

    const existing = await xano.tours.getById(id);
    const eventId = liveTourEventId(existing.google_event_id);
    let warning: string | undefined;
    let tour: XanoTour;
    let noteEvent: Parameters<typeof tourNoteBody>[0];
    // Did the PARENT actually get an email for this change? Only true
    // when there was a live Google event to update/cancel and the
    // call succeeded — a tour with no invite (Calendar unconfigured
    // when it was created) notifies nobody, and the log must not
    // claim otherwise.
    let notified = false;

    // The lead this tour was attached to BEFORE this request — the
    // link actions need it to write the "unlinked" note on the old
    // lead's timeline once the FK has moved.
    const previousLead = tourLeadScope(existing);

    if (action === "link" || action === "unlink") {
      // Attach, move, or detach a tour's lead. Re-linking works
      // because `tourLeadFk` writes 0 to the columns it isn't
      // setting, and a 0 genuinely clears a reference column
      // (verified live) — so a tour can never be claimed by two.
      let target: { source: LeadNoteSource; id: number } | null = null;
      if (action === "link") {
        const source = body?.leadSource as LeadNoteSource;
        const leadId = Number(body?.leadId);
        if (
          !LEAD_NOTE_SOURCES.includes(source) ||
          !Number.isFinite(leadId) ||
          leadId <= 0
        ) {
          return NextResponse.json(
            {
              error:
                "leadSource must be inquiry|camp|visit|tasco and leadId a positive number",
            },
            { status: 400 }
          );
        }
        target = { source, id: leadId };
      }
      if (!target && !previousLead) {
        return NextResponse.json(
          { error: "This tour isn't linked to a lead." },
          { status: 400 }
        );
      }

      tour = await xano.tours.update(id, tourLeadFk(target));
      const now = tourLeadScope(tour);
      const landed = target
        ? now?.source === target.source && now.id === target.id
        : now === null;
      if (!landed) {
        return NextResponse.json(
          {
            error:
              "The lead FK columns aren't wired on the registration_tours " +
              "Edit Record endpoint — expose all four as inputs in Xano.",
          },
          { status: 501 }
        );
      }

      // Tell the OLD lead's timeline the tour left, whether this was
      // a detach or a move to a different lead.
      const movedAway =
        previousLead &&
        (!target ||
          previousLead.source !== target.source ||
          previousLead.id !== target.id);
      if (movedAway) {
        const res = await writeTourNote({
          lead: previousLead,
          tour,
          event: "unlinked",
          admin,
        });
        if (!res.ok) warning = res.warning;
      }
      // A detach has no new lead to annotate; the response is enough.
      if (!target) {
        return NextResponse.json({ tour, warning });
      }
      noteEvent = "linked";
    } else if (action === "complete" || action === "no_show") {
      tour = await xano.tours.update(id, {
        status: action === "complete" ? "completed" : "no_show",
      });
      noteEvent = action === "complete" ? "completed" : "no_show";
    } else if (action === "cancel") {
      if (eventId && isGoogleCalendarConfigured()) {
        try {
          await cancelTourEvent(eventId);
          // Google emails the attendee the cancellation (sendUpdates=all).
          notified = Boolean(existing.parent_email);
        } catch (err) {
          console.error("[/api/admin/tours PATCH] Google cancel failed:", err);
          warning =
            "The tour was canceled here, but the Google Calendar event " +
            "couldn't be removed — delete it from the calendar by hand.";
        }
      } else {
        warning =
          "The tour was canceled here. It had no calendar invite, so " +
          "nobody was emailed — tell the family directly.";
      }
      tour = await xano.tours.update(id, {
        status: "canceled",
        // Preserve the id behind the sentinel (Xano drops ""), so the
        // row can't be mistaken for one with a live event.
        ...(eventId
          ? { google_event_id: `${TOUR_EVENT_CANCELED_PREFIX}${eventId}` }
          : {}),
      });
      noteEvent = "canceled";
    } else {
      // reschedule
      const scheduledAt = Number(body?.scheduled_at);
      if (!Number.isFinite(scheduledAt) || scheduledAt <= 0) {
        return NextResponse.json(
          { error: "scheduled_at (unix ms) is required to reschedule" },
          { status: 400 }
        );
      }
      const patch: Partial<XanoTour> = {
        scheduled_at: scheduledAt,
        status: "scheduled",
      };
      if (Number(body?.duration_minutes) > 0) {
        patch.duration_minutes = Number(body.duration_minutes);
      }
      if (typeof body?.location === "string" && body.location.trim()) {
        patch.location = body.location.trim();
      }
      if (typeof body?.notes === "string" && body.notes.trim()) {
        patch.notes = body.notes.trim();
      }
      tour = await xano.tours.update(id, patch);

      if (eventId && isGoogleCalendarConfigured()) {
        try {
          await updateTourEvent(eventId, {
            summary: `Campus tour — ${
              tour.student_name || tour.parent_name || "prospective family"
            }`,
            // Same standard copy the original invite carried — a
            // reschedule must not strip the address/parking blurb.
            description: tourInviteDescription(tour.notes),
            location: tour.location,
            startMs: tour.scheduled_at,
            endMs:
              tour.scheduled_at + (tour.duration_minutes || 60) * 60_000,
            attendeeEmail: tour.parent_email,
            attendeeName: tour.parent_name,
          });
          notified = Boolean(tour.parent_email);
        } catch (err) {
          console.error(
            "[/api/admin/tours PATCH] Google reschedule failed:",
            err
          );
          warning =
            "The tour was rescheduled here, but the Google Calendar event " +
            "couldn't be updated — fix the calendar by hand.";
        }
      }
      noteEvent = "rescheduled";
    }

    // Every transition is worth a line in the lead's comms log —
    // best-effort, the state change above is already real. Tours
    // imported from the website booking page can be UNLINKED (all
    // four lead FKs 0); those have no timeline to write to, so skip
    // rather than creating an orphan note.
    const lead = tourLeadScope(tour);
    if (lead) {
      const res = await writeTourNote({
        lead,
        tour,
        event: noteEvent,
        admin,
        notified,
      });
      // A note that couldn't be scoped is worth telling the admin
      // about — it means this action left no trace on the timeline.
      if (!res.ok && !warning) warning = res.warning;
      // Cancel/reschedule touch the family; outcome bookkeeping after
      // the fact isn't a fresh reach-out.
      if (noteEvent === "rescheduled" || noteEvent === "canceled") {
        await bumpLeadReachOut(lead.source, lead.id);
      }
    }

    return NextResponse.json({ tour, warning });
  } catch (err) {
    return handleAdminError(err);
  }
}

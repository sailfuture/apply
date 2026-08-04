import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import {
  xano,
  liveTourEventId,
  TOUR_EVENT_CANCELED_PREFIX,
  tourLeadFk,
  tourLeadScope,
  type XanoTour,
} from "@/lib/xano";
import { bumpLeadReachOut } from "@/lib/leads";
import {
  cancelTourEvent,
  isGoogleCalendarConfigured,
  updateTourEvent,
} from "@/lib/google-calendar";
import { tourNoteBody } from "@/lib/tours";

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

const ACTIONS = ["complete", "no_show", "cancel", "reschedule"] as const;
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

    if (action === "complete" || action === "no_show") {
      tour = await xano.tours.update(id, {
        status: action === "complete" ? "completed" : "no_show",
      });
      noteEvent = action === "complete" ? "completed" : "no_show";
    } else if (action === "cancel") {
      if (eventId && isGoogleCalendarConfigured()) {
        try {
          await cancelTourEvent(eventId);
        } catch (err) {
          console.error("[/api/admin/tours PATCH] Google cancel failed:", err);
          warning =
            "The tour was canceled here, but the Google Calendar event " +
            "couldn't be removed — delete it from the calendar by hand.";
        }
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
            description: tour.notes,
            location: tour.location,
            startMs: tour.scheduled_at,
            endMs:
              tour.scheduled_at + (tour.duration_minutes || 60) * 60_000,
            attendeeEmail: tour.parent_email,
            attendeeName: tour.parent_name,
          });
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
    // four lead FKs null); those have no timeline to write to, so
    // skip rather than creating an orphan note.
    const lead = tourLeadScope(tour);
    if (!lead) {
      return NextResponse.json({ tour, warning });
    }
    try {
      await xano.adminNotes.create({
        registration_families_id: 0,
        registration_students_id: null,
        registration_school_years_id: null,
        // Same four FK column names as the tour row itself.
        ...tourLeadFk(lead),
        registration_student_registration_progress_id: null,
        registration_family_application_progress_id: null,
        author_email: admin.email,
        author_name: admin.name,
        body: tourNoteBody(noteEvent, tour, warning === undefined),
        category: "tour",
        is_pinned: false,
        section: null,
        is_shared_with_parent: false,
      });
      // Cancel/reschedule touch the family; outcome bookkeeping after
      // the fact isn't a fresh reach-out.
      if (noteEvent === "rescheduled" || noteEvent === "canceled") {
        await bumpLeadReachOut(lead.source, lead.id);
      }
    } catch (err) {
      console.error("[/api/admin/tours PATCH] activity note failed:", err);
    }

    return NextResponse.json({ tour, warning });
  } catch (err) {
    return handleAdminError(err);
  }
}

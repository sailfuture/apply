import { NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import {
  xano,
  TOUR_EVENT_CANCELED_PREFIX,
  tourLeadFk,
  tourLeadScope,
  type LeadNoteSource,
  type XanoTour,
} from "@/lib/xano";
import { bumpLeadReachOut } from "@/lib/leads";
import {
  impersonatedEmail,
  isGoogleCalendarConfigured,
  listCalendarEvents,
  type CalendarEvent,
} from "@/lib/google-calendar";
import { tourNoteBody } from "@/lib/tours";

/**
 * Pull website tour bookings off Google Calendar into the app.
 *
 * sailfutureacademy.org/tour is a Google Calendar APPOINTMENT
 * SCHEDULE ("SailFuture Academy: School Tour") — every booking lands
 * as an event on the schedule owner's calendar with the booker as an
 * attendee, and Google already emails/updates them. This route makes
 * the app agree with that calendar:
 *
 *   1. IMPORT — booking-page events (summary matches
 *      GOOGLE_TOUR_BOOKING_MATCH, default "tour") with an external
 *      attendee and no matching `registration_tours` row become tour
 *      rows. The booker's email is matched against all four lead
 *      sources; matched imports get the comms-log note + reach-out
 *      bump, unmatched ones import unlinked (lead_id 0) and still
 *      show on the Tours tab.
 *   2. RSVP refresh — existing scheduled tours pick up their
 *      attendee's current responseStatus from the same fetch.
 *   3. CANCELLATION detection — a tour whose Google event is now
 *      status "cancelled" (parent canceled from their invite, or
 *      staff deleted it in Google) is marked canceled here too.
 *
 * Idempotent by `google_event_id` — safe to run on every Tours-tab
 * mount. POST because it writes; fires-and-forgets from the client.
 */
export const dynamic = "force-dynamic";

export interface TourSyncResult {
  configured: boolean;
  imported: number;
  matched: number;
  unmatched: number;
  rsvpUpdated: number;
  canceled: number;
}

// How far the sync looks. Backwards covers bookings made while nobody
// opened the app; forwards covers how far ahead the booking page
// offers slots.
const LOOKBACK_MS = 30 * 86_400_000;
const LOOKAHEAD_MS = 120 * 86_400_000;

/** Summary filter for booking-page events — the schedule title is
 *  "SailFuture Academy: School Tour", so the default "tour" matches.
 *  Overridable in case the schedule is ever renamed. */
function summaryMatcher(): string {
  return (process.env.GOOGLE_TOUR_BOOKING_MATCH || "tour").toLowerCase();
}

/** The booker on an appointment-schedule event: first attendee who
 *  isn't the host, a room, or a school address. */
function externalAttendee(event: CalendarEvent, host: string) {
  const hostLower = host.toLowerCase();
  return (
    event.attendees.find((a) => {
      const email = a.email.toLowerCase();
      if (!email || a.resource || a.organizer) return false;
      if (email === hostLower) return false;
      return !email.endsWith("@sailfuture.org");
    }) ?? null
  );
}

export async function POST() {
  try {
    const { admin } = await requireAdmin();
    if (!isGoogleCalendarConfigured()) {
      return NextResponse.json({
        configured: false,
        imported: 0,
        matched: 0,
        unmatched: 0,
        rsvpUpdated: 0,
        canceled: 0,
      } satisfies TourSyncResult);
    }

    const now = Date.now();
    const [events, tours, inquiries, camps, waivers, tascos] =
      await Promise.all([
        listCalendarEvents(now - LOOKBACK_MS, now + LOOKAHEAD_MS),
        xano.tours.getAll(),
        xano.inquiries.getAll().catch(() => []),
        xano.summerCamp.getAll().catch(() => []),
        xano.websiteWaivers.getAll().catch(() => []),
        xano.tascoSummerVisits.getAll().catch(() => []),
      ]);

    // Every event id the app already knows — live AND canceled
    // (a canceled tour must not re-import as a fresh one).
    const knownEventIds = new Set<string>();
    const toursByEventId = new Map<string, XanoTour>();
    for (const t of tours) {
      const raw = t.google_event_id ?? "";
      const id = raw.startsWith(TOUR_EVENT_CANCELED_PREFIX)
        ? raw.slice(TOUR_EVENT_CANCELED_PREFIX.length)
        : raw;
      if (!id) continue;
      knownEventIds.add(id);
      toursByEventId.set(id, t);
    }

    // Booker-email → newest lead across the four sources. Newest wins
    // because a family can appear in several (camp last year, inquiry
    // this year) and the recent record is the active pipeline row.
    const leadByEmail = new Map<
      string,
      { source: LeadNoteSource; id: number; createdAt: number }
    >();
    const index = (
      source: LeadNoteSource,
      rows: Array<{ id: number; created_at: number }>,
      email: (row: never) => string
    ) => {
      for (const row of rows) {
        const key = email(row as never).trim().toLowerCase();
        if (!key) continue;
        const prev = leadByEmail.get(key);
        if (!prev || row.created_at > prev.createdAt) {
          leadByEmail.set(key, {
            source,
            id: row.id,
            createdAt: row.created_at,
          });
        }
      }
    };
    index("inquiry", inquiries, (i: (typeof inquiries)[number]) => i.primary_email ?? "");
    index("camp", camps, (c: (typeof camps)[number]) => c.primary_email ?? "");
    index("visit", waivers, (w: (typeof waivers)[number]) => w.parent_email ?? "");
    index("tasco", tascos, (t: (typeof tascos)[number]) => t.parent_email ?? "");

    const host = impersonatedEmail();
    const match = summaryMatcher();
    const result: TourSyncResult = {
      configured: true,
      imported: 0,
      matched: 0,
      unmatched: 0,
      rsvpUpdated: 0,
      canceled: 0,
    };

    for (const event of events) {
      const existing = toursByEventId.get(event.id);

      // 3. Google-side cancellation → mirror it. Only for tours still
      // scheduled; completed/no-show outcomes are history, and
      // already-canceled rows are done.
      if (event.status === "cancelled") {
        if (existing && existing.status === "scheduled") {
          const tour = await xano.tours.update(existing.id, {
            status: "canceled",
            google_event_id: `${TOUR_EVENT_CANCELED_PREFIX}${event.id}`,
          });
          result.canceled++;
          await writeTourNote(tour, "canceled", admin, false);
        }
        continue;
      }

      // 2. RSVP refresh for known, still-scheduled tours.
      if (existing) {
        if (existing.status === "scheduled" && existing.parent_email) {
          const attendee = event.attendees.find(
            (a) =>
              a.email.toLowerCase() ===
              existing.parent_email.trim().toLowerCase()
          );
          if (
            attendee?.responseStatus &&
            attendee.responseStatus !== existing.rsvp_status
          ) {
            await xano.tours.update(existing.id, {
              rsvp_status: attendee.responseStatus,
            });
            result.rsvpUpdated++;
          }
        }
        continue;
      }

      // 1. Import new booking-page events. Timed, summary matches the
      // schedule title, and there's a real external booker.
      if (!event.startMs || !event.endMs) continue;
      if (!event.summary.toLowerCase().includes(match)) continue;
      const booker = externalAttendee(event, host);
      if (!booker) continue;

      const lead = leadByEmail.get(booker.email.toLowerCase()) ?? null;
      const durationMinutes = Math.max(
        15,
        Math.round((event.endMs - event.startMs) / 60_000)
      );
      const tour = await xano.tours.create({
        ...tourLeadFk(lead),
        scheduled_at: event.startMs,
        duration_minutes: durationMinutes,
        location: event.location,
        // Booking-form answers ride in the event description; keep a
        // trimmed copy so the Tours tab shows what the family wrote.
        notes: event.description.trim().slice(0, 500),
        status: "scheduled",
        google_event_id: event.id,
        rsvp_status: booker.responseStatus || "accepted",
        parent_name: booker.displayName || booker.email,
        parent_email: booker.email,
        parent_phone: "",
        student_name: "",
        author_email: "",
        author_name: "Website booking",
      });
      result.imported++;
      if (lead) {
        // Guard against a half-wired Add Record endpoint the same way
        // the POST route does: a matched booking whose FK didn't echo
        // back would look "unlinked" forever while reporting success.
        if (!tourLeadScope(tour)) {
          await xano.tours.delete(tour.id).catch(() => {});
          throw new Error(
            "The `registration_tours` Add Record endpoint isn't declaring " +
              "the lead FK columns — expose all four as inputs in Xano."
          );
        }
        result.matched++;
        await writeTourNote(tour, "booked", admin, true);
        await bumpLeadReachOut(lead.source, lead.id);
      } else {
        result.unmatched++;
      }
    }

    return NextResponse.json(result);
  } catch (err) {
    return handleAdminError(err);
  }
}

/** Comms-log note for a synced tour — only when the tour is linked to
 *  a real lead (an unmatched booking has no timeline to land on).
 *  Best-effort like every other tour note. */
async function writeTourNote(
  tour: XanoTour,
  event: "booked" | "canceled",
  admin: { email: string; name: string },
  inviteSent: boolean
): Promise<void> {
  const lead = tourLeadScope(tour);
  if (!lead) return;
  try {
    await xano.adminNotes.create({
      registration_families_id: 0,
      registration_students_id: null,
      registration_school_years_id: null,
      // Same four FK column names as the tour row itself.
      ...tourLeadFk(lead),
      registration_student_registration_progress_id: null,
      registration_family_application_progress_id: null,
      // Attributed to the booking pipeline, not whichever admin
      // happened to open the Tours tab and trigger the sync.
      author_email: admin.email,
      author_name: event === "booked" ? "Website booking" : admin.name,
      body: tourNoteBody(event, tour, inviteSent),
      category: "tour",
      is_pinned: false,
      section: null,
      is_shared_with_parent: false,
    });
  } catch (err) {
    console.error("[/api/admin/tours/sync] activity note failed:", err);
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import {
  xano,
  LEAD_NOTE_SOURCES,
  tourLeadFk,
  tourLeadScope,
  type LeadNoteSource,
  type XanoTour,
} from "@/lib/xano";
import { bumpLeadReachOut } from "@/lib/leads";
import {
  createTourEvent,
  isGoogleCalendarConfigured,
} from "@/lib/google-calendar";
import {
  TOUR_DEFAULT_LOCATION,
  tourInviteDescription,
  tourNoteBody,
} from "@/lib/tours";

/**
 * Scheduled campus tours (`registration_tours`).
 *
 * GET  ?leadSource=&leadId=  — that lead's tours (or every tour when
 *      unscoped, for the Campus Visits → Tours tab). Also reports
 *      whether Google Calendar sync is configured so the UI can say
 *      "invite will be emailed" vs "logged app-side only".
 *
 * POST — schedule a tour. Three effects, in order:
 *   1. The `registration_tours` row (the source of truth — created
 *      first so a Google/notes failure can't lose the tour).
 *   2. Best-effort Google Calendar event on the staff calendar with
 *      the parent as attendee — GOOGLE emails the invite and tracks
 *      the RSVP. Failure degrades to a warning, not an error.
 *   3. An admin note on the lead (category "tour") so the tour shows
 *      up in the lead's comms log and the lead-activity stream, plus
 *      the standard `last_reach_out` bump.
 */
export const dynamic = "force-dynamic";

export interface ToursResponse {
  tours: XanoTour[];
  calendarConfigured: boolean;
}

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const sourceParam = req.nextUrl.searchParams.get("leadSource");
    const idParam = req.nextUrl.searchParams.get("leadId");

    // Rows without a scheduled time aren't tours (e.g. blank rows
    // created while wiring the table in Xano) — hide, don't render.
    let tours = (await xano.tours.getAll()).filter(
      (t) => Number(t.scheduled_at) > 0
    );
    if (sourceParam || idParam) {
      const leadId = Number(idParam);
      if (
        !LEAD_NOTE_SOURCES.includes(sourceParam as LeadNoteSource) ||
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
      tours = tours.filter((t) => {
        const lead = tourLeadScope(t);
        return lead?.source === sourceParam && lead.id === leadId;
      });
    }
    tours.sort((a, b) => b.scheduled_at - a.scheduled_at);

    return NextResponse.json({
      tours,
      calendarConfigured: isGoogleCalendarConfigured(),
    } satisfies ToursResponse);
  } catch (err) {
    return handleAdminError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { admin } = await requireAdmin();
    const body = await req.json();

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

    const scheduledAt = Number(body?.scheduled_at);
    if (!Number.isFinite(scheduledAt) || scheduledAt <= 0) {
      return NextResponse.json(
        { error: "scheduled_at (unix ms) is required" },
        { status: 400 }
      );
    }
    const durationMinutes = Number(body?.duration_minutes) || 60;

    const str = (v: unknown): string =>
      typeof v === "string" ? v.trim() : "";
    // Default to the campus address so the invite always has a
    // mappable location, even when the field was cleared.
    const location = str(body?.location) || TOUR_DEFAULT_LOCATION;
    const notes = str(body?.notes);
    const parentName = str(body?.parent_name);
    const parentEmail = str(body?.parent_email);
    const parentPhone = str(body?.parent_phone);
    const studentName = str(body?.student_name);

    // 1. The tour row — first, so it can't be lost to a sync failure.
    let tour: XanoTour;
    try {
      tour = await xano.tours.create({
        ...tourLeadFk({ source, id: leadId }),
        scheduled_at: scheduledAt,
        duration_minutes: durationMinutes,
        location,
        notes,
        status: "scheduled",
        google_event_id: "",
        rsvp_status: "",
        parent_name: parentName,
        parent_email: parentEmail,
        parent_phone: parentPhone,
        student_name: studentName,
        author_email: admin.email,
        author_name: admin.name,
      });
    } catch (err) {
      // The table not existing yet is the most likely failure while
      // the Xano side is being wired — say exactly what to build
      // instead of surfacing a bare 404.
      if (err instanceof Error && /Xano error 404/.test(err.message)) {
        return NextResponse.json(
          {
            error:
              "Tours aren't wired in Xano yet: create the `registration_tours` " +
              "table with the standard CRUD endpoints (see the tour feature notes).",
          },
          { status: 501 }
        );
      }
      throw err;
    }

    // Xano silently DROPS inputs its Add Record endpoint doesn't
    // declare — a half-wired table would save an unusable row while
    // reporting success. Verify the load-bearing fields echoed back
    // (the lead FK column and the time); if not, remove the orphan
    // and say what to wire.
    const linked = tourLeadScope(tour);
    if (
      linked?.source !== source ||
      linked.id !== leadId ||
      Number(tour.scheduled_at) !== scheduledAt
    ) {
      await xano.tours.delete(tour.id).catch((err) => {
        console.error(
          "[/api/admin/tours POST] failed to clean up half-saved tour:",
          err
        );
      });
      return NextResponse.json(
        {
          error:
            "The `registration_tours` Add Record endpoint isn't declaring all " +
            "inputs — expose every column (the four lead FK columns, " +
            "scheduled_at, …) as an input in Xano.",
        },
        { status: 501 }
      );
    }

    // 2. Google Calendar event + emailed invite — best-effort.
    let warning: string | undefined;
    if (isGoogleCalendarConfigured()) {
      try {
        const event = await createTourEvent({
          summary: `Campus tour — ${studentName || parentName || "prospective family"}`,
          description: tourInviteDescription(notes),
          location,
          startMs: scheduledAt,
          endMs: scheduledAt + durationMinutes * 60_000,
          attendeeEmail: parentEmail,
          attendeeName: parentName,
        });
        tour = await xano.tours.update(tour.id, {
          google_event_id: event.id,
          rsvp_status: parentEmail ? "needsAction" : "",
        });
      } catch (err) {
        console.error("[/api/admin/tours POST] Google Calendar sync failed:", err);
        warning =
          "The tour was saved, but the Google Calendar invite couldn't be " +
          "created — add it to the calendar by hand or retry from the Tours tab.";
      }
      if (!warning && !parentEmail) {
        warning =
          "The tour is on the calendar, but this lead has no email on file — " +
          "no invite was sent to the parent.";
      }
    } else {
      warning =
        "The tour was logged, but Google Calendar sync isn't configured yet — " +
        "no invite was sent.";
    }

    // 3. Comms-log note + reach-out bump — the tour IS an outreach.
    try {
      await xano.adminNotes.create({
        registration_families_id: 0,
        registration_students_id: null,
        registration_school_years_id: null,
        // Same four FK column names as the tour row itself.
        ...tourLeadFk({ source, id: leadId }),
        registration_student_registration_progress_id: null,
        registration_family_application_progress_id: null,
        author_email: admin.email,
        author_name: admin.name,
        body: tourNoteBody("scheduled", tour, warning === undefined),
        category: "tour",
        is_pinned: false,
        section: null,
        is_shared_with_parent: false,
      });
      await bumpLeadReachOut(source, leadId);
    } catch (err) {
      // The tour + invite are real even if the log write hiccuped.
      console.error("[/api/admin/tours POST] activity note failed:", err);
    }

    return NextResponse.json({ tour, warning }, { status: 201 });
  } catch (err) {
    return handleAdminError(err);
  }
}

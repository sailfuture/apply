import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { UNLIMITED_PARENT_SPOTS } from "@/lib/school-calendar";
import { pushSchoolEventToGoogle } from "@/lib/school-event-sync";
import { xano } from "@/lib/xano";

/**
 * Create a school-calendar event — pinned to one calendar day.
 *
 *   POST { school_calendar_id, title, description?, location?,
 *          start_time?, end_time?, mandatory?,
 *          parent_volunteer_hours?, volunteer_hour_total? }
 *
 * `start_time`/`end_time` are unix-ms (0 = not set / all-day).
 * `volunteer_hour_total` only means anything when
 * `parent_volunteer_hours` is on, but we store whatever was sent so a
 * toggled-off event keeps its configured hours.
 *
 * After the Xano write the event is pushed to the shared school
 * Google Calendar (best-effort — a Google failure attaches `warning`
 * to the 201, never fails the create).
 */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 }
      );
    }

    const dayId = Number(body.school_calendar_id);
    if (!Number.isFinite(dayId) || dayId <= 0) {
      return NextResponse.json(
        { error: "school_calendar_id is required" },
        { status: 400 }
      );
    }
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) {
      return NextResponse.json(
        { error: "Event title is required" },
        { status: 400 }
      );
    }

    const created = await xano.schoolCalendarEvents.create({
      school_calendar_id: dayId,
      title,
      description:
        typeof body.description === "string" ? body.description.trim() : "",
      location:
        typeof body.location === "string" ? body.location.trim() : "",
      start_time: coerceMs(body.start_time),
      end_time: coerceMs(body.end_time),
      mandatory: body.mandatory === true,
      parent_volunteer_hours: body.parent_volunteer_hours === true,
      volunteer_hour_total: coerceHours(body.volunteer_hour_total),
      // Parent RSVP capacity — 0 = sign-ups not offered.
      parent_spots: coerceSpots(body.parent_spots),
      // Event needs — one per line; rendered as a list to parents.
      needs: typeof body.needs === "string" ? body.needs.trim() : "",
      color: coerceColor(body.color),
    });

    // Mirror onto the school Google Calendar. The day's date (for
    // all-day placement) comes from the day table — resolved here
    // rather than trusted from the client.
    const day = (await xano.schoolCalendar.getAll().catch(() => [])).find(
      (d) => d.id === dayId
    );
    const sync = await pushSchoolEventToGoogle(created, day?.date);
    return NextResponse.json(
      {
        ...created,
        warning:
          sync.status === "failed"
            ? `Event saved, but it couldn't be pushed to the school Google Calendar: ${sync.error}`
            : undefined,
      },
      { status: 201 }
    );
  } catch (err) {
    return handleAdminError(err);
  }
}

/** Unix-ms or 0 when absent/invalid — Xano's int input rejects null. */
function coerceMs(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Non-negative hour count (halves allowed), 0 fallback. */
function coerceHours(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Whole-number RSVP capacity, capped at 500. 0 = sign-ups closed,
 * -1 (`UNLIMITED_PARENT_SPOTS`) = sign-ups open with no cap — see the
 * matching note on the PATCH route: the sentinel has to survive the
 * round trip or an uncapped event can't be created.
 */
function coerceSpots(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  if (n === UNLIMITED_PARENT_SPOTS) return UNLIMITED_PARENT_SPOTS;
  return n > 0 ? Math.min(Math.round(n), 500) : 0;
}

/** Known event-category color slugs; anything else stores as "". */
const EVENT_COLOR_SLUGS = new Set([
  "sky",
  "emerald",
  "violet",
  "amber",
  "rose",
  "orange",
]);
function coerceColor(v: unknown): string {
  return typeof v === "string" && EVENT_COLOR_SLUGS.has(v.trim())
    ? v.trim()
    : "";
}

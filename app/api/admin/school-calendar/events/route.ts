import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
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
    });
    return NextResponse.json(created, { status: 201 });
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

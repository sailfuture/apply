import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import type {
  XanoSchoolCalendarDay,
  XanoSchoolCalendarEvent,
} from "@/lib/xano";

/**
 * School calendar for one year — every day row plus the events pinned
 * to those days, in a single round trip for the Settings calendar page.
 *
 *   GET /api/admin/school-calendar?yearId=Y
 *     → { days, events }   (days date-ascending; events only for the
 *                            returned days)
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const yearId = Number(req.nextUrl.searchParams.get("yearId"));
    if (!Number.isFinite(yearId) || yearId <= 0) {
      return NextResponse.json(
        { error: "yearId is required" },
        { status: 400 }
      );
    }

    const [daysResult, eventsResult] = await Promise.allSettled([
      xano.schoolCalendar.getByYear(yearId),
      xano.schoolCalendarEvents.getAll(),
    ]);
    if (daysResult.status === "rejected") {
      console.error(
        "[/api/admin/school-calendar] failed to load days:",
        daysResult.reason
      );
    }
    if (eventsResult.status === "rejected") {
      console.error(
        "[/api/admin/school-calendar] failed to load events:",
        eventsResult.reason
      );
    }
    const days =
      daysResult.status === "fulfilled" ? daysResult.value : [];
    const allEvents =
      eventsResult.status === "fulfilled" ? eventsResult.value : [];

    days.sort((a, b) => a.date.localeCompare(b.date));
    const dayIds = new Set(days.map((d) => d.id));
    const events = allEvents.filter((e) =>
      dayIds.has(Number(e.school_calendar_id))
    );

    return NextResponse.json({ days, events } satisfies SchoolCalendarResponse);
  } catch (err) {
    return handleAdminError(err);
  }
}

export interface SchoolCalendarResponse {
  days: XanoSchoolCalendarDay[];
  events: XanoSchoolCalendarEvent[];
}

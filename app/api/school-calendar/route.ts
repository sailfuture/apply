import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { xano } from "@/lib/xano";
import type {
  XanoAcademicTerm,
  XanoSchoolCalendarDay,
  XanoSchoolCalendarEvent,
} from "@/lib/xano";

/**
 * Parent-facing school calendar for one year — read-only counterpart
 * of /api/admin/school-calendar. Any signed-in family can view the
 * calendar; there's nothing family-specific in it.
 *
 *   GET /api/school-calendar?yearId=Y
 *     → { days, events, terms }
 *       (days date-ascending; events only for the returned days;
 *        terms sorted by start date with undated rows last)
 */
export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const yearId = Number(req.nextUrl.searchParams.get("yearId"));
  if (!Number.isFinite(yearId) || yearId <= 0) {
    return NextResponse.json({ error: "yearId is required" }, { status: 400 });
  }

  const [daysResult, eventsResult, termsResult] = await Promise.allSettled([
    xano.schoolCalendar.getByYear(yearId),
    xano.schoolCalendarEvents.getAll(),
    xano.academicTerms.getByYear(yearId),
  ]);
  for (const [label, r] of [
    ["days", daysResult],
    ["events", eventsResult],
    ["terms", termsResult],
  ] as const) {
    if (r.status === "rejected") {
      console.error(`[/api/school-calendar] failed to load ${label}:`, r.reason);
    }
  }
  const days = daysResult.status === "fulfilled" ? daysResult.value : [];
  const allEvents =
    eventsResult.status === "fulfilled" ? eventsResult.value : [];
  const terms = termsResult.status === "fulfilled" ? termsResult.value : [];

  days.sort((a, b) => a.date.localeCompare(b.date));
  const dayIds = new Set(days.map((d) => d.id));
  const events = allEvents.filter((e) =>
    dayIds.has(Number(e.school_calendar_id))
  );
  terms.sort(
    (a, b) =>
      (a.start_date ?? "9999-99-99").localeCompare(
        b.start_date ?? "9999-99-99"
      ) || a.term_name.localeCompare(b.term_name)
  );

  return NextResponse.json({
    days,
    events,
    terms,
  } satisfies ParentSchoolCalendarResponse);
}

export interface ParentSchoolCalendarResponse {
  days: XanoSchoolCalendarDay[];
  events: XanoSchoolCalendarEvent[];
  terms: XanoAcademicTerm[];
}

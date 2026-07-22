import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import type {
  XanoAcademicSeason,
  XanoAcademicTerm,
  XanoSchoolCalendarDay,
  XanoSchoolCalendarEvent,
} from "@/lib/xano";

/**
 * School calendar for one year — every day row, the events pinned to
 * those days, and the year's academic terms + seasons, in a single
 * round trip for the Settings calendar page.
 *
 *   GET /api/admin/school-calendar?yearId=Y
 *     → { days, events, terms, seasons }
 *       (days date-ascending; events only for the returned days;
 *        terms sorted by start date with undated rows last)
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

    const [daysResult, eventsResult, termsResult, seasonsResult] =
      await Promise.allSettled([
        xano.schoolCalendar.getByYear(yearId),
        xano.schoolCalendarEvents.getAll(),
        xano.academicTerms.getByYear(yearId),
        xano.academicSeasons.getByYear(yearId),
      ]);
    for (const [label, r] of [
      ["days", daysResult],
      ["events", eventsResult],
      ["terms", termsResult],
      ["seasons", seasonsResult],
    ] as const) {
      if (r.status === "rejected") {
        console.error(
          `[/api/admin/school-calendar] failed to load ${label}:`,
          r.reason
        );
      }
    }
    const days =
      daysResult.status === "fulfilled" ? daysResult.value : [];
    const allEvents =
      eventsResult.status === "fulfilled" ? eventsResult.value : [];
    const terms =
      termsResult.status === "fulfilled" ? termsResult.value : [];
    const seasons =
      seasonsResult.status === "fulfilled" ? seasonsResult.value : [];

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
    seasons.sort((a, b) => a.id - b.id);

    return NextResponse.json({
      days,
      events,
      terms,
      seasons,
    } satisfies SchoolCalendarResponse);
  } catch (err) {
    return handleAdminError(err);
  }
}

export interface SchoolCalendarResponse {
  days: XanoSchoolCalendarDay[];
  events: XanoSchoolCalendarEvent[];
  terms: XanoAcademicTerm[];
  seasons: XanoAcademicSeason[];
}

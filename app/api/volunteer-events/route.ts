import { auth, currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { xano } from "@/lib/xano";

/**
 * Upcoming sign-up events for the parent volunteer page.
 *
 *   GET /api/volunteer-events?yearId=Y → { events: [...] }
 *
 * An event appears when admin gave it parent sign-up capacity
 * (`parent_spots > 0`) and its calendar day hasn't passed. Each row
 * carries the live spot math (total / taken) plus the family's own
 * RSVP so the page can render Sign up vs Edit states without a
 * second fetch.
 */
export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const familyId =
    (user.publicMetadata.registration_families_id as number | undefined) ?? 0;

  const yearId = Number(req.nextUrl.searchParams.get("yearId"));
  if (!Number.isFinite(yearId) || yearId <= 0) {
    return NextResponse.json({ error: "yearId is required" }, { status: 400 });
  }

  const [daysR, eventsR, rsvpsR] = await Promise.allSettled([
    xano.schoolCalendar.getByYear(yearId),
    xano.schoolCalendarEvents.getAll(),
    xano.eventRsvps.getAll(),
  ]);
  if (daysR.status === "rejected" || eventsR.status === "rejected") {
    const reason =
      daysR.status === "rejected"
        ? daysR.reason
        : eventsR.status === "rejected"
          ? eventsR.reason
          : null;
    console.error("[/api/volunteer-events] calendar load failed:", reason);
    return NextResponse.json(
      { error: "Couldn't load events, please retry" },
      { status: 503 }
    );
  }
  // RSVPs degrade to [] (table not created yet) — events still list,
  // sign-up attempts will surface the real error.
  const rsvps = rsvpsR.status === "fulfilled" ? rsvpsR.value : [];
  if (rsvpsR.status === "rejected") {
    console.error("[/api/volunteer-events] rsvp load failed:", rsvpsR.reason);
  }

  const dateByDay = new Map(daysR.value.map((d) => [d.id, d.date]));
  const todayIso = easternTodayIso();

  const takenByEvent = new Map<number, number>();
  for (const r of rsvps) {
    const eid = Number(r.school_calendar_events_id);
    takenByEvent.set(
      eid,
      (takenByEvent.get(eid) ?? 0) + (Number(r.spots) || 0)
    );
  }

  const events = eventsR.value
    .filter((e) => (e.parent_spots ?? 0) > 0)
    .map((e) => ({ e, date: dateByDay.get(Number(e.school_calendar_id)) }))
    .filter(
      (x): x is { e: (typeof eventsR.value)[number]; date: string } =>
        typeof x.date === "string" && x.date >= todayIso
    )
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        (a.e.start_time ?? 0) - (b.e.start_time ?? 0)
    )
    .map(({ e, date }) => {
      const mine =
        familyId > 0
          ? (rsvps.find(
              (r) =>
                Number(r.school_calendar_events_id) === e.id &&
                Number(r.registration_families_id) === familyId
            ) ?? null)
          : null;
      return {
        id: e.id,
        date,
        title: e.title,
        description: e.description ?? "",
        location: e.location ?? "",
        start_time: e.start_time ?? 0,
        end_time: e.end_time ?? 0,
        color: e.color ?? "",
        mandatory: e.mandatory === true,
        parent_volunteer_hours: e.parent_volunteer_hours === true,
        volunteer_hour_total: e.volunteer_hour_total ?? 0,
        needs: (e.needs ?? "").trim(),
        spots_total: e.parent_spots ?? 0,
        spots_taken: takenByEvent.get(e.id) ?? 0,
        my_rsvp: mine
          ? { spots: Number(mine.spots) || 0, comment: (mine.comment ?? "").trim() }
          : null,
      };
    });

  return NextResponse.json({ events });
}

export type VolunteerEventsResponse = {
  events: ParentVolunteerEvent[];
};

export interface ParentVolunteerEvent {
  id: number;
  date: string;
  title: string;
  description: string;
  location: string;
  start_time: number;
  end_time: number;
  color: string;
  mandatory: boolean;
  parent_volunteer_hours: boolean;
  volunteer_hour_total: number;
  /** Raw one-per-line needs text — split client-side with parseNeeds. */
  needs: string;
  spots_total: number;
  spots_taken: number;
  my_rsvp: { spots: number; comment: string } | null;
}

/** Today as YYYY-MM-DD in the school's timezone (US Eastern) — the
 *  server may run in UTC, and a date comparison in server-local time
 *  would flip events to "past" up to 5 hours early. */
function easternTodayIso(): string {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  });
}

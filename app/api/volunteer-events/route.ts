import { auth, currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { xano } from "@/lib/xano";
import {
  eventItemAvailability,
  isSignUpEvent,
  isUnlimitedSpots,
  type EventItemAvailability,
} from "@/lib/school-calendar";

/**
 * Sign-up events for the parent volunteer page.
 *
 *   GET /api/volunteer-events?yearId=Y → { events: [...], past: [...] }
 *
 * An event appears when admin opened it for parent sign-up — either
 * with a capacity or with no limit at all (see `isSignUpEvent`).
 * `events` is everything from today forward, soonest first; `past` is
 * everything before today, most recent first, so the page can show a
 * family what they've already signed up for. Each row carries the live spot math
 * (total / taken) plus the family's own RSVP so the page can render
 * Sign up vs Edit states without a second fetch.
 *
 * `unlimited` is surfaced explicitly so the client never has to know
 * about the `-1` sentinel; when it's true, `spots_total` is
 * meaningless and only `spots_taken` is worth showing.
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

  const [daysR, eventsR, rsvpsR, itemsR, claimsR] = await Promise.allSettled([
    xano.schoolCalendar.getByYear(yearId),
    xano.schoolCalendarEvents.getAll(),
    xano.eventRsvps.getAll(),
    xano.eventItems.getAll(),
    xano.eventItemClaims.getAll(),
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
  // Items + claims degrade to [] the same way — the tables are newer
  // than the events themselves, and an event with no items simply
  // shows no "can you bring anything?" list.
  const items = itemsR.status === "fulfilled" ? itemsR.value : [];
  const claims = claimsR.status === "fulfilled" ? claimsR.value : [];
  if (itemsR.status === "rejected") {
    console.error("[/api/volunteer-events] item load failed:", itemsR.reason);
  }
  if (claimsR.status === "rejected") {
    console.error("[/api/volunteer-events] claim load failed:", claimsR.reason);
  }
  const itemsByEvent = new Map<number, typeof items>();
  for (const it of items) {
    const eid = Number(it.school_calendar_events_id);
    const list = itemsByEvent.get(eid) ?? [];
    list.push(it);
    itemsByEvent.set(eid, list);
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

  const dated = eventsR.value
    .filter((e) => isSignUpEvent(e.parent_spots))
    .map((e) => ({ e, date: dateByDay.get(Number(e.school_calendar_id)) }))
    .filter(
      (x): x is { e: (typeof eventsR.value)[number]; date: string } =>
        typeof x.date === "string"
    );

  const shape = ({
    e,
    date,
  }: {
    e: (typeof eventsR.value)[number];
    date: string;
  }): ParentVolunteerEvent => {
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
      // Per-item claim math, joined across every family so the dialog
      // can show "2 of 4 claimed" without a second fetch.
      items: eventItemAvailability(
        itemsByEvent.get(e.id) ?? [],
        claims,
        familyId
      ),
      spots_total: e.parent_spots ?? 0,
      spots_taken: takenByEvent.get(e.id) ?? 0,
      unlimited: isUnlimitedSpots(e.parent_spots),
      my_rsvp: mine
        ? {
            spots: Number(mine.spots) || 0,
            comment: (mine.comment ?? "").trim(),
          }
        : null,
    };
  };

  const events = dated
    .filter((x) => x.date >= todayIso)
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        (a.e.start_time ?? 0) - (b.e.start_time ?? 0)
    )
    .map(shape);

  // Past sign-up events, most recent first — the family's record of
  // what they signed up for. Same filter as upcoming so the two halves
  // describe the same set of events, just on either side of today.
  const past = dated
    .filter((x) => x.date < todayIso)
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        (b.e.start_time ?? 0) - (a.e.start_time ?? 0)
    )
    .map(shape);

  return NextResponse.json({ events, past });
}

export type VolunteerEventsResponse = {
  events: ParentVolunteerEvent[];
  /** Sign-up events whose day has passed, most recent first. Optional
   *  so a cached response from before this field existed still
   *  type-checks on the client. */
  past?: ParentVolunteerEvent[];
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
  /** What the event needs families to bring, resolved against every
   *  family's claims: how many are wanted, how many are spoken for,
   *  how many are this family's. Empty when admin listed nothing. */
  items: EventItemAvailability[];
  /** Capacity as stored. Meaningless when `unlimited` — read that
   *  first. */
  spots_total: number;
  spots_taken: number;
  /** Sign-up is open with no attendance cap, so the event is never
   *  "Full" and `spots_total` shouldn't be shown. */
  unlimited: boolean;
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

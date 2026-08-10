import { auth, currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { xano } from "@/lib/xano";
import { isSignUpEvent, isUnlimitedSpots } from "@/lib/school-calendar";

/**
 * Family RSVP for one sign-up event.
 *
 *   POST { eventId, spots, comment? } — reserve (or edit) the
 *     family's spots. One RSVP row per (event, family): re-submitting
 *     upserts. Capacity is enforced here across all families; a full
 *     event returns 409 with the number of spots still open.
 *   DELETE ?eventId=E — cancel the family's RSVP.
 */
export async function POST(req: NextRequest) {
  const gate = await requireFamily();
  if ("response" in gate) return gate.response;
  const { familyId } = gate;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const eventId = Number((body as { eventId?: unknown }).eventId);
  if (!Number.isFinite(eventId) || eventId <= 0) {
    return NextResponse.json({ error: "eventId is required" }, { status: 400 });
  }
  const spots = Number((body as { spots?: unknown }).spots);
  if (!Number.isInteger(spots) || spots < 1 || spots > 20) {
    return NextResponse.json(
      { error: "spots must be between 1 and 20" },
      { status: 400 }
    );
  }
  const commentRaw = (body as { comment?: unknown }).comment;
  const comment =
    typeof commentRaw === "string" ? commentRaw.trim().slice(0, 500) : "";

  // The event must exist, offer sign-ups, and not be in the past.
  const [events, days, rsvps] = await Promise.all([
    xano.schoolCalendarEvents.getAll(),
    xano.schoolCalendar.getAll(),
    xano.eventRsvps.getAll(),
  ]);
  const event = events.find((e) => e.id === eventId);
  if (!event || !isSignUpEvent(event.parent_spots)) {
    return NextResponse.json(
      { error: "This event isn't accepting sign-ups." },
      { status: 404 }
    );
  }
  const day = days.find((d) => d.id === Number(event.school_calendar_id));
  const todayIso = easternTodayIso();
  if (!day || day.date < todayIso) {
    return NextResponse.json(
      { error: "This event has already happened." },
      { status: 409 }
    );
  }

  const mine = rsvps.find(
    (r) =>
      Number(r.school_calendar_events_id) === eventId &&
      Number(r.registration_families_id) === familyId
  );
  const othersTaken = rsvps
    .filter(
      (r) =>
        Number(r.school_calendar_events_id) === eventId &&
        Number(r.registration_families_id) !== familyId
    )
    .reduce((sum, r) => sum + (Number(r.spots) || 0), 0);

  // Uncapped events skip the capacity check entirely — the per-request
  // 1..20 bound above is the only ceiling.
  if (!isUnlimitedSpots(event.parent_spots)) {
    const capacity = event.parent_spots ?? 0;
    const available = capacity - othersTaken;
    if (spots > available) {
      return NextResponse.json(
        {
          error:
            available <= 0
              ? "This event is full."
              : `Only ${available} spot${available === 1 ? "" : "s"} left.`,
          available: Math.max(available, 0),
        },
        { status: 409 }
      );
    }
  }

  if (mine && comment) {
    await xano.eventRsvps.update(mine.id, { spots, comment });
  } else {
    // Clearing the comment can't go through PATCH — this table's
    // comment input trims the usual " " sentinel to "" and Xano then
    // drops the empty input, leaving the old text in place (verified
    // live 2026-08-06). Recreate the row instead; nothing references
    // RSVP ids, so the id churn is harmless.
    if (mine) await xano.eventRsvps.delete(mine.id);
    await xano.eventRsvps.create({
      school_calendar_events_id: eventId,
      registration_families_id: familyId,
      spots,
      comment,
    });
  }

  return NextResponse.json({
    ok: true,
    spots_taken: othersTaken + spots,
    my_rsvp: { spots, comment },
  });
}

export async function DELETE(req: NextRequest) {
  const gate = await requireFamily();
  if ("response" in gate) return gate.response;
  const { familyId } = gate;

  const eventId = Number(req.nextUrl.searchParams.get("eventId"));
  if (!Number.isFinite(eventId) || eventId <= 0) {
    return NextResponse.json({ error: "eventId is required" }, { status: 400 });
  }

  const rsvps = await xano.eventRsvps.getAll();
  const mine = rsvps.find(
    (r) =>
      Number(r.school_calendar_events_id) === eventId &&
      Number(r.registration_families_id) === familyId
  );
  if (mine) {
    await xano.eventRsvps.delete(mine.id);
  }
  return NextResponse.json({ ok: true });
}

/** Resolve the authenticated parent's family id or a ready error
 *  response. */
async function requireFamily(): Promise<
  { familyId: number } | { response: NextResponse }
> {
  const { userId } = await auth();
  if (!userId) {
    return {
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  const user = await currentUser();
  if (!user) {
    return {
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  const familyId = user.publicMetadata.registration_families_id as
    | number
    | undefined;
  if (!familyId) {
    return {
      response: NextResponse.json(
        { error: "No family on file" },
        { status: 400 }
      ),
    };
  }
  return { familyId };
}

/** Today as YYYY-MM-DD in the school's timezone (US Eastern). */
function easternTodayIso(): string {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  });
}

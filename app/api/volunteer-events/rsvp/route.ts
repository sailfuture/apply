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
  // Item claims arrive as [{ itemId, quantity }] — ids, not labels, so
  // renaming an item never strands what a family committed to.
  const itemsRaw = (body as { items?: unknown }).items;
  const requestedClaims: Array<{ itemId: number; quantity: number }> =
    Array.isArray(itemsRaw)
      ? itemsRaw
          .map((row) => ({
            itemId: Number((row as { itemId?: unknown })?.itemId),
            quantity: Math.floor(
              Number((row as { quantity?: unknown })?.quantity)
            ),
          }))
          .filter(
            (c) =>
              Number.isFinite(c.itemId) &&
              c.itemId > 0 &&
              Number.isFinite(c.quantity) &&
              c.quantity > 0
          )
      : [];

  // The event must exist, offer sign-ups, and not be in the past.
  const [events, days, rsvps, allItems, allClaims] = await Promise.all([
    xano.schoolCalendarEvents.getAll(),
    xano.schoolCalendar.getAll(),
    xano.eventRsvps.getAll(),
    xano.eventItems.getAll(),
    xano.eventItemClaims.getAll(),
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

  // Item claims are capacity-checked the same way spots are: against
  // what OTHER families already hold, so editing your own claim down
  // releases it rather than counting twice. A claim against an item
  // that isn't this event's is rejected outright — silently dropping
  // it would tell the parent they're bringing something nobody sees.
  const eventItems = allItems.filter(
    (it) => Number(it.school_calendar_events_id) === eventId
  );
  const itemById = new Map(eventItems.map((it) => [it.id, it]));
  const othersClaimed = new Map<number, number>();
  for (const c of allClaims) {
    if (Number(c.registration_families_id) === familyId) continue;
    if (!itemById.has(Number(c.registration_school_event_items_id))) continue;
    const k = Number(c.registration_school_event_items_id);
    othersClaimed.set(k, (othersClaimed.get(k) ?? 0) + (Number(c.quantity) || 0));
  }
  for (const claim of requestedClaims) {
    const item = itemById.get(claim.itemId);
    if (!item) {
      return NextResponse.json(
        { error: "That item isn't on this event's list any more." },
        { status: 409 }
      );
    }
    const wanted = Math.max(1, Number(item.quantity) || 1);
    const left = wanted - (othersClaimed.get(claim.itemId) ?? 0);
    if (claim.quantity > left) {
      return NextResponse.json(
        {
          error:
            left <= 0
              ? `${item.label} is fully covered already.`
              : `Only ${left} more ${item.label} needed.`,
        },
        { status: 409 }
      );
    }
  }

  // Replace this family's claims for the event wholesale — the dialog
  // always submits the complete set, so reconciling row-by-row would
  // just be a slower way to reach the same state.
  const myExistingClaims = allClaims.filter(
    (c) =>
      Number(c.registration_families_id) === familyId &&
      itemById.has(Number(c.registration_school_event_items_id))
  );
  for (const c of myExistingClaims) {
    await xano.eventItemClaims.delete(c.id);
  }
  for (const claim of requestedClaims) {
    await xano.eventItemClaims.create({
      registration_school_event_items_id: claim.itemId,
      registration_families_id: familyId,
      quantity: claim.quantity,
    });
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

  const [rsvps, allItems, allClaims] = await Promise.all([
    xano.eventRsvps.getAll(),
    xano.eventItems.getAll(),
    xano.eventItemClaims.getAll(),
  ]);
  const mine = rsvps.find(
    (r) =>
      Number(r.school_calendar_events_id) === eventId &&
      Number(r.registration_families_id) === familyId
  );
  if (mine) {
    await xano.eventRsvps.delete(mine.id);
  }

  // Cancelling releases what the family said they'd bring. Leaving
  // the claims behind would hold that capacity against an event
  // nobody from this family is attending.
  const eventItemIds = new Set(
    allItems
      .filter((it) => Number(it.school_calendar_events_id) === eventId)
      .map((it) => it.id)
  );
  for (const c of allClaims) {
    if (Number(c.registration_families_id) !== familyId) continue;
    if (!eventItemIds.has(Number(c.registration_school_event_items_id))) continue;
    await xano.eventItemClaims.delete(c.id);
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

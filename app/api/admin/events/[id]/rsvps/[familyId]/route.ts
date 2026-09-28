import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import {
  removeFamilyEventSignup,
  saveFamilyEventSignup,
} from "@/lib/event-signups";
import { ADMIN_MAX_RSVP_SPOTS } from "@/lib/school-calendar";
import { xano } from "@/lib/xano";

/**
 * Admin editing of one family's sign-up for one event — the Events
 * page sheet's Add / Edit / Remove on an RSVP.
 *
 *   PUT { spots, comment?, items?: [{ itemId, quantity }] }
 *     → sets the family's RSVP and item claims to exactly this; items
 *       left out are released. Creates the RSVP if there isn't one.
 *   DELETE → removes the RSVP and releases every claim.
 *
 * Writes go through the same helper as the parent RSVP route, but
 * without its limits: admin may go past the event's spots or an
 * item's count (the dialog warns first), may edit past events, and
 * may add a family to an event whose parent sign-up is off. Families
 * aren't notified — the change simply shows on their volunteer page.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; familyId: string }> }
) {
  try {
    await requireAdmin();
    const ids = await parseIds(params);
    if ("response" in ids) return ids.response;
    const { eventId, familyId } = ids;

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const spots = Number((body as { spots?: unknown }).spots);
    if (
      !Number.isInteger(spots) ||
      spots < 1 ||
      spots > ADMIN_MAX_RSVP_SPOTS
    ) {
      return NextResponse.json(
        { error: `Spots must be between 1 and ${ADMIN_MAX_RSVP_SPOTS}.` },
        { status: 400 }
      );
    }
    const commentRaw = (body as { comment?: unknown }).comment;
    const comment =
      typeof commentRaw === "string" ? commentRaw.trim().slice(0, 500) : "";
    const itemsRaw = (body as { items?: unknown }).items;
    const claimQty = new Map<number, number>();
    for (const row of Array.isArray(itemsRaw) ? itemsRaw : []) {
      const itemId = Number((row as { itemId?: unknown })?.itemId);
      const quantity = Number((row as { quantity?: unknown })?.quantity);
      if (!Number.isInteger(itemId) || itemId <= 0) continue;
      if (!Number.isInteger(quantity) || quantity < 0 || quantity > 500) {
        return NextResponse.json(
          { error: "Item quantities must be whole numbers from 0 to 500." },
          { status: 400 }
        );
      }
      if (quantity === 0) continue;
      claimQty.set(itemId, (claimQty.get(itemId) ?? 0) + quantity);
    }

    const [events, families, rsvps, allItems, allClaims] = await Promise.all([
      xano.schoolCalendarEvents.getAll(),
      xano.families.getAll(),
      xano.eventRsvps.getAll(),
      xano.eventItems.getAll(),
      xano.eventItemClaims.getAll(),
    ]);
    if (!events.some((e) => e.id === eventId)) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }
    if (!families.some((f) => f.id === familyId)) {
      return NextResponse.json({ error: "Family not found" }, { status: 404 });
    }
    const eventItemIds = new Set(
      allItems
        .filter((it) => Number(it.school_calendar_events_id) === eventId)
        .map((it) => it.id)
    );
    // An item that isn't this event's (deleted since the sheet loaded,
    // or someone else's) is refused rather than dropped — dropping it
    // would tell admin the family is bringing something nobody sees.
    for (const itemId of claimQty.keys()) {
      if (!eventItemIds.has(itemId)) {
        return NextResponse.json(
          { error: "An item on this RSVP isn't on the event's list any more. Reopen the event and try again." },
          { status: 409 }
        );
      }
    }

    await saveFamilyEventSignup(
      {
        eventId,
        familyId,
        spots,
        comment,
        claims: [...claimQty].map(([itemId, quantity]) => ({
          itemId,
          quantity,
        })),
      },
      { rsvps, claims: allClaims, eventItemIds }
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleAdminError(err);
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; familyId: string }> }
) {
  try {
    await requireAdmin();
    const ids = await parseIds(params);
    if ("response" in ids) return ids.response;
    const { eventId, familyId } = ids;

    const [rsvps, allItems, allClaims] = await Promise.all([
      xano.eventRsvps.getAll(),
      xano.eventItems.getAll(),
      xano.eventItemClaims.getAll(),
    ]);
    await removeFamilyEventSignup(eventId, familyId, {
      rsvps,
      claims: allClaims,
      eventItemIds: new Set(
        allItems
          .filter((it) => Number(it.school_calendar_events_id) === eventId)
          .map((it) => it.id)
      ),
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleAdminError(err);
  }
}

async function parseIds(
  params: Promise<{ id: string; familyId: string }>
): Promise<
  { eventId: number; familyId: number } | { response: NextResponse }
> {
  const { id, familyId } = await params;
  const eventId = Number(id);
  const fid = Number(familyId);
  if (!Number.isInteger(eventId) || eventId <= 0) {
    return {
      response: NextResponse.json(
        { error: "Invalid event id" },
        { status: 400 }
      ),
    };
  }
  if (!Number.isInteger(fid) || fid <= 0) {
    return {
      response: NextResponse.json(
        { error: "Invalid family id" },
        { status: 400 }
      ),
    };
  }
  return { eventId, familyId: fid };
}

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { UNLIMITED_PARENT_SPOTS } from "@/lib/school-calendar";
import {
  parseEventItemsInput,
  syncEventItems,
} from "@/lib/school-event-items";
import {
  pushSchoolEventToGoogle,
  removeSchoolEventFromGoogle,
} from "@/lib/school-event-sync";
import { xano } from "@/lib/xano";

/**
 * Admin PATCH / DELETE for one school-calendar event.
 *
 * PATCH allowlists the content fields. `school_calendar_id` moves the
 * event to another day: the target must be a real day row in the
 * SAME school year as the day it's on now, so a typo'd id can't
 * strand it in a different year. Moving keeps the event id, so RSVPs,
 * needs claims and volunteer-hour credits stay attached.
 *
 * Both verbs mirror the change onto the shared school Google Calendar
 * best-effort — a Google failure attaches `warning` to an otherwise
 * successful response, never fails the Xano write.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const { id: idParam } = await params;
    const id = Number(idParam);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json(
        { error: "Invalid event id" },
        { status: 400 }
      );
    }
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 }
      );
    }

    const patch: Record<string, unknown> = {};
    if ("title" in body) {
      const title = typeof body.title === "string" ? body.title.trim() : "";
      if (!title) {
        return NextResponse.json(
          { error: "Event title can't be empty" },
          { status: 400 }
        );
      }
      patch.title = title;
    }
    if ("description" in body) {
      patch.description =
        typeof body.description === "string" ? body.description.trim() : "";
    }
    if ("location" in body) {
      patch.location =
        typeof body.location === "string" ? body.location.trim() : "";
    }
    if ("start_time" in body) patch.start_time = coerceMs(body.start_time);
    if ("end_time" in body) patch.end_time = coerceMs(body.end_time);
    if ("mandatory" in body) patch.mandatory = body.mandatory === true;
    if ("parent_volunteer_hours" in body) {
      patch.parent_volunteer_hours = body.parent_volunteer_hours === true;
    }
    if ("volunteer_hour_total" in body) {
      patch.volunteer_hour_total = coerceHours(body.volunteer_hour_total);
    }
    if ("parent_spots" in body) {
      patch.parent_spots = coerceSpots(body.parent_spots);
    }
    if ("color" in body) {
      // Single-space sentinel when clearing — Xano's edit endpoints
      // silently DROP empty-string inputs, so "" would leave the old
      // color in place. Readers trim before comparing.
      patch.color = coerceColor(body.color) || " ";
    }
    // Day move. Resolved against the day table rather than trusted:
    // the new day has to exist and share the current day's school
    // year (one year's calendar page lists only its own days, so a
    // cross-year id can only be a bug or a forged request).
    let days: Awaited<ReturnType<typeof xano.schoolCalendar.getAll>> | null =
      null;
    if ("school_calendar_id" in body) {
      const targetId = Number(body.school_calendar_id);
      if (!Number.isFinite(targetId) || targetId <= 0) {
        return NextResponse.json(
          { error: "Invalid school_calendar_id" },
          { status: 400 }
        );
      }
      const current = (await xano.schoolCalendarEvents.getAll()).find(
        (e) => e.id === id
      );
      if (!current) {
        return NextResponse.json(
          { error: "Event not found" },
          { status: 404 }
        );
      }
      if (targetId !== Number(current.school_calendar_id)) {
        days = await xano.schoolCalendar.getAll();
        const from = days.find(
          (d) => d.id === Number(current.school_calendar_id)
        );
        const to = days.find((d) => d.id === targetId);
        if (!to) {
          return NextResponse.json(
            { error: "That date isn't on the school calendar" },
            { status: 400 }
          );
        }
        if (from && Number(from.schoolyears_id) !== Number(to.schoolyears_id)) {
          return NextResponse.json(
            { error: "Events can't move to a different school year" },
            { status: 400 }
          );
        }
        patch.school_calendar_id = targetId;
      }
    }

    // `items` lives in its own table, so a body carrying only that is
    // still a valid edit — check for it before rejecting as empty.
    const hasItems = "items" in body;
    if (Object.keys(patch).length === 0 && !hasItems) {
      return NextResponse.json(
        { error: "No editable fields in body" },
        { status: 400 }
      );
    }

    const updated =
      Object.keys(patch).length > 0
        ? await xano.schoolCalendarEvents.update(id, patch)
        : ((await xano.schoolCalendarEvents.getAll()).find(
            (e) => e.id === id
          ) ?? null);
    if (!updated) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    // Needs list — reconciled against its own table. Rows keep their
    // ids across a rename, which is what stops a family's claim from
    // being orphaned when admin edits a need's wording.
    const itemsError = hasItems
      ? await syncEventItems(id, parseEventItemsInput(body.items))
      : null;

    const day = (
      days ?? (await xano.schoolCalendar.getAll().catch(() => []))
    ).find((d) => d.id === Number(updated.school_calendar_id));
    const sync = await pushSchoolEventToGoogle(updated, day?.date);
    return NextResponse.json({
      ...updated,
      warning:
        itemsError ??
        (sync.status === "failed"
          ? `Event updated, but the change couldn't be pushed to the school Google Calendar: ${sync.error}`
          : undefined),
    });
  } catch (err) {
    return handleAdminError(err);
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const { id: idParam } = await params;
    const id = Number(idParam);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json(
        { error: "Invalid event id" },
        { status: 400 }
      );
    }
    await xano.schoolCalendarEvents.delete(id);
    const sync = await removeSchoolEventFromGoogle(id);
    return NextResponse.json({
      ok: true,
      warning:
        sync === "failed"
          ? "Event deleted, but it may still be on the school Google Calendar — remove it there by hand."
          : undefined,
    });
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
 * -1 (`UNLIMITED_PARENT_SPOTS`) = sign-ups open with no cap.
 *
 * The sentinel has to survive the round trip: clamping everything
 * `<= 0` to 0 (as this did) meant the editor's "Open to everyone — no
 * attendance limit" option saved as "no sign-ups at all", so an
 * uncapped event was impossible to create even though every reader
 * downstream understands -1.
 */
function coerceSpots(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  if (n === UNLIMITED_PARENT_SPOTS) return UNLIMITED_PARENT_SPOTS;
  return n > 0 ? Math.min(Math.round(n), 500) : 0;
}

/** Known event-category color slugs; anything else coerces to "". */
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

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import {
  pushSchoolEventToGoogle,
  removeSchoolEventFromGoogle,
} from "@/lib/school-event-sync";
import { xano } from "@/lib/xano";

/**
 * Admin PATCH / DELETE for one school-calendar event.
 *
 * PATCH allowlists the content fields; `school_calendar_id` is
 * deliberately NOT editable — moving an event to another day is a
 * delete + re-create so a typo'd id can't strand it on a day in a
 * different year.
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
    if ("needs" in body) {
      // Single-space sentinel when clearing — Xano's edit endpoints
      // drop empty-string inputs. Readers trim before splitting.
      const needs =
        typeof body.needs === "string" ? body.needs.trim() : "";
      patch.needs = needs || " ";
    }
    if ("color" in body) {
      // Single-space sentinel when clearing — Xano's edit endpoints
      // silently DROP empty-string inputs, so "" would leave the old
      // color in place. Readers trim before comparing.
      patch.color = coerceColor(body.color) || " ";
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json(
        { error: "No editable fields in body" },
        { status: 400 }
      );
    }

    const updated = await xano.schoolCalendarEvents.update(id, patch);

    const day = (await xano.schoolCalendar.getAll().catch(() => [])).find(
      (d) => d.id === Number(updated.school_calendar_id)
    );
    const sync = await pushSchoolEventToGoogle(updated, day?.date);
    return NextResponse.json({
      ...updated,
      warning:
        sync === "failed"
          ? "Event updated, but the change couldn't be pushed to the school Google Calendar — use Sync Google on the calendar page to retry."
          : undefined,
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

/** Whole-number RSVP capacity, capped at 500; 0 = sign-ups closed. */
function coerceSpots(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.round(n), 500) : 0;
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

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";

/**
 * Admin PATCH / DELETE for one school-calendar event.
 *
 * PATCH allowlists the content fields; `school_calendar_id` is
 * deliberately NOT editable — moving an event to another day is a
 * delete + re-create so a typo'd id can't strand it on a day in a
 * different year.
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

    if (Object.keys(patch).length === 0) {
      return NextResponse.json(
        { error: "No editable fields in body" },
        { status: 400 }
      );
    }

    const updated = await xano.schoolCalendarEvents.update(id, patch);
    return NextResponse.json(updated);
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
    return NextResponse.json({ ok: true });
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

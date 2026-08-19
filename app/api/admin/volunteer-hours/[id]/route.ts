import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";

/**
 * Admin PATCH / DELETE for one volunteer-hours entry.
 *
 * PATCH allowlists hours / entry_date / event link / approval. The
 * family + year FKs are deliberately not editable — a mis-keyed entry
 * moves via delete + re-add. Flipping `is_approved` stamps
 * `approved_time` + `is_approved_admin` (0 / " " sentinels on
 * un-approve — Xano edits drop null and empty-string inputs). Every
 * successful PATCH stamps `edited_at`.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { admin } = await requireAdmin();
    const { id: idParam } = await params;
    const id = Number(idParam);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json(
        { error: "Invalid entry id" },
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
    if ("hours" in body) {
      const hours = Number(body.hours);
      if (!Number.isFinite(hours) || hours <= 0 || hours > 100) {
        return NextResponse.json(
          { error: "hours must be between 0 and 100" },
          { status: 400 }
        );
      }
      patch.hours = hours;
    }
    if ("entry_date" in body) {
      const d =
        typeof body.entry_date === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(body.entry_date)
          ? body.entry_date
          : null;
      if (!d) {
        return NextResponse.json(
          { error: "entry_date must be YYYY-MM-DD" },
          { status: 400 }
        );
      }
      patch.entry_date = d;
    }
    if ("school_calendar_events_id" in body) {
      const n = Number(body.school_calendar_events_id);
      patch.school_calendar_events_id =
        Number.isFinite(n) && n > 0 ? n : 0;
    }
    if ("is_approved" in body) {
      const approved = body.is_approved === true;
      patch.is_approved = approved;
      patch.approved_time = approved ? Date.now() : 0;
      patch.is_approved_admin = approved ? admin.name : " ";
    }
    if ("note" in body) {
      const note =
        typeof body.note === "string" ? body.note.trim().slice(0, 500) : "";
      // " " sentinel clears — Xano edits drop empty-string inputs.
      patch.note = note || " ";
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json(
        { error: "No editable fields in body" },
        { status: 400 }
      );
    }
    patch.edited_at = Date.now();

    const updated = await xano.volunteerHours.update(id, patch);
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
        { error: "Invalid entry id" },
        { status: 400 }
      );
    }
    await xano.volunteerHours.delete(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleAdminError(err);
  }
}

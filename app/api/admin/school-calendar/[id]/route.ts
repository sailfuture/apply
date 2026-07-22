import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";

/**
 * Admin PATCH for one school-calendar DAY row — the Settings calendar
 * page's day editor (change a day's type, work rotation, holiday/break
 * flags, or term-boundary markers).
 *
 * Allowlisted so the structural columns (date, year FK, term FK) can't
 * be edited from the UI — those come from the calendar seeding, and a
 * typo'd date would orphan the day. Booleans are coerced with `=== true`
 * so a stray string can't latch a flag on.
 */
const DAY_TYPES = ["School", "Weekend", "Break"];
const WORK_TYPES = ["", "Externship", "Internship"];

const BOOL_FIELDS = [
  "holiday",
  "break",
  "last_day_term",
  "first_day_term",
  "last_day_extern_term",
  "first_day_extern_term",
  "last_day_intern_term",
  "first_day_intern_term",
] as const;

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const { id: idParam } = await params;
    const id = Number(idParam);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: "Invalid day id" }, { status: 400 });
    }
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 }
      );
    }

    const patch: Record<string, unknown> = {};
    if ("type" in body) {
      const t = String(body.type ?? "");
      if (!DAY_TYPES.includes(t)) {
        return NextResponse.json(
          { error: `type must be one of: ${DAY_TYPES.join(", ")}` },
          { status: 400 }
        );
      }
      patch.type = t;
    }
    if ("work_type" in body) {
      const w = String(body.work_type ?? "");
      if (!WORK_TYPES.includes(w)) {
        return NextResponse.json(
          {
            error: `work_type must be one of: ${WORK_TYPES.filter(Boolean).join(", ")} (or empty)`,
          },
          { status: 400 }
        );
      }
      patch.work_type = w;
    }
    for (const f of BOOL_FIELDS) {
      if (f in body) patch[f] = body[f] === true;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json(
        { error: "No editable fields in body" },
        { status: 400 }
      );
    }

    const updated = await xano.schoolCalendar.update(id, patch);
    return NextResponse.json(updated);
  } catch (err) {
    return handleAdminError(err);
  }
}

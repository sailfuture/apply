import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";

/**
 * Assign a date range of calendar days to a season.
 *
 *   POST { yearId, start_date, end_date }
 *     → { assigned, cleared, total }
 *
 * Stamps `school_calendar.seasons_id` on every day row in
 * [start_date, end_date] (days already in another season move to this
 * one) and clears rows previously assigned to this season that fall
 * outside the new range — so re-picking a range is a true move, not
 * an accumulation. Send both dates null to clear the season's
 * assignment entirely. The season's displayed dates derive from these
 * rows (min–max), which is what "the season reflects the selected
 * dates" means — the seasons table itself has no date columns.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const { id: idParam } = await params;
    const id = Number(idParam);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json(
        { error: "Invalid season id" },
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
    const yearId = Number(body.yearId);
    if (!Number.isFinite(yearId) || yearId <= 0) {
      return NextResponse.json(
        { error: "yearId is required" },
        { status: 400 }
      );
    }
    const start = coerceDate(body.start_date);
    const end = coerceDate(body.end_date);
    if ((start === null) !== (end === null)) {
      return NextResponse.json(
        { error: "Set both dates, or neither to clear" },
        { status: 400 }
      );
    }
    if (start && end && end < start) {
      return NextResponse.json(
        { error: "End date can't be before the start date" },
        { status: 400 }
      );
    }

    const days = await xano.schoolCalendar.getByYear(yearId);
    const inRange = (date: string) =>
      start !== null && end !== null && date >= start && date <= end;
    const toSet = days.filter(
      (d) => inRange(d.date) && Number(d.seasons_id) !== id
    );
    const toClear = days.filter(
      (d) => !inRange(d.date) && Number(d.seasons_id) === id
    );

    await inChunks(toSet, 10, (d) =>
      xano.schoolCalendar.update(d.id, { seasons_id: id })
    );
    await inChunks(toClear, 10, (d) =>
      xano.schoolCalendar.update(d.id, { seasons_id: 0 })
    );

    return NextResponse.json({
      assigned: toSet.length,
      cleared: toClear.length,
      total: days.filter((d) => inRange(d.date)).length,
    });
  } catch (err) {
    return handleAdminError(err);
  }
}

/** "YYYY-MM-DD" pass-through, null for anything else. */
function coerceDate(v: unknown): string | null {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

/** Run `fn` over items with bounded concurrency — a season range can
 *  touch a few hundred day rows and Xano has no bulk PATCH. */
async function inChunks<T>(
  items: T[],
  size: number,
  fn: (item: T) => Promise<unknown>
): Promise<void> {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn));
  }
}

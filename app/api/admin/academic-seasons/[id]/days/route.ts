import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import { previewSeasonSave } from "@/lib/season-days";

/**
 * Assign a date range of calendar days to a season.
 *
 *   POST { yearId, start_date, end_date, handoff_start?, handoff_end? }
 *     → { assigned, shared, cleared, total }
 *     → 409 { error, issues } when the save would break the chain
 *       (split a season in two, or leave one with no dates at all).
 *       Gaps and unshared boundaries are warnings, not refusals — see
 *       `previewSeasonSave`.
 *
 * Stamps `school_calendar.seasons_id` on the day rows in
 * [start_date, end_date] and releases rows previously assigned to this
 * season that fall outside it — so re-picking a range is a true move,
 * not an accumulation. Send both dates null to clear the season's
 * assignment entirely. The season's displayed dates derive from these
 * rows (min–max), which is what "the season reflects the selected
 * dates" means — the seasons table itself has no date columns.
 *
 * A range endpoint can be SHARED with the neighbouring season rather
 * than taken from it: a season ending at 10:30am as the next begins
 * holds the morning (`seasons_id`) while the incoming season holds the
 * rest (`seasons_id_pm`), switching at `season_handoff`. `lib/season-
 * days.ts` owns that rule — the season editor plans through the same
 * module, so what it promises is what lands here. `handoff_start` /
 * `handoff_end` (minutes past midnight) set the switch time on the
 * shared endpoints; 0 = no time set, which clears a stored one (the
 * editor sends the value it shows, so its ✕ really does clear).
 *
 * Until the Xano columns exist the extra fields are simply dropped by
 * the edit endpoint, degrading to the old behaviour — the outgoing
 * season keeps the shared date whole — rather than corrupting rows.
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

    const [days, seasons] = await Promise.all([
      xano.schoolCalendar.getByYear(yearId),
      xano.academicSeasons.getByYear(yearId),
    ]);
    const nameOf = (sid: number) =>
      seasons.find((s) => s.id === sid)?.name ?? `Season #${sid}`;
    const preview = previewSeasonSave({
      days,
      seasonId: id,
      start,
      end,
      handoffStart: coerceMinutes(body.handoff_start),
      handoffEnd: coerceMinutes(body.handoff_end),
      nameOf,
    });

    // Chain safety net. The editor shows the same verdict live, so a
    // 409 here means a stale client or a direct call — hence the full
    // reasons in the body rather than a bare status.
    if (preview.blocked) {
      return NextResponse.json(
        {
          error: preview.errors.map((e) => e.message).join(" "),
          issues: preview.errors,
        },
        { status: 409 }
      );
    }
    const plan = preview.plan;

    await inChunks(plan.writes, 10, (w) =>
      xano.schoolCalendar.update(w.id, w.patch)
    );

    return NextResponse.json({
      assigned: plan.writes.filter(
        (w) => start !== null && w.date >= start && w.date <= (end as string)
      ).length,
      shared: plan.shared,
      cleared: plan.cleared,
      total: plan.total,
    });
  } catch (err) {
    return handleAdminError(err);
  }
}

/** "YYYY-MM-DD" pass-through, null for anything else. */
function coerceDate(v: unknown): string | null {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

/** Minutes past midnight in [1, 1439], else 0 ("no handoff time"). */
function coerceMinutes(v: unknown): number {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) && n > 0 && n < 24 * 60 ? n : 0;
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

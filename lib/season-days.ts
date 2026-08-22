import type { XanoSchoolCalendarDay } from "@/lib/xano";

/**
 * Which season owns which calendar day — including the days two
 * seasons share.
 *
 * A season's dates aren't columns on the season row; they derive from
 * the `school_calendar` day rows stamped with its id. Normally that's
 * one season per day (`seasons_id`), but a season can end mid-day as
 * the next one begins — Season 1 until 10:30am, Season 2 from then on
 * — so a changeover date genuinely belongs to both. Those days are
 * stored split: outgoing season in `seasons_id`, incoming one in
 * `seasons_id_pm`, switch time in `season_handoff` (minutes past
 * midnight).
 *
 * Sharing only happens at a range's two endpoints. Interior days move
 * to the season being saved, exactly as they always have — an admin
 * dragging a range over another season's days means to take them.
 *
 * Both the assignment endpoint and the season editor plan through
 * this module, so what the dialog promises is what gets written.
 */

/** Season owning the day — or only its morning on a changeover date.
 *  0 = unassigned. */
export function seasonAmOf(day: XanoSchoolCalendarDay): number {
  return Number(day.seasons_id) || 0;
}

/** Season taking over mid-day; 0 unless the day is a changeover.
 *
 *  A row naming the SAME season in both slots isn't a changeover — a
 *  season can't hand off to itself. That state is reachable: the old
 *  assignment route wrote `seasons_id` alone, so re-saving a season
 *  over a shared date takes the morning and strands the afternoon
 *  pointing at the same id. Normalising here means every reader —
 *  badges, derived ranges, the planner — sees a plain whole day, and
 *  the next save clears the leftovers. */
export function seasonPmOf(day: XanoSchoolCalendarDay): number {
  const pm = Number(day.seasons_id_pm) || 0;
  return pm && pm !== seasonAmOf(day) ? pm : 0;
}

/** Minutes past midnight for the changeover, 0 when unset. */
export function seasonHandoffOf(day: XanoSchoolCalendarDay): number {
  return Number(day.season_handoff) || 0;
}

/** Only a day school is actually in session can be a changeover: the
 *  whole idea is one season handing off to the next part-way through
 *  a school day. A Break or Weekend on the boundary (Labor Day between
 *  two seasons, say) has no 10:30am to split, so it belongs to one
 *  season outright and the next starts on its own first day. */
export function canBeChangeover(day: XanoSchoolCalendarDay): boolean {
  return String(day.type) === "School" && day.break !== true;
}

/** The day columns season assignment writes. */
export type SeasonDayPatch = Partial<
  Pick<
    XanoSchoolCalendarDay,
    "seasons_id" | "seasons_id_pm" | "season_handoff"
  >
>;

/** First/last dates each OTHER season currently covers (either slot). */
export function seasonSpans(
  days: XanoSchoolCalendarDay[],
  exceptId: number
): Map<number, { start: string; end: string }> {
  const spans = new Map<number, { start: string; end: string }>();
  for (const d of days) {
    for (const sid of [seasonAmOf(d), seasonPmOf(d)]) {
      if (!sid || sid === exceptId) continue;
      const cur = spans.get(sid);
      if (!cur) spans.set(sid, { start: d.date, end: d.date });
      else {
        if (d.date < cur.start) cur.start = d.date;
        if (d.date > cur.end) cur.end = d.date;
      }
    }
  }
  return spans;
}

/**
 * The seasons this range would share its endpoints with (0 = not
 * shared, the season takes that day whole):
 *
 *   • `start` — a season already holding the start date that began
 *     EARLIER keeps that morning; the season being saved comes in
 *     mid-day behind it.
 *   • `end` — a season sitting on the end date that runs PAST it is
 *     the incoming one; it moves to the afternoon and the season being
 *     saved takes the morning.
 *
 * A season whose whole span is the one contested day isn't treated as
 * a changeover — there'd be no morning left for it — so it's moved,
 * not split. Neither is a date school isn't in session (see
 * `canBeChangeover`).
 */
export function changeoverPartners({
  days,
  seasonId,
  start,
  end,
}: {
  days: XanoSchoolCalendarDay[];
  seasonId: number;
  start: string;
  end: string;
}): { start: number; end: number } {
  if (!start || !end || end < start) return { start: 0, end: 0 };
  const spans = seasonSpans(days, seasonId);
  const startDay = days.find((d) => d.date === start);
  const endDay = days.find((d) => d.date === end);

  const startAm = startDay && canBeChangeover(startDay) ? seasonAmOf(startDay) : 0;
  const sharedStart =
    startAm > 0 &&
    startAm !== seasonId &&
    (spans.get(startAm)?.start ?? "") < start
      ? startAm
      : 0;

  // A one-day range that already came in mid-day can't also hand off.
  if (sharedStart && start === end) return { start: sharedStart, end: 0 };

  const shareableEnd = endDay && canBeChangeover(endDay);
  const endAm = shareableEnd ? seasonAmOf(endDay) : 0;
  const endPm = shareableEnd ? seasonPmOf(endDay) : 0;
  const sharedEnd =
    endAm > 0 && endAm !== seasonId && (spans.get(endAm)?.end ?? "") > end
      ? endAm
      : endPm > 0 && endPm !== seasonId
        ? endPm
        : 0;

  return { start: sharedStart, end: sharedEnd };
}

export interface SeasonDayPlan {
  /** Day rows to PATCH — no-ops already filtered out. */
  writes: { id: number; date: string; patch: SeasonDayPatch }[];
  /** Seasons sharing the range's endpoints (0 = not shared). */
  partners: { start: number; end: number };
  /** Days in range this season now shares with another season. */
  shared: number;
  /** Days that left this season (either slot). */
  cleared: number;
  /** Days in the range, shared ones included. */
  total: number;
}

/**
 * Plan the writes that make `[start, end]` exactly this season's span.
 *
 * Days that fall out of the range are released; when this season held
 * the morning of a shared day, the incoming season is promoted to sole
 * owner rather than left holding an afternoon with nobody before it.
 * Pass a blank range to release every day.
 *
 * `handoffStart` / `handoffEnd` set the switch time on the shared
 * endpoints, in minutes past midnight. The caller is authoritative
 * there — 0 means "no time set" and CLEARS a stored one, so the ✕ on
 * the editor's time picker actually removes the handoff rather than
 * appearing to. Days that aren't shared always end up at 0.
 */
export function planSeasonDays({
  days,
  seasonId,
  start,
  end,
  handoffStart = 0,
  handoffEnd = 0,
}: {
  days: XanoSchoolCalendarDay[];
  seasonId: number;
  start: string | null;
  end: string | null;
  handoffStart?: number;
  handoffEnd?: number;
}): SeasonDayPlan {
  const ranged = Boolean(start && end);
  const inRange = (date: string) =>
    ranged && date >= (start as string) && date <= (end as string);
  const partners = ranged
    ? changeoverPartners({
        days,
        seasonId,
        start: start as string,
        end: end as string,
      })
    : { start: 0, end: 0 };

  const planned: { day: XanoSchoolCalendarDay; patch: SeasonDayPatch }[] =
    [];
  let shared = 0;

  for (const d of days) {
    if (!inRange(d.date)) continue;

    if (partners.start && d.date === start) {
      // Incoming: the outgoing season keeps `seasons_id` (its morning).
      shared += 1;
      planned.push({
        day: d,
        patch: {
          seasons_id_pm: seasonId,
          season_handoff: handoffStart,
        },
      });
      continue;
    }
    if (partners.end && d.date === end) {
      // Outgoing: hand the afternoon to the season starting here.
      shared += 1;
      planned.push({
        day: d,
        patch: {
          seasons_id: seasonId,
          seasons_id_pm: partners.end,
          season_handoff: handoffEnd,
        },
      });
      continue;
    }
    // Sole owner — and no handoff left over from an earlier edit.
    planned.push({
      day: d,
      patch: { seasons_id: seasonId, seasons_id_pm: 0, season_handoff: 0 },
    });
  }

  const released = days.filter(
    (d) =>
      !inRange(d.date) &&
      (seasonAmOf(d) === seasonId || seasonPmOf(d) === seasonId)
  );
  for (const d of released) {
    planned.push({
      day: d,
      patch:
        seasonAmOf(d) === seasonId
          ? {
              seasons_id: seasonPmOf(d),
              seasons_id_pm: 0,
              season_handoff: 0,
            }
          : { seasons_id_pm: 0, season_handoff: 0 },
    });
  }

  const writes = planned
    .filter(({ day, patch }) => changesDay(day, patch))
    .map(({ day, patch }) => ({ id: day.id, date: day.date, patch }));

  return {
    writes,
    partners,
    shared,
    cleared: released.length,
    total: days.filter((d) => inRange(d.date)).length,
  };
}

/** Skip no-op PATCHes — a season range covers ~90 day rows and Xano
 *  charges a round trip for each one. */
function changesDay(
  day: XanoSchoolCalendarDay,
  patch: SeasonDayPatch
): boolean {
  if ("seasons_id" in patch && patch.seasons_id !== seasonAmOf(day))
    return true;
  if ("seasons_id_pm" in patch && patch.seasons_id_pm !== seasonPmOf(day))
    return true;
  if (
    "season_handoff" in patch &&
    patch.season_handoff !== seasonHandoffOf(day)
  )
    return true;
  return false;
}

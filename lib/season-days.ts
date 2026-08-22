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

/** When seasons change over, in minutes past midnight — 10:30am.
 *
 *  Every changeover here happens at the same hour, so this is the
 *  value a shared day gets unless a caller names another one: nobody
 *  should have to set the time on each boundary, and a shared day is
 *  never left without one. */
export const DEFAULT_HANDOFF_MINUTES = 10 * 60 + 30;

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
 * endpoints, in minutes past midnight; 0 (or omitted) falls back to
 * `DEFAULT_HANDOFF_MINUTES`, so a shared day always carries a time
 * even when the save came from the other season's editor or a client
 * that doesn't send one. Days that aren't shared always end up at 0.
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
          season_handoff: handoffStart || DEFAULT_HANDOFF_MINUTES,
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
          season_handoff: handoffEnd || DEFAULT_HANDOFF_MINUTES,
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

/* ── Chain safety nets ────────────────────────────────────────────── */

/**
 * A year's seasons are meant to form one continuous chain: each runs
 * until the next starts, handing over part-way through the shared
 * date. Nothing enforced that, so a mis-picked range could quietly
 * carve days out of a neighbour or leave a stretch of the year
 * belonging to nobody.
 *
 * `checkSeasonChain` reports what's wrong with a chain as it stands.
 * `previewSeasonSave` reports what a proposed save would ADD to that
 * list, which is the useful question — nobody should be blocked by a
 * mess that was already there. Errors mean the save would corrupt a
 * season and are refused; warnings (a gap, a boundary with no shared
 * date) are shown and allowed, because restructuring a year needs
 * those states on the way through.
 */

/** Stand-in id for a season that doesn't exist yet, so the New season
 *  dialog can check a range before the row is created. Negative so it
 *  can't collide with a real Xano id. */
export const NEW_SEASON_ID = -1;

export type SeasonIssueCode =
  | "hole"
  | "emptied"
  | "overlap"
  | "gap"
  | "hard-cut"
  | "reversed"
  | "orphan-afternoon";

export interface SeasonIssue {
  /** Stable identity, so the same problem seen before and after a save
   *  is recognised as pre-existing rather than newly introduced. */
  key: string;
  level: "error" | "warning";
  code: SeasonIssueCode;
  /** Season the problem is about, and the neighbour when two are. */
  seasonId: number;
  otherSeasonId?: number;
  /** Dates involved, ascending. */
  dates: string[];
  message: string;
}

/** id -> display name, for readable messages. */
export type SeasonNamer = (id: number) => string;

const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");

/** "2026-09-14" -> "Sep 14". Built from the parts rather than a Date
 *  so it can't drift a day across timezones. */
function shortDate(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${d}`;
}

function listDates(dates: string[]): string {
  const shown = dates.slice(0, 3).map(shortDate);
  const rest = dates.length - shown.length;
  return rest > 0 ? `${shown.join(", ")} and ${rest} more` : shown.join(", ");
}

/** Does this season hold any part of the day? */
function holds(day: XanoSchoolCalendarDay, seasonId: number): boolean {
  return seasonAmOf(day) === seasonId || seasonPmOf(day) === seasonId;
}

interface DetailedSpan {
  id: number;
  start: string;
  end: string;
  /** Dates inside the span the season doesn't hold — so it isn't one
   *  continuous stretch. */
  holes: string[];
}

/** Every season present in these day rows, with its span and any break
 *  in the middle of it. Days must be date-ascending. */
function detailedSpans(days: XanoSchoolCalendarDay[]): DetailedSpan[] {
  const ids = new Set<number>();
  for (const d of days) {
    const a = seasonAmOf(d);
    const p = seasonPmOf(d);
    if (a) ids.add(a);
    if (p) ids.add(p);
  }
  const spans: DetailedSpan[] = [];
  for (const id of ids) {
    let first = -1;
    let last = -1;
    for (let i = 0; i < days.length; i++) {
      if (!holds(days[i], id)) continue;
      if (first < 0) first = i;
      last = i;
    }
    if (first < 0) continue;
    const holes: string[] = [];
    for (let i = first; i <= last; i++) {
      if (!holds(days[i], id)) holes.push(days[i].date);
    }
    spans.push({ id, start: days[first].date, end: days[last].date, holes });
  }
  return spans.sort((a, b) => a.start.localeCompare(b.start) || a.id - b.id);
}

/**
 * Everything wrong with the season chain these day rows describe.
 *
 * Errors: a season split in two by another's range, or two seasons
 * overlapping by more than the single date they hand over on.
 * Warnings: unassigned days between neighbours, a boundary where the
 * next season starts the day after instead of sharing the date, a
 * shared date whose halves run in the wrong order, an afternoon with
 * no morning.
 */
export function checkSeasonChain(
  days: XanoSchoolCalendarDay[],
  nameOf: SeasonNamer
): SeasonIssue[] {
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const indexOf = new Map(sorted.map((d, i) => [d.date, i]));
  const spans = detailedSpans(sorted);
  const issues: SeasonIssue[] = [];

  for (const sp of spans) {
    if (!sp.holes.length) continue;
    issues.push({
      key: `hole:${sp.id}:${sp.holes.join(",")}`,
      level: "error",
      code: "hole",
      seasonId: sp.id,
      dates: sp.holes,
      message: `${nameOf(sp.id)} would not be continuous — it runs ${shortDate(sp.start)} to ${shortDate(sp.end)} but doesn't hold ${listDates(sp.holes)}.`,
    });
  }

  for (const d of sorted) {
    if (!seasonPmOf(d) || seasonAmOf(d)) continue;
    issues.push({
      key: `orphan-afternoon:${d.date}`,
      level: "warning",
      code: "orphan-afternoon",
      seasonId: seasonPmOf(d),
      dates: [d.date],
      message: `${shortDate(d.date)} hands over to ${nameOf(seasonPmOf(d))} mid-day, but no season holds the morning.`,
    });
  }

  for (let i = 1; i < spans.length; i++) {
    const prev = spans[i - 1];
    const cur = spans[i];

    if (cur.start < prev.end) {
      issues.push({
        key: `overlap:${prev.id}:${cur.id}`,
        level: "error",
        code: "overlap",
        seasonId: prev.id,
        otherSeasonId: cur.id,
        dates: [cur.start, prev.end],
        message: `${nameOf(prev.id)} runs to ${shortDate(prev.end)} but ${nameOf(cur.id)} already starts ${shortDate(cur.start)} — seasons can only share the one date they hand over on.`,
      });
      continue;
    }

    if (cur.start === prev.end) {
      const day = sorted[indexOf.get(cur.start) ?? -1];
      const ordered =
        day && seasonAmOf(day) === prev.id && seasonPmOf(day) === cur.id;
      if (!ordered) {
        issues.push({
          key: `reversed:${cur.start}`,
          level: "warning",
          code: "reversed",
          seasonId: prev.id,
          otherSeasonId: cur.id,
          dates: [cur.start],
          message: `On ${shortDate(cur.start)}, ${nameOf(cur.id)} holds the morning and ${nameOf(prev.id)} the afternoon — the wrong way round for the order they run in.`,
        });
      }
      continue;
    }

    const from = (indexOf.get(prev.end) ?? -1) + 1;
    const to = indexOf.get(cur.start) ?? 0;
    const between = sorted.slice(from, to);
    if (between.length) {
      issues.push({
        key: `gap:${prev.id}:${cur.id}`,
        level: "warning",
        code: "gap",
        seasonId: prev.id,
        otherSeasonId: cur.id,
        dates: between.map((d) => d.date),
        message: `${listDates(between.map((d) => d.date))} would belong to no season — ${nameOf(prev.id)} ends ${shortDate(prev.end)} and ${nameOf(cur.id)} doesn't start until ${shortDate(cur.start)}.`,
      });
    } else {
      // Only worth flagging when a changeover was actually possible.
      // Seasons meeting either side of a holiday can't share a date —
      // there's no school day to hand over on — so that boundary is
      // correct as it stands and shouldn't nag forever.
      const day = sorted[indexOf.get(cur.start) ?? -1];
      if (day && canBeChangeover(day)) {
        issues.push({
          key: `hard-cut:${prev.id}:${cur.id}`,
          level: "warning",
          code: "hard-cut",
          seasonId: prev.id,
          otherSeasonId: cur.id,
          dates: [prev.end, cur.start],
          message: `${nameOf(cur.id)} starts ${shortDate(cur.start)}, the day after ${nameOf(prev.id)} ends — they don't share a changeover date.`,
        });
      }
    }
  }

  return issues;
}

/** The day rows as they'd look with a plan applied — pure, so a save
 *  can be checked before any of it is written. */
export function applyPlan(
  days: XanoSchoolCalendarDay[],
  plan: SeasonDayPlan
): XanoSchoolCalendarDay[] {
  const byId = new Map(plan.writes.map((w) => [w.id, w.patch]));
  return days.map((d) => {
    const patch = byId.get(d.id);
    return patch ? { ...d, ...patch } : d;
  });
}

export interface SeasonSavePreview {
  plan: SeasonDayPlan;
  /** Problems this save would INTRODUCE — pre-existing ones are left
   *  out, so nobody is blocked by a mess already there. */
  errors: SeasonIssue[];
  warnings: SeasonIssue[];
  /** True when the save would corrupt a season and must be refused. */
  blocked: boolean;
}

/**
 * What saving this range would do to the chain, before anything is
 * written. The season editor renders this live and the assignment
 * endpoint refuses on `blocked`, so the two can't disagree about what
 * is allowed.
 */
export function previewSeasonSave({
  days,
  seasonId,
  start,
  end,
  handoffStart = 0,
  handoffEnd = 0,
  nameOf,
}: {
  days: XanoSchoolCalendarDay[];
  seasonId: number;
  start: string | null;
  end: string | null;
  handoffStart?: number;
  handoffEnd?: number;
  nameOf: SeasonNamer;
}): SeasonSavePreview {
  const plan = planSeasonDays({
    days,
    seasonId,
    start,
    end,
    handoffStart,
    handoffEnd,
  });
  const after = applyPlan(days, plan);
  const known = new Set(checkSeasonChain(days, nameOf).map((i) => i.key));
  const introduced = checkSeasonChain(after, nameOf).filter(
    (i) => !known.has(i.key)
  );

  // A range that swallows a neighbour whole leaves it reading "No
  // dates set" with no hint of where its days went. The season being
  // saved is exempt when the range was deliberately blanked — that is
  // how you clear one.
  const clearing = !start || !end;
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  for (const sp of detailedSpans(sorted)) {
    if (sp.id === seasonId && clearing) continue;
    if (after.some((d) => holds(d, sp.id))) continue;
    introduced.push({
      key: `emptied:${sp.id}`,
      level: "error",
      code: "emptied",
      seasonId: sp.id,
      dates: [sp.start, sp.end],
      message: `This would take every day from ${nameOf(sp.id)} (${shortDate(sp.start)}–${shortDate(sp.end)}), leaving it with no dates.`,
    });
  }

  const errors = introduced.filter((i) => i.level === "error");
  return {
    plan,
    errors,
    warnings: introduced.filter((i) => i.level === "warning"),
    blocked: errors.length > 0,
  };
}

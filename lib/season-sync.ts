import { xano } from "@/lib/xano";
import { orphanSeasonDays, planSeasonRenumber } from "@/lib/season-days";

/**
 * Putting the year's seasons straight before they go out.
 *
 * The calendar is the authoring copy; the school-operations workspace
 * publishes from it (`xano.academicSeasons.publish()`), numbering the
 * spans it finds by date. Two things here can make that publish read
 * wrong, and neither is visible on the calendar page:
 *
 *   • a day still stamped with a season that was deleted — the publish
 *     counts it as a season of its own and everything after it moves up
 *     a number;
 *   • season names drifting out of order once one in the middle is
 *     deleted, so the calendar says "Season 3" where the assembly app
 *     says Season 2.
 *
 * So every season change repairs both first, then publishes. Cheap
 * enough (a handful of PATCHes, usually none) to run on every save
 * rather than leaving a "fix it" button somebody has to know to press.
 */

export interface SeasonRepairResult {
  /** Day rows released from a season that no longer exists. */
  released: number;
  /** Seasons renamed back into calendar order. */
  renames: { id: number; from: string; to: string }[];
}

/** Xano has no bulk PATCH, and a repair can touch a few dozen rows. */
const CHUNK = 10;

/**
 * Release orphaned day stamps and renumber the year's seasons.
 *
 * Returns what it changed so a caller can say so; a year that was
 * already in order returns zeroes and writes nothing.
 */
export async function repairSeasons(
  yearId: number
): Promise<SeasonRepairResult> {
  const [days, seasons] = await Promise.all([
    xano.schoolCalendar.getByYear(yearId),
    xano.academicSeasons.getByYear(yearId),
  ]);

  const orphans = orphanSeasonDays(
    days,
    seasons.map((s) => s.id)
  );
  for (let i = 0; i < orphans.length; i += CHUNK) {
    await Promise.all(
      orphans
        .slice(i, i + CHUNK)
        .map((w) => xano.schoolCalendar.update(w.id, w.patch))
    );
  }

  // Renumber against the days as they are AFTER the release: a season
  // whose only days were the released ones has no dates any more and
  // belongs at the end of the count, not where it used to sit.
  const released = new Map(orphans.map((w) => [w.id, w.patch]));
  const repaired = days.map((d) => {
    const patch = released.get(d.id);
    return patch ? { ...d, ...patch } : d;
  });

  const renames = planSeasonRenumber({ seasons, days: repaired });
  for (let i = 0; i < renames.length; i += CHUNK) {
    await Promise.all(
      renames
        .slice(i, i + CHUNK)
        .map((r) => xano.academicSeasons.update(r.id, { name: r.to }))
    );
  }

  return { released: orphans.length, renames };
}

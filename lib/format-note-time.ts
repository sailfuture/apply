/**
 * Render a timestamp the way the admin notes / comms log surfaces want
 * it: relative for anything in the last week (so "just now" / "5 min
 * ago" reads instantly), with the day-of-week prefix attached for
 * any same-week note (so admin can tell "3 hours ago" was Tuesday at
 * a glance), and an absolute "Mon, Apr 2nd" form for anything older
 * than a week.
 *
 * Buckets:
 *   - under 1 minute  → "Just now"
 *   - under 1 hour    → "<DayOfWeek> · <N> min ago"
 *   - under 1 day     → "<DayOfWeek> · <N> hr ago"
 *   - under 1 week    → "<DayOfWeek> · <N> days ago"
 *   - 1 week or more  → "<DayOfWeek>, <Month> <Day><ord>"  (e.g. "Mon, Apr 2nd")
 *
 * `ts` is the millisecond timestamp Xano returns on `created_at`.
 * Falsy timestamps return an em-dash so callers can drop the helper
 * straight into a JSX cell without guarding.
 */
export function formatNoteTimestamp(
  ts: number | null | undefined
): string {
  if (!ts) return "—";

  const now = Date.now();
  const diff = now - ts;
  const date = new Date(ts);
  const dayShort = WEEKDAY_SHORT[date.getDay()];

  if (diff < 60_000) return "Just now";

  if (diff < 3_600_000) {
    const m = Math.floor(diff / 60_000);
    return `${dayShort} · ${m} min ago`;
  }

  if (diff < 86_400_000) {
    const h = Math.floor(diff / 3_600_000);
    return `${dayShort} · ${h} hr ago`;
  }

  if (diff < 7 * 86_400_000) {
    const d = Math.floor(diff / 86_400_000);
    return `${dayShort} · ${d} day${d === 1 ? "" : "s"} ago`;
  }

  // Over a week — drop the relative form and show an absolute date
  // ("Mon, Apr 2nd") so admin can locate the note on a calendar
  // without doing the math from "X days ago."
  const month = MONTH_SHORT[date.getMonth()];
  const day = date.getDate();
  return `${dayShort}, ${month} ${day}${ordinalSuffix(day)}`;
}

const WEEKDAY_SHORT = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
] as const;

const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/**
 * English ordinal suffix for a day-of-month number.
 * 1 → "st", 2 → "nd", 3 → "rd", 4 → "th", … with the special-case
 * teens (11th / 12th / 13th) handled.
 */
function ordinalSuffix(n: number): string {
  const lastTwo = n % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return "th";
  switch (n % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

/**
 * Short relative-time variant for tight columns (e.g. the docs
 * review Time column). Drops the day-of-week prefix and uses
 * single-letter unit suffixes:
 *
 *   - under 1 minute  → "now"
 *   - under 1 hour    → "5m"
 *   - under 1 day     → "3h"
 *   - under 1 week    → "4d"
 *   - 1 week or more  → "May 2"
 *
 * Falsy timestamps return an em-dash so callers can drop the
 * helper straight into a JSX cell without guarding.
 */
export function formatRelativeShort(
  ts: number | null | undefined
): string {
  if (!ts) return "—";

  const now = Date.now();
  const diff = now - ts;

  if (diff < 60_000) return "now";
  if (diff < 3_600_000) {
    const m = Math.floor(diff / 60_000);
    return `${m}m`;
  }
  if (diff < 86_400_000) {
    const h = Math.floor(diff / 3_600_000);
    return `${h}h`;
  }
  if (diff < 7 * 86_400_000) {
    const d = Math.floor(diff / 86_400_000);
    return `${d}d`;
  }

  const date = new Date(ts);
  return `${MONTH_SHORT[date.getMonth()]} ${date.getDate()}`;
}

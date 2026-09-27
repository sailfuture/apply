import { SCHOOL_TIME_ZONE } from "@/lib/school-calendar";

/**
 * Month-first dates ("MM/DD/YYYY") for everything people read, plus
 * the reverse parse the XLSX exports use to turn that text back into
 * real Excel dates.
 *
 * Only what people see changes. Stored forms stay as they are: Xano
 * date columns remain "YYYY-MM-DD" and timestamps remain unix ms.
 */

/**
 * A "YYYY-MM-DD" date (a Xano date column, optionally with a time
 * suffix) → "MM/DD/YYYY". A string reshuffle, not Date parsing, so a
 * timezone can never shift the day: `new Date("2010-05-14")` is UTC
 * midnight, which is May 13 anywhere in the US. Anything else comes
 * back unchanged rather than blanked, so a malformed value stays
 * visible and admin can correct it.
 */
export function formatDateUs(raw: string | null | undefined): string {
  const value = (raw ?? "").trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? `${match[2]}/${match[3]}/${match[1]}` : value;
}

const SCHOOL_DAY = new Intl.DateTimeFormat("en-US", {
  timeZone: SCHOOL_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Unix-ms timestamp → "MM/DD/YYYY" for the day it fell on at the
 * school (Eastern). Pinned to the school's zone rather than the
 * runtime's, so a server route (UTC on Vercel) doesn't date an
 * evening timestamp to the next day. "" when missing or zero.
 */
export function formatTimestampUs(ms: number | null | undefined): string {
  if (!ms || !Number.isFinite(ms)) return "";
  const parts = SCHOOL_DAY.formatToParts(ms);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${part("month")}/${part("day")}/${part("year")}`;
}

/**
 * "MM/DD/YYYY" → a Date at UTC midnight of that day, or null when the
 * text isn't exactly one real date (blank, a multi-student joined
 * cell, 02/31). ExcelJS converts a Date from its UTC epoch, so the
 * result lands in the sheet as that calendar day with no time part.
 */
export function parseDateUs(text: string): Date | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text.trim());
  if (!match) return null;
  const month = Number(match[1]) - 1;
  const day = Number(match[2]);
  const date = new Date(Date.UTC(Number(match[3]), month, day));
  return date.getUTCMonth() === month && date.getUTCDate() === day
    ? date
    : null;
}

/**
 * Date of birth for display: "MM/DD/YYYY" (e.g. "05/14/2010").
 *
 * Xano stores `date_of_birth` as a date column ("YYYY-MM-DD"), and
 * that stored form must stay as-is for saves, `<input type="date">`
 * values and the Toddle push (see `toddleDob`). This is only for what
 * people read: admin screens, exports, emails, the records-request PDF.
 *
 * A pure string reshuffle, no `Date` parsing, so a timezone can never
 * shift the day (`new Date("2010-05-14")` is UTC midnight, which is
 * May 13 anywhere in the US). A value that isn't YYYY-MM-DD is returned
 * unchanged rather than blanked, so a malformed DOB stays visible and
 * admin can correct it.
 */
export function formatDob(raw: string | null | undefined): string {
  const value = (raw ?? "").trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? `${match[2]}/${match[3]}/${match[1]}` : value;
}

import { formatDateUs } from "@/lib/us-date";

/**
 * Date of birth for display: "MM/DD/YYYY" (e.g. "05/14/2010").
 *
 * Xano stores `date_of_birth` as a date column ("YYYY-MM-DD"), and
 * that stored form must stay as-is for saves, `<input type="date">`
 * values and the Toddle push (see `toddleDob`). This is only for what
 * people read: admin screens, exports, emails, the records-request PDF.
 * The same timezone-proof reshuffle as every other date column; see
 * `formatDateUs`.
 */
export const formatDob = formatDateUs;

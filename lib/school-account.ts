/**
 * School Google-account credential generation for enrolled students.
 *
 * Email: `first.last<YY>@sailfuture.org` where YY is the two-digit
 * START year of the school year the student first enrolled in — a
 * student who joined any time during 2024-2025 (even the tail end of
 * spring) is `24`; a new student entering 2026-2027 is `26`.
 *
 * Password: `<F><L>sfa<YYYY>!` — uppercase first + last initials,
 * literal "sfa", the full start year, and a trailing exclamation
 * (e.g. Hunter Thompson, 2024-2025 → "HTsfa2024!").
 */

/** Parse the start year out of a "2024-2025"-style year name.
 *  Returns null when no 4-digit year leads the string. */
export function schoolYearStartYear(
  yearName: string | null | undefined
): number | null {
  const match = (yearName ?? "").trim().match(/^(\d{4})/);
  return match ? Number(match[1]) : null;
}

/**
 * Lowercase a name into an email-safe token: strip diacritics (NFD then
 * drop combining marks), KEEP apostrophes and hyphens, drop spaces and
 * everything else ("O'Brien-Smith" → "o'brien-smith").
 *
 * Apostrophes and hyphens are kept because that is what the accounts in
 * Google Workspace actually carry — `ja'cori.bolden26@`,
 * `jai'aire.day26@`, `myla.kastner-walega26@` are all live addresses.
 * Stripping them produced an address that looked right in this app and
 * did not exist at the login screen, which is worse than an unusual
 * character: the student's sign-in sheet printed a credential that
 * could not work. Older accounts predate the convention and don't carry
 * them; those are corrected on their student record, not here.
 */
function emailToken(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9'-]/g, "");
}

/** Initial for the password — strictly alphanumeric, because
 *  `emailToken` now keeps punctuation and a surname like "'Alvelo"
 *  would otherwise contribute an apostrophe as its initial. */
function nameInitial(name: string): string {
  const letters = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return letters.charAt(0).toUpperCase();
}

export function generateSchoolEmail(
  firstName: string,
  lastName: string,
  yearName: string | null | undefined
): string | null {
  const first = emailToken(firstName);
  const last = emailToken(lastName);
  const startYear = schoolYearStartYear(yearName);
  if (!first || !last || startYear === null) return null;
  const yy = String(startYear % 100).padStart(2, "0");
  return `${first}.${last}${yy}@sailfuture.org`;
}

export function generateSchoolPassword(
  firstName: string,
  lastName: string,
  yearName: string | null | undefined
): string | null {
  const firstInitial = nameInitial(firstName);
  const lastInitial = nameInitial(lastName);
  const startYear = schoolYearStartYear(yearName);
  if (!firstInitial || !lastInitial || startYear === null) return null;
  return `${firstInitial}${lastInitial}sfa${startYear}!`;
}

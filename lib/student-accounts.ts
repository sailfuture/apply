/**
 * Student school accounts and the parent portal.
 *
 * Students get a Google Workspace account on the school's domain,
 * minted by the enrolled-detail School Account card as
 * `first.lastYY@sailfuture.org` (see lib/school-account.ts) and stored
 * on `registration_students.school_email`. "Continue with Google" on
 * the sign-in page happily accepts those, and until 2026-11 nothing
 * stopped one from walking the parent path: the `/` resolver found no
 * parent row, minted one, sent the account to /welcome, and /welcome
 * minted a family — a second "Edward Roberts" (family 126 / parent
 * 231, created 2026-09-18 by a student's school account) with no
 * students, parked on the application page forever.
 *
 * Rule (chosen 2026-11-06): an account is a STUDENT account when its
 * primary email is either
 *   (a) a stored `registration_students.school_email`, or
 *   (b) shaped like the School Account card mints them:
 *       `first.lastYY@sailfuture.org`.
 * Deliberately NOT "anything on @sailfuture.org": a staff member who is
 * also a parent and isn't on the admin list may still use a work email
 * (`hthompson@`, `dean@` — no `first.lastYY` shape). Staff on the admin
 * list never reach the check at all; the resolver sends them to /admin
 * first. Both tests only apply to the school domain, so a parent on any
 * other domain costs nothing.
 *
 * This module is the pure half (domain, pattern, roster-set test, error
 * shapes). The roster half needs Xano, so the combined async check
 * `isStudentAccountEmail` lives in lib/xano.ts.
 *
 * Enforced in three layers so no caller can forget:
 *   - `/` resolver and the `/student-account` page: redirect to the
 *     explanation page before any record is touched.
 *   - `/api/families` GET (no-family path) and POST: 403 with
 *     `code: "student_account"` so the welcome page bounces too.
 *   - `ensureParentRecord`: throws `StudentAccountError` — the last
 *     line, whatever route forgot the check above.
 */

/** The Google Workspace domain student accounts live on. */
export const STUDENT_ACCOUNT_DOMAIN = "sailfuture.org";

/** Path of the explanation page a blocked account lands on. */
export const STUDENT_ACCOUNT_PATH = "/student-account";

/** `code` on the 403 JSON body the API routes return for these accounts. */
export const STUDENT_ACCOUNT_ERROR_CODE = "student_account";

/**
 * `first.lastYY` — the local part the School Account card generates:
 * two name tokens (lowercase letters, apostrophes, hyphens, matching
 * `emailToken` in lib/school-account.ts) joined by a dot, then exactly
 * two digits for the entry year. Staff addresses (`hthompson`, `dean`,
 * `first.last` with no digits) do not match.
 */
const STUDENT_LOCAL_PART = /^[a-z][a-z0-9'-]*\.[a-z][a-z'-]*\d{2}$/;

function normalizeEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

function splitEmail(email: string | null | undefined): {
  local: string;
  domain: string;
} | null {
  const normalized = normalizeEmail(email);
  const at = normalized.lastIndexOf("@");
  if (at <= 0 || at === normalized.length - 1) return null;
  return { local: normalized.slice(0, at), domain: normalized.slice(at + 1) };
}

/** True when the address is on the student-account domain (or a subdomain). */
export function isOnStudentAccountDomain(
  email: string | null | undefined
): boolean {
  const parts = splitEmail(email);
  if (!parts) return false;
  return (
    parts.domain === STUDENT_ACCOUNT_DOMAIN ||
    parts.domain.endsWith(`.${STUDENT_ACCOUNT_DOMAIN}`)
  );
}

/** True when the address is shaped like a minted student account. */
export function matchesStudentAccountPattern(
  email: string | null | undefined
): boolean {
  const parts = splitEmail(email);
  if (!parts) return false;
  if (!isOnStudentAccountDomain(email)) return false;
  return STUDENT_LOCAL_PART.test(parts.local);
}

/** Lower-cased set of every stored student school email in the roster. */
export function studentSchoolEmailSet(
  rows: ReadonlyArray<{ school_email?: string | null }>
): Set<string> {
  const set = new Set<string>();
  for (const row of rows) {
    const e = normalizeEmail(row.school_email);
    if (e) set.add(e);
  }
  return set;
}

/**
 * The full rule against an already-fetched roster: school domain AND
 * (minted pattern OR a stored student school email). Used by the admin
 * families list, which has the roster in hand; the async variant in
 * lib/xano.ts fetches the roster only when the pattern didn't decide.
 */
export function isStudentAccountAddress(
  email: string | null | undefined,
  rosterEmails: ReadonlySet<string>
): boolean {
  if (!isOnStudentAccountDomain(email)) return false;
  if (matchesStudentAccountPattern(email)) return true;
  return rosterEmails.has(normalizeEmail(email));
}

/** JSON body for the 403 the API routes answer with. */
export function studentAccountErrorBody(email: string | null | undefined) {
  return {
    error:
      "Student school accounts can't be used in the family portal. Sign in with a parent or guardian's own email.",
    code: STUDENT_ACCOUNT_ERROR_CODE,
    email: email ?? "",
  };
}

/** Thrown by `ensureParentRecord` when a student account reaches it. */
export class StudentAccountError extends Error {
  readonly status = 403;
  readonly code = STUDENT_ACCOUNT_ERROR_CODE;
  readonly email: string;

  constructor(email: string) {
    super(
      `Student school account ${email || "(no email)"} cannot hold a parent record`
    );
    this.name = "StudentAccountError";
    this.email = email;
  }
}

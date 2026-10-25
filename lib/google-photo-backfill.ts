import { stripNameSuffix } from "@/lib/name-suffix";
import { getWorkspaceUser } from "@/lib/google-admin";
import { syncStudentPhotoToGoogle } from "@/lib/google-student-photo";
import { resolvePhotoUrl } from "@/lib/student-photo";
import { xano } from "@/lib/xano";
import type { XanoStudent } from "@/lib/xano";

/**
 * Roster-wide "Sync Photos to Google": push every enrolled student's
 * stored headshot (`student_photo`) onto their Google Workspace
 * account photo.
 *
 * The per-save sync (lib/google-student-photo.ts) only fires when a
 * photo is saved or a School Account is created, so every photo
 * uploaded before 2026-10-25 never reached Google. This is the
 * catch-up for those, and it stays safe to re-run: pushing the same
 * photo again just re-sets it.
 *
 * Two modes, same rows:
 *   - dry run → looks every account up (read-only) and reports who
 *     WOULD get a photo, plus who is skipped and why;
 *   - live    → does the same lookups, then pushes the photo for each
 *     student with an account.
 *
 * Never removes a Google photo. A student with no photo on file is
 * reported and left alone, so a picture the student set themselves
 * survives unless the school has one to put in its place.
 *
 * Covers enrolled, non-archived students — the same roster the
 * Enrolled page lists.
 */

export type PhotoBackfillStatus =
  /** Dry run: has a photo + account, would be pushed. */
  | "planned"
  /** Live run: pushed. */
  | "synced"
  /** The account lookup or the push failed. */
  | "failed"
  /** School email on file, but no Google account at that address. */
  | "no_account"
  /** Photo on file, but no school email yet. */
  | "no_email"
  /** No student photo on file — nothing to push. */
  | "no_photo";

export interface PhotoBackfillRow {
  student_id: number;
  student_name: string;
  email: string;
  status: PhotoBackfillStatus;
  /** Whether the Google account had a photo BEFORE this run. Only
   *  known when the account was looked up; null otherwise. A "yes"
   *  on a planned row means the run replaces it. */
  google_had_photo: boolean | null;
  detail?: string;
}

export interface PhotoBackfillResponse {
  dryRun: boolean;
  totals: Record<PhotoBackfillStatus, number>;
  rows: PhotoBackfillRow[];
}

/** Google calls in flight at once. Low enough to stay far under the
 *  Directory API's per-minute quota, high enough that ~70 students
 *  finish well inside the route's time limit. */
const CONCURRENCY = 5;

export async function runGooglePhotoBackfill(opts: {
  dryRun: boolean;
}): Promise<PhotoBackfillResponse> {
  const students = (await xano.students.getAll())
    .filter((s) => s.isEnrolled === true && s.isArchived !== true)
    .sort((a, b) =>
      `${stripNameSuffix(a.last_name ?? "")} ${a.first_name ?? ""}`.localeCompare(
        `${stripNameSuffix(b.last_name ?? "")} ${b.first_name ?? ""}`
      )
    );

  const rows = await mapWithConcurrency(students, CONCURRENCY, (s) =>
    backfillOne(s, opts.dryRun)
  );

  const totals: Record<PhotoBackfillStatus, number> = {
    planned: 0,
    synced: 0,
    failed: 0,
    no_account: 0,
    no_email: 0,
    no_photo: 0,
  };
  for (const row of rows) totals[row.status] += 1;

  return { dryRun: opts.dryRun, totals, rows };
}

async function backfillOne(
  s: XanoStudent,
  dryRun: boolean
): Promise<PhotoBackfillRow> {
  const base = {
    student_id: s.id,
    student_name:
      `${s.first_name ?? ""} ${s.last_name ?? ""}`.trim() || `Student #${s.id}`,
    email: (s.school_email ?? "").trim().toLowerCase(),
    google_had_photo: null,
  };

  if (!resolvePhotoUrl(s.student_photo)) {
    return { ...base, status: "no_photo" };
  }
  if (!base.email) {
    return {
      ...base,
      status: "no_email",
      detail:
        "No school email yet. The photo is pushed when the School Account is created.",
    };
  }

  let user;
  try {
    user = await getWorkspaceUser(base.email);
  } catch (err) {
    return {
      ...base,
      status: "failed",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
  if (!user) {
    return {
      ...base,
      status: "no_account",
      detail: `No Google account exists at ${base.email}. Create it from the student's School Account card.`,
    };
  }

  const withAccount = { ...base, google_had_photo: user.hasPhoto };
  if (dryRun) return { ...withAccount, status: "planned" };

  const sync = await syncStudentPhotoToGoogle({
    studentId: s.id,
    email: base.email,
    photo: s.student_photo ?? null,
    accountExists: true,
  });
  return sync.status === "synced"
    ? { ...withAccount, status: "synced" }
    : { ...withAccount, status: "failed", detail: sync.detail };
}

/** Map with at most `limit` calls in flight, preserving input order. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker())
  );
  return out;
}

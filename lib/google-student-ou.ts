import { xano } from "@/lib/xano";
import type { XanoStudent } from "@/lib/xano";
import {
  ensureOrgUnit,
  extraAllowlist,
  getOrgUnit,
  getWorkspaceUser,
  listChildOrgUnits,
  moveWorkspaceUserToOu,
  resolveStudentOuPath,
  seniorOuPath,
  setSignInRestriction,
} from "@/lib/google-admin";
import { buildLaptopLinkResolver, NO_LAPTOP_LINKS } from "@/lib/laptop-links";
import { placeLaptopInStudentOu } from "@/lib/laptop-google";

/**
 * Putting a student's Google account into their own org unit — the
 * steps shared by the School Account card (one student) and the 12th
 * grade card's "Move to Seniors" (a whole grade at once).
 *
 * Both do the same three things in the same order, and they live here
 * so they can't drift: ensure the student's OU, arm its sign-in
 * restriction, move the account in — then bring along a Chromebook
 * the student holds. Two copies of that sequence is how one of them
 * ends up moving an account into an OU that restricts nobody.
 */

/** The name the OU is labelled with — the student's full stored name,
 *  suffix included, matching the OUs already in the tree
 *  ("Craig Mebane Jr."). Unlike the email and the Toddle push, an OU
 *  label is for a human reading the admin console. */
export function studentOuDisplayName(student: XanoStudent): string {
  return `${student.first_name ?? ""} ${student.last_name ?? ""}`.trim();
}

/**
 * Arm the student's OU so only they (plus IT) can sign in on a
 * Chromebook placed there.
 *
 * The restriction is a DEVICE policy: it does nothing until a device
 * is moved into the OU, and the Laptops page re-applies it when one
 * is. Setting it here means the OU is already live the moment a
 * Chromebook lands, rather than depending on someone remembering to
 * press Restrict.
 *
 * Best-effort on purpose. Callers run this around an account create
 * or move; failing the whole request over a policy write would report
 * "couldn't create" for an account that exists. The result is passed
 * on so the UI can say what did and didn't land.
 */
export async function armSignInRestriction(
  orgUnitId: string,
  email: string
): Promise<boolean> {
  try {
    await setSignInRestriction(orgUnitId, [
      email,
      ...extraAllowlist().filter((e) => e !== email),
    ]);
    return true;
  } catch (err) {
    console.error("[google-student-ou] sign-in policy not applied:", err);
    return false;
  }
}

export interface AccountOuMove {
  email: string;
  /** Where the account is now, as Google reports it. */
  orgUnitPath: string;
  /** The OU's canonical path — what a following laptop is moved to. */
  ouPath: string;
  signInRestricted: boolean;
}

/**
 * Ensure the OU, arm it, move the account in.
 *
 * Armed BEFORE anything moves in. Re-arming on every move matters on
 * its own, too: the allowlist names an address, so a student whose
 * email changed leaves a stale one behind — this is what corrects an
 * OU still allowlisting last year's address.
 *
 * The caller has already resolved `orgUnitPath` (and verified its
 * parent exists — parents are never created here by accident, since
 * `ensureOrgUnit` would happily conjure a whole tree from a typo).
 */
export async function moveAccountIntoOu(
  email: string,
  orgUnitPath: string
): Promise<AccountOuMove> {
  const ou = await ensureOrgUnit(orgUnitPath);
  const signInRestricted = await armSignInRestriction(ou.orgUnitId, email);
  const moved = await moveWorkspaceUserToOu(email, ou.orgUnitPath);
  return {
    email: moved.primaryEmail,
    orgUnitPath: moved.orgUnitPath || ou.orgUnitPath,
    ouPath: ou.orgUnitPath,
    signInRestricted,
  };
}

/** Which laptops each student has checked out right now. */
export interface HeldLaptopIndex {
  laptopIdsFor(studentId: number): number[];
}

/**
 * Index the open checkouts by enrolled student.
 *
 * Holders are found the way the assign guard finds them — bridge
 * column first, then the ops UUID the RFID check-in leaves, which is
 * how most of the fleet is checked out. Three roster reads, so a bulk
 * run builds this once and reuses it for every student.
 */
export async function loadHeldLaptopIndex(): Promise<HeldLaptopIndex> {
  const [assignments, opsStudents, allStudents] = await Promise.all([
    xano.laptopAssignments.getAll(),
    xano.opsStudents.getAll().catch(() => null),
    xano.students.getAll().catch(() => null),
  ]);
  const links =
    opsStudents && allStudents
      ? buildLaptopLinkResolver(opsStudents, allStudents)
      : NO_LAPTOP_LINKS;
  const byStudent = new Map<number, number[]>();
  for (const a of assignments) {
    if (a.returned_date) continue;
    const studentId =
      Number(a.enrolled_students_id) ||
      links.resolve(a.students_id)?.enrolled_students_id ||
      0;
    const laptopId = Number(a.laptops_id) || 0;
    if (!studentId || !laptopId) continue;
    byStudent.set(studentId, [...(byStudent.get(studentId) ?? []), laptopId]);
  }
  return { laptopIdsFor: (studentId) => byStudent.get(studentId) ?? [] };
}

/**
 * Move the Chromebook(s) this student holds into the OU their account
 * was just moved to, and say what happened in one sentence
 * ("" = they hold no laptop, nothing worth saying).
 *
 * `placeLaptopInStudentOu` is handed the OU the account just moved
 * into; it sets the policy there and only then moves the device —
 * the same sequence as the Restrict button. Left behind, the laptop
 * would stay in the old tree: still locked to the student by the old
 * OU's policy, but split from their account and showing as
 * "moves to…" on the Laptops page until someone noticed.
 *
 * Only a laptop already in a per-student OU follows. One parked in
 * the shared pool was never restricted, or was un-restricted on
 * purpose, and is left alone.
 *
 * Best-effort: the account move is done by the time this runs, so a
 * laptop that couldn't follow is reported, not thrown.
 */
export async function bringLaptopAlong(input: {
  /** May still be loading — awaited here so its failure is reported
   *  like any other reason the laptop didn't follow. */
  held: HeldLaptopIndex | Promise<HeldLaptopIndex>;
  studentId: number;
  studentName: string;
  email: string;
  ouPath: string;
}): Promise<string> {
  try {
    const laptopIds = (await input.held).laptopIdsFor(input.studentId);
    if (laptopIds.length === 0) return "";

    const notes: string[] = [];
    for (const laptopId of laptopIds) {
      const laptop = await xano.laptops.getById(laptopId).catch(() => null);
      const result = await placeLaptopInStudentOu({
        serial: (laptop?.serial_number ?? "").trim(),
        studentName: input.studentName,
        studentEmail: input.email,
        onlyIfManaged: true,
        ouPath: input.ouPath,
      });
      notes.push(
        result.status === "placed"
          ? "Their laptop moved with them."
          : result.status === "skipped"
            ? `Their laptop didn't move: ${result.detail}.`
            : "Their laptop was already there."
      );
    }
    return notes.join(" ");
  } catch (err) {
    console.error("[google-student-ou] laptop didn't follow:", err);
    return `Their laptop didn't move: ${
      err instanceof Error ? err.message : "Google Admin call failed"
    }. Restrict it again on the Laptops page.`;
  }
}

/* ───────────────────── A whole grade to Seniors ───────────────────── */

export type SeniorsMoveStatus =
  /** Dry run: has an account that isn't in its Seniors OU yet. */
  | "planned"
  /** Live run: account moved, OU armed. */
  | "moved"
  /** Live run: account moved, but the sign-in restriction on its OU
   *  could not be set — a laptop placed there would accept anyone.
   *  Its own status so it can't hide among the successes. */
  | "moved_unlocked"
  /** Already in their own OU under Seniors — nothing to do. */
  | "in_place"
  /** The lookup or the move failed. */
  | "failed"
  /** School email on file, but no Google account at that address. */
  | "no_account"
  /** No school email generated yet. */
  | "no_email";

export interface SeniorsMoveRow {
  student_id: number;
  student_name: string;
  email: string;
  status: SeniorsMoveStatus;
  /** Where the account is (dry run) or was (live run). "" = unknown. */
  from: string;
  /** Their own OU under Seniors. "" when there's no account to place. */
  to: string;
  detail?: string;
}

export interface SeniorsMoveResponse {
  dryRun: boolean;
  /** The Seniors OU itself, for the dialog's copy. */
  seniorParentPath: string;
  totals: Record<SeniorsMoveStatus, number>;
  rows: SeniorsMoveRow[];
}

/** Thrown when the Seniors OU isn't in Workspace — a setup problem the
 *  route reports as a 409 rather than a per-student failure × 20. */
export class SeniorParentMissingError extends Error {
  constructor(path: string) {
    super(
      `The Seniors org unit "${path}" doesn't exist in Workspace. Create it, or set GOOGLE_SENIOR_OU to the right path.`
    );
    this.name = "SeniorParentMissingError";
  }
}

/** Students in flight at once. Each live move is a handful of
 *  Directory and Chrome Policy writes; three keeps a 20-student grade
 *  well inside the route's time limit without leaning on the quota. */
const CONCURRENCY = 3;

/**
 * Move a set of students' accounts into their own org units under
 * Seniors — the School Account card's "Move to Seniors", for a whole
 * grade in one press.
 *
 * WHO is the caller's call: the 12th grade card sends the students it
 * is showing, because grade lives on the year's registration packet
 * and the card has already worked it out. This only insists they are
 * enrolled and not archived.
 *
 * Two modes, same rows:
 *   - dry run → looks every account up (read-only) and reports where
 *     each one is, where it would go, and who is skipped and why;
 *   - live    → does the same lookups, then moves each account that
 *     isn't already in place, arms its OU and brings its laptop.
 *
 * Safe to re-run: a student already in their Seniors OU is reported
 * "in place" and not touched. The OU each student leaves is kept.
 */
export async function runSeniorsMove(opts: {
  studentIds: number[];
  dryRun: boolean;
}): Promise<SeniorsMoveResponse> {
  const parent = seniorOuPath();
  if (!(await getOrgUnit(parent))) throw new SeniorParentMissingError(parent);

  const wanted = new Set(opts.studentIds);
  const students = (await xano.students.getAll())
    .filter(
      (s) => wanted.has(s.id) && s.isEnrolled === true && s.isArchived !== true
    )
    .sort((a, b) =>
      `${a.last_name ?? ""} ${a.first_name ?? ""}`.localeCompare(
        `${b.last_name ?? ""} ${b.first_name ?? ""}`
      )
    );

  // Listed once and matched in memory, instead of one or two lookups
  // per student. Stale by the end of a live run only for OUs this run
  // creates itself, and each student is resolved exactly once.
  const children = await listChildOrgUnits(parent);
  const held = opts.dryRun ? null : await loadHeldLaptopIndex();

  const rows = await mapWithConcurrency(students, CONCURRENCY, async (s) => {
    const base: SeniorsMoveRow = {
      student_id: s.id,
      student_name: studentOuDisplayName(s) || `Student #${s.id}`,
      email: (s.school_email ?? "").trim().toLowerCase(),
      status: "failed",
      from: "",
      to: "",
    };
    if (!base.email) {
      return {
        ...base,
        status: "no_email" as const,
        detail:
          "No school email yet. Generate it on the student's School Account card.",
      };
    }
    try {
      const user = await getWorkspaceUser(base.email);
      if (!user) {
        return {
          ...base,
          status: "no_account" as const,
          detail: `No Google account exists at ${base.email}. Create it from the student's School Account card.`,
        };
      }
      const to = await resolveStudentOuPath(studentOuDisplayName(s), {
        parent,
        prefer: user.orgUnitPath,
        children,
      });
      const placed = { ...base, from: user.orgUnitPath, to };
      if (user.orgUnitPath.trim().toLowerCase() === to.trim().toLowerCase()) {
        return { ...placed, status: "in_place" as const };
      }
      if (opts.dryRun || !held) return { ...placed, status: "planned" as const };

      const moved = await moveAccountIntoOu(base.email, to);
      const laptopNote = await bringLaptopAlong({
        held,
        studentId: s.id,
        studentName: studentOuDisplayName(s),
        email: base.email,
        ouPath: moved.ouPath,
      });
      const notes = [
        moved.signInRestricted
          ? ""
          : "The sign-in restriction couldn't be applied. Open the student's School Account card and move them again.",
        laptopNote,
      ].filter(Boolean);
      return {
        ...placed,
        to: moved.orgUnitPath,
        status: moved.signInRestricted
          ? ("moved" as const)
          : ("moved_unlocked" as const),
        detail: notes.join(" ") || undefined,
      };
    } catch (err) {
      return {
        ...base,
        status: "failed" as const,
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  });

  const totals: Record<SeniorsMoveStatus, number> = {
    planned: 0,
    moved: 0,
    moved_unlocked: 0,
    in_place: 0,
    failed: 0,
    no_account: 0,
    no_email: 0,
  };
  for (const row of rows) totals[row.status] += 1;

  return { dryRun: opts.dryRun, seniorParentPath: parent, totals, rows };
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

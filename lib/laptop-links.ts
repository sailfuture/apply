import type { XanoOpsStudent, XanoStudent } from "@/lib/xano";

/**
 * Bridging the laptop inventory to our enrolled students.
 *
 * The `laptop_assignments` table has two ways of naming a holder and
 * they don't agree:
 *
 *   - `students_id` — a UUID into the staff-side ops roster. The RFID
 *     check-in system writes this, and it's the ONLY thing it writes.
 *   - `enrolled_students_id` / `enrolled_families_id` — ints into
 *     `registration_students` / `registration_families`. Only rows
 *     created through this app's assign flow carry them.
 *
 * Everything user-facing (student name, photo, crew, and the parent
 * Store page's "your devices" list) reads the enrolled columns, so
 * RFID-created rows render as "Not linked to an enrolled student"
 * even though we plainly know who has the laptop. At the time this
 * was written that was 189 of 212 rows, and 75 of 77 open checkouts.
 *
 * This module closes the gap by resolving a UUID to an enrolled
 * student through whatever key both sides happen to share. It is
 * pure — callers fetch the two rosters and own any writing.
 *
 * Match precedence, strongest first:
 *
 *   1. `toddleID` ↔ `toddle_student_id`. An exact id stamped on both
 *      sides by the same Toddle sync. Covers the large majority.
 *   2. `studentEmail` ↔ `school_email`. Also exact — the generated
 *      `first.last<YY>@sailfuture.org` account.
 *   3. First + last name, and ONLY when exactly one enrolled student
 *      answers to it. A name shared by two students resolves to
 *      nobody rather than guessing wrong: mislabelling whose laptop
 *      is whose is worse than leaving the row unlinked, since the
 *      row stays fixable by hand either way.
 *
 * Not every UUID resolves, and that's correct — the ops roster
 * carries students who never went through registration at all. Those
 * come back `null` and keep the existing "Link student" affordance.
 */

/** How a UUID was matched — surfaced so a backfill can report the
 *  weaker name matches separately from the exact-id ones. */
export type LaptopLinkMethod = "toddle" | "email" | "name";

export interface LaptopLink {
  /** `registration_students.id`. */
  enrolled_students_id: number;
  /** `registration_families.id`; 0 when the student has no family. */
  enrolled_families_id: number;
  student: XanoStudent;
  matchedBy: LaptopLinkMethod;
}

/** Resolves ops UUIDs against a fixed pair of rosters. Build it once
 *  per request or per script run and reuse it across rows. */
export interface LaptopLinkResolver {
  resolve(uuid: string | null | undefined): LaptopLink | null;
  /** How many enrolled students each key reached — for logging when
   *  a backfill's match rate looks off. */
  readonly stats: { byToddle: number; byEmail: number; byName: number };
}

function norm(v: unknown): string {
  return typeof v === "string" ? v.trim().toLowerCase() : "";
}

/**
 * Index the two rosters into a resolver.
 *
 * `opsStudents` comes from `xano.opsStudents.getAll()`, `students`
 * from `xano.students.getAll()`. Archived students on either side are
 * kept: a device can still be checked out to someone who has left,
 * and naming them is more useful than blanking the row.
 */
export function buildLaptopLinkResolver(
  opsStudents: XanoOpsStudent[],
  students: XanoStudent[]
): LaptopLinkResolver {
  const byToddle = new Map<string, XanoStudent>();
  const byEmail = new Map<string, XanoStudent>();
  // Names collect into arrays so a collision can be detected and
  // dropped rather than silently resolving to whichever row we saw
  // first.
  const byName = new Map<string, XanoStudent[]>();

  for (const s of students) {
    const toddle = norm(s.toddle_student_id);
    if (toddle && !byToddle.has(toddle)) byToddle.set(toddle, s);
    const email = norm(s.school_email);
    if (email && !byEmail.has(email)) byEmail.set(email, s);
    const name = `${norm(s.first_name)}|${norm(s.last_name)}`;
    if (name !== "|") {
      const bucket = byName.get(name);
      if (bucket) bucket.push(s);
      else byName.set(name, [s]);
    }
  }

  const opsById = new Map<string, XanoOpsStudent>();
  for (const o of opsStudents) {
    if (typeof o.id === "string" && o.id) opsById.set(o.id, o);
  }

  const link = (
    student: XanoStudent,
    matchedBy: LaptopLinkMethod
  ): LaptopLink => ({
    enrolled_students_id: Number(student.id) || 0,
    enrolled_families_id: Number(student.registration_families_id) || 0,
    student,
    matchedBy,
  });

  return {
    stats: {
      byToddle: byToddle.size,
      byEmail: byEmail.size,
      byName: byName.size,
    },
    resolve(uuid) {
      if (typeof uuid !== "string" || !uuid) return null;
      const ops = opsById.get(uuid);
      if (!ops) return null;

      const toddle = norm(ops.toddleID);
      const byToddleHit = toddle ? byToddle.get(toddle) : undefined;
      if (byToddleHit) return link(byToddleHit, "toddle");

      const email = norm(ops.studentEmail);
      const byEmailHit = email ? byEmail.get(email) : undefined;
      if (byEmailHit) return link(byEmailHit, "email");

      const name = `${norm(ops.firstName)}|${norm(ops.lastName)}`;
      if (name === "|") return null;
      const nameHits = byName.get(name);
      // Exactly one, or we don't guess.
      if (nameHits && nameHits.length === 1) return link(nameHits[0], "name");
      return null;
    },
  };
}

/** An empty resolver — what callers use when the ops roster fetch
 *  fails, so a lookup outage degrades to today's behaviour (rows
 *  render unlinked) instead of failing the whole page. */
export const NO_LAPTOP_LINKS: LaptopLinkResolver = {
  stats: { byToddle: 0, byEmail: 0, byName: 0 },
  resolve: () => null,
};

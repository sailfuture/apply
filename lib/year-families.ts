import { computeFamilyStageSets } from "@/lib/sms/stages";
import type {
  XanoApplication,
  XanoFamily,
  XanoFamilyApplicationProgress,
  XanoStudent,
  XanoStudentRegistrationProgress,
} from "@/lib/xano";

/** One family as the admin family pickers show it — every family,
 *  flagged with whether they're enrolled for the year. */
export interface YearFamily {
  id: number;
  name: string;
  enrolled: boolean;
  /** The family's students for the year, FULL names dot-joined
   *  ("Jorden Smith · Mia Smith") — shown in the family pickers and
   *  matched by their search boxes, so searching a student's first
   *  OR last name finds the family. */
  students: string;
}

/**
 * Families whose EVERY student on the year has been unenrolled (the
 * Unenroll modal sets `isArchived` on the student). The family-level
 * flags (accepted, registration confirmed) stay true after a student
 * leaves, so stage alone still reads these families as enrolled. Any
 * list of who to email or text checks this as well. A family with no
 * student on the year at all is NOT in the set.
 */
export function fullyUnenrolledFamilyIds(input: {
  yearId: number;
  applications: XanoApplication[];
  students: XanoStudent[];
}): Set<number> {
  const archived = new Set(
    input.students.filter((s) => s.isArchived === true).map((s) => s.id)
  );
  const withActive = new Set<number>();
  const withArchived = new Set<number>();
  for (const a of input.applications) {
    if (Number(a.registration_school_years_id) !== input.yearId) continue;
    if (a.isActive === false) continue;
    const fid = Number(a.registration_families_id);
    const sid = Number(a.registration_students_id);
    if (!fid || !sid) continue;
    (archived.has(sid) ? withArchived : withActive).add(fid);
  }
  return new Set([...withArchived].filter((fid) => !withActive.has(fid)));
}

/**
 * Every family for one school year, name-sorted: enrolled via the
 * shared stage bucketing, with the year's student names from active
 * applications (the same application join the group-audience route
 * uses — year-scoped, inactive apps and unenrolled students skipped,
 * deduped per student).
 *
 * Pure: callers load the tables, so a route that already has them for
 * other reasons doesn't fetch twice.
 */
export function buildYearFamilies(input: {
  yearId: number;
  families: XanoFamily[];
  /** Year-scoped progress rows (`getByYear`). */
  fap: XanoFamilyApplicationProgress[];
  srp: XanoStudentRegistrationProgress[];
  applications: XanoApplication[];
  students: XanoStudent[];
}): YearFamily[] {
  const { yearId } = input;
  const stageSets = computeFamilyStageSets({
    fap: input.fap,
    srp: input.srp,
  });

  // Full names (not just first) so the pickers' search matches a
  // student's last name too.
  const studentName = new Map(
    input.students.map((s) => [
      s.id,
      `${s.first_name ?? ""} ${s.last_name ?? ""}`.trim(),
    ])
  );
  // Unenrolled students (the Unenroll modal sets `isArchived`) are
  // left off the family's student list, and a family whose every
  // student for the year is unenrolled doesn't count as enrolled: the
  // family-level "confirmed" flag stays true after a student leaves,
  // so stage alone can't tell. Same rule as the group-text audience.
  const archivedStudents = new Set(
    input.students.filter((s) => s.isArchived === true).map((s) => s.id)
  );
  const fullyUnenrolled = fullyUnenrolledFamilyIds({
    yearId,
    applications: input.applications,
    students: input.students,
  });
  const familyStudents = new Map<number, string[]>();
  for (const a of input.applications) {
    if (Number(a.registration_school_years_id) !== yearId) continue;
    if (a.isActive === false) continue;
    const fid = Number(a.registration_families_id);
    const sid = Number(a.registration_students_id);
    if (!fid || !sid) continue;
    if (archivedStudents.has(sid)) continue;
    const name = studentName.get(sid) || "";
    if (!name) continue;
    const list = familyStudents.get(fid) ?? [];
    if (!list.includes(name)) list.push(name);
    familyStudents.set(fid, list);
  }

  return input.families
    .map((f) => ({
      id: f.id,
      name: f.family_name?.trim() || `Family #${f.id}`,
      enrolled: stageSets.enrolled.has(f.id) && !fullyUnenrolled.has(f.id),
      students: (familyStudents.get(f.id) ?? []).join(" · "),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

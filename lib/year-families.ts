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
  const withActiveStudent = new Set<number>();
  const withArchivedStudent = new Set<number>();
  const familyStudents = new Map<number, string[]>();
  for (const a of input.applications) {
    if (Number(a.registration_school_years_id) !== yearId) continue;
    if (a.isActive === false) continue;
    const fid = Number(a.registration_families_id);
    const sid = Number(a.registration_students_id);
    if (!fid || !sid) continue;
    if (archivedStudents.has(sid)) {
      withArchivedStudent.add(fid);
      continue;
    }
    withActiveStudent.add(fid);
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
      enrolled:
        stageSets.enrolled.has(f.id) &&
        !(withArchivedStudent.has(f.id) && !withActiveStudent.has(f.id)),
      students: (familyStudents.get(f.id) ?? []).join(" · "),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

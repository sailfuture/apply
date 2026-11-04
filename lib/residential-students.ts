/**
 * Residential / foster students are placed with SailFuture, not
 * recruited, so the admin dashboard's "enrolled" headcount and roster
 * curve leave them out (same rule as the Billing page, which excludes
 * residential families server-side).
 *
 * A student is residential when their family carries
 * `is_residential`. Two links are checked because neither is
 * guaranteed on every row: the student's own `registration_families_id`
 * and the family on any of their active applications (mid-year and
 * residential additions are created from the application side).
 */
export function residentialStudentIds(
  families: ReadonlyArray<{ id: number; is_residential?: boolean }>,
  students: ReadonlyArray<{ id: number; registration_families_id?: number }>,
  applications: ReadonlyArray<{
    registration_students_id: number;
    registration_families_id: number;
    isActive?: boolean;
  }>
): Set<number> {
  const residentialFamilies = new Set(
    families.filter((f) => f.is_residential === true).map((f) => Number(f.id))
  );
  const out = new Set<number>();
  if (residentialFamilies.size === 0) return out;
  for (const s of students) {
    if (residentialFamilies.has(Number(s.registration_families_id))) {
      out.add(Number(s.id));
    }
  }
  for (const a of applications) {
    if (a.isActive === false) continue;
    if (residentialFamilies.has(Number(a.registration_families_id))) {
      out.add(Number(a.registration_students_id));
    }
  }
  return out;
}

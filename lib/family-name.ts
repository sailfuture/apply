/**
 * Family display names carry the roster in a trailing parenthetical:
 * "Adams Family (Jorden, Matthew)". The suffix is the family's
 * non-archived students' first names in creation order, and it has to
 * follow the roster (a sibling added mid-year, a student archived, a
 * first name corrected) or the name every admin list and the parent
 * header shows goes stale.
 *
 * These helpers are pure (no Xano, safe in client bundles). The
 * server-side writer that keeps the stored `family_name` in step is
 * `lib/family-name-sync.ts`.
 */

/** One trailing "(...)" group, with any whitespace around it. */
const STUDENT_SUFFIX = /\s*\([^()]*\)\s*$/;

/** "Adams Family (Jorden)" -> "Adams Family". A name with no suffix is
 *  returned trimmed. */
export function stripStudentSuffix(name: string | null | undefined): string {
  return String(name ?? "").replace(STUDENT_SUFFIX, "").trim();
}

/**
 * Compose the display name from a stored name (suffix or not) and the
 * roster's first names. Blank names are dropped, duplicates collapse,
 * order is preserved (callers pass students in creation order).
 *
 *   familyNameWithStudents("Adams Family (Jorden)", ["Jorden", "Matthew"])
 *     -> "Adams Family (Jorden, Matthew)"
 *   familyNameWithStudents("Adams Family (Jorden)", [])
 *     -> "Adams Family"
 *   familyNameWithStudents("", ["Jorden"]) -> ""   (nothing to name)
 */
export function familyNameWithStudents(
  name: string | null | undefined,
  firstNames: readonly (string | null | undefined)[]
): string {
  const base = stripStudentSuffix(name);
  if (!base) return "";
  const seen = new Set<string>();
  const names: string[] = [];
  for (const raw of firstNames) {
    const n = String(raw ?? "").trim();
    if (!n) continue;
    const key = n.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(n);
  }
  return names.length ? `${base} (${names.join(", ")})` : base;
}

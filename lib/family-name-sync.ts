import { xano } from "@/lib/xano";
import { familyNameWithStudents } from "@/lib/family-name";

/**
 * Rewrite a family's stored `family_name` so its "(Student, Student)"
 * suffix matches the current non-archived roster. Call after anything
 * that changes the roster: a student created (apply flow, mid-year
 * sibling, residential placement), archived or unarchived, or renamed.
 *
 * Best-effort by design: the roster change already landed, and a
 * failed rename must not turn it into an error for the caller. Returns
 * the name now on the row, or `null` when nothing could be read.
 */
export async function syncFamilyNameWithStudents(
  familyId: number
): Promise<string | null> {
  if (!Number.isFinite(familyId) || familyId <= 0) return null;
  try {
    const [family, students] = await Promise.all([
      xano.families.getById(familyId),
      // Sorted by id (creation order), archived students excluded.
      xano.students.getByFamilyId(familyId),
    ]);
    const current = (family.family_name ?? "").trim();
    const next = familyNameWithStudents(
      current,
      students.map((s) => s.first_name)
    );
    if (!next || next === current) return current || null;
    await xano.families.update(familyId, { family_name: next });
    return next;
  } catch (err) {
    console.error(
      `[family-name-sync] could not resync family ${familyId}:`,
      err
    );
    return null;
  }
}

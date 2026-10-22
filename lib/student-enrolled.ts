import { xano } from "@/lib/xano";

/**
 * Flip `student.isEnrolled = true` — the flag the enrolled roster and
 * ~10 other admin surfaces (XLSX export, laptops, Toddle sync-all,
 * stats, search, retention) filter on.
 *
 * Shared by the per-packet verify cascade
 * (`/api/admin/student-registration/[id]`) and the residential
 * add-student route (`/api/residential-students`), which enrolls a
 * foster placement the moment it's added so it shows on the roster
 * without waiting for staff to verify the packet.
 *
 * Skipped when the student is archived (admin-unenrolled — a late
 * re-verify must not quietly pull them back into the roster) or
 * already flagged, so the common case costs one read and no write.
 * Writes through the admin API group — `isEnrolled` isn't exposed on
 * the default group's CRUD endpoint.
 */
export async function markStudentEnrolled(studentId: number): Promise<void> {
  if (!studentId) return;
  const student = await xano.students.getById(studentId);
  if (student.isArchived === true) return;
  if (student.isEnrolled === true) return;
  await xano.students.updateOnAdminGroup(studentId, { isEnrolled: true });
}

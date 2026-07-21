import type { XanoStudentRegistration } from "@/lib/xano";

/**
 * SUFS reconciliation columns on the `registration_student_registration`
 * packet that are ADMIN-ONLY and must never reach a parent — not in any
 * UI, and not in a raw JSON response a parent could read in the network
 * tab. Admin sets these on the `/admin/sufs` page; the audit pair is
 * stamped server-side.
 *
 * Kept in one place so every parent-facing boundary (the GET collection
 * route AND the PATCH response) strips the same set and the two can't
 * drift as columns are added.
 *
 * NOTE: this is the "parent can't SEE" set. The broader "parent can't
 * WRITE" denylist in `/api/student-registration/[id]` is a superset
 * (it also blocks `registrationConfirmed`, crew placement, etc.), but
 * `registrationConfirmed` is deliberately NOT in THIS list — the parent
 * pending-confirmation view legitimately reads it.
 */
export const SUFS_ADMIN_FIELDS = [
  "sufs_enrolled",
  "sufs_enrolled_notes",
  "sufs_enrolled_time",
  "sufs_enrolled_by",
] as const;

/**
 * Strip the admin-only SUFS columns from a packet before it goes back
 * to a parent. Used by both the parent GET (`/api/student-registration`)
 * and the parent PATCH response (`/api/student-registration/[id]`),
 * since Xano's update echoes the full row — including columns the parent
 * never wrote.
 */
export function redactAdminSufs(
  packet: XanoStudentRegistration | null
): XanoStudentRegistration | null {
  if (!packet) return packet;
  const clone = { ...packet };
  for (const field of SUFS_ADMIN_FIELDS) {
    delete clone[field];
  }
  return clone;
}

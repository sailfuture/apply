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
  "sufs_enrollment_request_sent",
  "sufs_enrollment_request_notes",
  "sufs_enrollment_request_time",
  "sufs_enrollment_request_by",
  "sufs_parent_enrollment_confirmation",
  "sufs_parent_enrollment_request_time",
  "sufs_parent_enrollment_request_by",
  "sufs_q1_payment",
  "sufs_q1_payment_confirmed",
  "sufs_q1_payment_confirmed_by",
  "sufs_q2_payment",
  "sufs_q2_payment_confirmed",
  "sufs_q2_payment_confirmed_by",
  "sufs_q3_payment",
  "sufs_q3_payment_confirmed",
  "sufs_q3_payment_confirmed_by",
  "sufs_q4_payment",
  "sufs_q4_payment_confirmed",
  "sufs_q4_payment_confirmed_by",
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

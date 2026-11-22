import { NextResponse } from "next/server";
import { denyScholarshipFamilyAccess } from "@/lib/scholarship-access";
import { xano } from "@/lib/xano";

/**
 * Ownership guards for the parent-facing routes keyed on a row id:
 * `/api/students/[id]`, `/api/student-registration` (+ `[id]`) and
 * `/api/emergency-contacts/[id]`.
 *
 * Until 2026-11-22 these routes only checked that the caller was signed
 * in (and, for some, had a family). The id in the URL was trusted, so
 * any parent account could read another student's registration packet
 * (health, Medicaid, pickup lists), or edit / delete another family's
 * student, packet or emergency contact by walking numeric ids.
 *
 * Each guard resolves the row to the family that owns it and hands off
 * to the same family check the scholarship routes use
 * (`lib/scholarship-access.ts`): allowed when the row belongs to the
 * caller's own family, or the caller is an admin. Like those guards,
 * they return a `NextResponse` to return early (401 / 403 / 404) when
 * the request is NOT allowed, or `null` when it is.
 */

/** Columns a parent may never write through a row PATCH: the primary
 *  key, the creation stamp, and the family link (re-pointing a row at
 *  another family is exactly what the guards exist to prevent). */
export const PARENT_READONLY_FIELDS = [
  "id",
  "created_at",
  "registration_families_id",
] as const;

/** Drop `PARENT_READONLY_FIELDS` (plus any route-specific extras) from
 *  a request body before it is forwarded to Xano. Returns a copy. */
export function stripReadonlyFields(
  body: unknown,
  extra: ReadonlyArray<string> = []
): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};
  const patch = { ...(body as Record<string, unknown>) };
  for (const field of [...PARENT_READONLY_FIELDS, ...extra]) {
    delete patch[field];
  }
  return patch;
}

/** Guard for a route keyed on a family id. */
export const denyFamilyAccess = denyScholarshipFamilyAccess;

/** Guard for a route keyed on a `registration_students` id. */
export async function denyStudentAccess(
  studentId: unknown
): Promise<NextResponse | null> {
  const id = toId(studentId);
  const student = id
    ? await xano.students.getById(id).catch(() => null)
    : null;
  // An unresolvable student has no family to match: `denyFamilyAccess`
  // then lets only an admin through and answers everyone else 404.
  return denyFamilyAccess(toId(student?.registration_families_id));
}

/** Guard for a route keyed on a `registration_student_registration`
 *  (packet) id. The packet table has no family column; it joins to the
 *  family through its student. */
export async function denyPacketAccess(
  packetId: unknown
): Promise<NextResponse | null> {
  const id = toId(packetId);
  const packet = id ? await xano.studentRegistration.getById(id) : null;
  return denyStudentAccess(packet?.registration_students_id);
}

/**
 * Guard for a route keyed on a `registration_emergency_contacts` id.
 * There is no per-row read for that table, so membership is checked
 * against the caller's own family list. `familyId` is the session's
 * family (these routes already require one).
 */
export async function denyEmergencyContactAccess(
  contactId: unknown,
  familyId: number
): Promise<NextResponse | null> {
  const id = toId(contactId);
  if (!id) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const contacts = await xano.emergencyContacts.getByFamilyId(familyId);
  if (!contacts.some((c) => toId(c.id) === id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return null;
}

/** Coerce an id that may arrive as a number, numeric string, or an
 *  expanded Xano relation object (`{ id: 60, ... }`) to a number. */
function toId(v: unknown): number | null {
  if (typeof v === "object" && v !== null && "id" in v) {
    v = (v as { id: unknown }).id;
  }
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";

/**
 * Admin POST — resolve-or-create a `registration_student_registration`
 * packet for a (student, year). Used by the "Create registration
 * packet" button on the family registration detail page when a
 * student is missing a packet (rare; happens when a parent has been
 * accepted but hasn't yet opened the registration flow on their
 * own).
 *
 * Delegates to `xano.studentRegistration.resolve()` which handles
 * the fetch-or-create plus the empty-row defaults — same flow the
 * parent-side PandaDoc waiver routes use. Returns the resolved
 * packet so the caller can refresh into the just-created row.
 *
 * Body:
 *   - `studentId` (required) — the student to attach the packet to
 *   - `yearId` (required) — the school year
 *   - `registration_type_id` (optional, default 1 — "new enrollment")
 *
 * Distinct from the per-id PATCH at
 * `/api/admin/student-registration/[id]`: that route mutates an
 * existing packet (registrationConfirmed flag, waiver metadata).
 * This one bootstraps the row in the first place.
 */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = await req.json();
    const studentId = Number(body?.studentId);
    const yearId = Number(body?.yearId);
    if (!Number.isFinite(studentId) || studentId <= 0) {
      return NextResponse.json(
        { error: "studentId is required" },
        { status: 400 }
      );
    }
    if (!Number.isFinite(yearId) || yearId <= 0) {
      return NextResponse.json(
        { error: "yearId is required" },
        { status: 400 }
      );
    }
    const registrationTypeId =
      typeof body?.registration_type_id === "number" &&
      Number.isFinite(body.registration_type_id)
        ? body.registration_type_id
        : 1;
    const packet = await xano.studentRegistration.resolve(
      studentId,
      yearId,
      registrationTypeId
    );
    return NextResponse.json(packet, { status: 201 });
  } catch (err) {
    return handleAdminError(err);
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";

/**
 * Link / unlink one staff-system laptop assignment to an enrolled
 * student — the ONLY write this app performs on the operations
 * group's `laptop_assignments` table.
 *
 *   PATCH { enrolled_students_id } — a student id links (the family
 *     id is derived server-side from the student row); 0 unlinks.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const { id: idParam } = await params;
    const id = Number(idParam);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json(
        { error: "Invalid assignment id" },
        { status: 400 }
      );
    }
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || !("enrolled_students_id" in body)) {
      return NextResponse.json(
        { error: "enrolled_students_id is required (0 to unlink)" },
        { status: 400 }
      );
    }
    const studentId = Number(
      (body as { enrolled_students_id: unknown }).enrolled_students_id
    );
    if (!Number.isFinite(studentId) || studentId < 0) {
      return NextResponse.json(
        { error: "enrolled_students_id must be a student id or 0" },
        { status: 400 }
      );
    }

    let familyId = 0;
    if (studentId > 0) {
      // getById throws on a missing row — surface that as a clean 404
      // rather than a generic handler error.
      const student = await xano.students
        .getById(studentId)
        .catch(() => null);
      if (!student) {
        return NextResponse.json(
          { error: `Student ${studentId} not found` },
          { status: 404 }
        );
      }
      familyId = Number(student.registration_families_id) || 0;
    }

    const updated = await xano.laptopAssignments.update(id, {
      enrolled_students_id: studentId,
      enrolled_families_id: familyId,
    });
    return NextResponse.json(updated);
  } catch (err) {
    return handleAdminError(err);
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";

/**
 * One laptop checkout row.
 *
 *   PATCH — close the checkout (return the device), edit notes,
 *     and/or link it to an enrolled student:
 *     { returned_date?, returned_condition?, notes?,
 *       enrolled_students_id? }. Returning requires both a date and
 *     a condition. Linking derives the family id server-side (0
 *     unlinks) — the path for legacy staff-system rows that carry
 *     only the ops student UUID, so the device shows on the
 *     family's Store page.
 *   DELETE — remove the row entirely. For undoing a mis-assignment
 *     (wrong student / wrong device) without polluting the device's
 *     history with a fake return.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const id = await rowId(params);
    if (!id) {
      return NextResponse.json(
        { error: "Invalid assignment id" },
        { status: 400 }
      );
    }
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }
    const b = body as Record<string, unknown>;

    const patch: Record<string, unknown> = {};
    if ("returned_date" in b || "returned_condition" in b) {
      const returnedDate = Number(b.returned_date);
      const condition =
        typeof b.returned_condition === "string"
          ? b.returned_condition.trim().toUpperCase()
          : "";
      if (!Number.isFinite(returnedDate) || returnedDate <= 0 || !condition) {
        return NextResponse.json(
          {
            error:
              "Returning a laptop needs both returned_date and returned_condition",
          },
          { status: 400 }
        );
      }
      patch.returned_date = returnedDate;
      patch.returned_condition = condition;
    }
    if (typeof b.notes === "string") {
      patch.notes = b.notes.trim();
    }
    if ("enrolled_students_id" in b) {
      const studentId = Number(b.enrolled_students_id);
      if (!Number.isFinite(studentId) || studentId < 0) {
        return NextResponse.json(
          { error: "enrolled_students_id must be a student id or 0" },
          { status: 400 }
        );
      }
      let familyId = 0;
      if (studentId > 0) {
        const student = await xano.students.getById(studentId).catch(() => null);
        if (!student) {
          return NextResponse.json(
            { error: `Student ${studentId} not found` },
            { status: 404 }
          );
        }
        familyId = Number(student.registration_families_id) || 0;
      }
      patch.enrolled_students_id = studentId;
      patch.enrolled_families_id = familyId;
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json(
        { error: "No editable fields in body" },
        { status: 400 }
      );
    }

    const updated = await xano.laptopAssignments.update(id, patch);
    return NextResponse.json(updated);
  } catch (err) {
    return handleAdminError(err);
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const id = await rowId(params);
    if (!id) {
      return NextResponse.json(
        { error: "Invalid assignment id" },
        { status: 400 }
      );
    }
    await xano.laptopAssignments.remove(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleAdminError(err);
  }
}

async function rowId(params: Promise<{ id: string }>): Promise<number | null> {
  const { id: idParam } = await params;
  const id = Number(idParam);
  return Number.isFinite(id) && id > 0 ? id : null;
}

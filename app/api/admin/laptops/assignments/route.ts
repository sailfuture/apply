import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import { buildLaptopLinkResolver, NO_LAPTOP_LINKS } from "@/lib/laptop-links";

/**
 * Open a laptop checkout — assign a device to an enrolled student.
 *
 *   POST { laptops_id, enrolled_students_id, assigned_date?,
 *          assigned_condition?, notes? }
 *
 * Guards: the device must exist and be active with no open checkout;
 * the student must exist and not already hold a device (the picker
 * disables them client-side, but the server is the real gate against
 * double-issuing). That gate has to look past the bridge columns:
 * most open checkouts were created by the RFID system and carry only
 * an ops UUID, so a student already holding one of those would
 * otherwise sail through and end up with two. The enrolled family id
 * is derived from the student row so the parent Store page can match
 * the assignment.
 */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }
    const b = body as Record<string, unknown>;
    const laptopId = Number(b.laptops_id);
    const studentId = Number(b.enrolled_students_id);
    if (!Number.isFinite(laptopId) || laptopId <= 0) {
      return NextResponse.json(
        { error: "laptops_id is required" },
        { status: 400 }
      );
    }
    if (!Number.isFinite(studentId) || studentId <= 0) {
      return NextResponse.json(
        { error: "enrolled_students_id is required" },
        { status: 400 }
      );
    }

    const [device, student, assignments, opsStudents, allStudents] =
      await Promise.all([
        xano.laptops.getById(laptopId).catch(() => null),
        xano.students.getById(studentId).catch(() => null),
        xano.laptopAssignments.getAll(),
        xano.opsStudents.getAll().catch(() => null),
        xano.students.getAll().catch(() => null),
      ]);
    if (!device) {
      return NextResponse.json(
        { error: `Laptop ${laptopId} not found` },
        { status: 404 }
      );
    }
    if (device.isArchived === true) {
      return NextResponse.json(
        { error: "This laptop is deactivated — reactivate it first" },
        { status: 409 }
      );
    }
    if (!student) {
      return NextResponse.json(
        { error: `Student ${studentId} not found` },
        { status: 404 }
      );
    }
    // Someone who has left keeps whatever they already hold — that
    // history is real and stays linkable via PATCH — but must not be
    // issued a new device. The picker greys them out; this is the
    // rule actually being enforced.
    if (student.isArchived === true || student.isEnrolled !== true) {
      const name = `${student.first_name} ${student.last_name}`.trim();
      return NextResponse.json(
        {
          error: `${name || "That student"} is ${
            student.isArchived === true ? "archived" : "not enrolled"
          } — re-enroll them before issuing a laptop`,
        },
        { status: 409 }
      );
    }
    // Resolve ops UUIDs so RFID-created checkouts count toward the
    // one-device-per-student rule. A roster outage falls back to
    // bridge columns only — the guard weakens, it doesn't block work.
    const links =
      opsStudents && allStudents
        ? buildLaptopLinkResolver(opsStudents, allStudents)
        : NO_LAPTOP_LINKS;
    const open = assignments.filter((a) => !a.returned_date);
    const deviceBusy = open.find((a) => Number(a.laptops_id) === laptopId);
    if (deviceBusy) {
      return NextResponse.json(
        { error: "This laptop already has an open assignment" },
        { status: 409 }
      );
    }
    const studentBusy = open.find(
      (a) =>
        Number(a.enrolled_students_id) === studentId ||
        links.resolve(a.students_id)?.enrolled_students_id === studentId
    );
    if (studentBusy) {
      const heldAsset = (
        await xano.laptops.getById(Number(studentBusy.laptops_id)).catch(() => null)
      )?.asset_number;
      return NextResponse.json(
        {
          error: `${student.first_name} ${student.last_name} already has a laptop checked out${
            heldAsset ? ` (${heldAsset.trim()})` : ""
          }`,
        },
        { status: 409 }
      );
    }

    const assignedDate = Number(b.assigned_date);
    const condition =
      typeof b.assigned_condition === "string"
        ? b.assigned_condition.trim().toUpperCase()
        : "";
    const created = await xano.laptopAssignments.create({
      laptops_id: laptopId,
      enrolled_students_id: studentId,
      enrolled_families_id: Number(student.registration_families_id) || 0,
      assigned_date:
        Number.isFinite(assignedDate) && assignedDate > 0
          ? assignedDate
          : Date.now(),
      assigned_condition: condition || "A",
      returned_date: null,
      returned_condition: "",
      notes: typeof b.notes === "string" ? b.notes.trim() : "",
    });
    return NextResponse.json(created);
  } catch (err) {
    return handleAdminError(err);
  }
}

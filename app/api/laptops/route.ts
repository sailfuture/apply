import { auth, currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { xano } from "@/lib/xano";

/**
 * Devices currently checked out to the authenticated family's
 * students — read from the staff-side laptop inventory
 * (`laptop_assignments` + `laptops` on the operations Xano group).
 *
 * Only assignments admin has LINKED to an enrolled student/family
 * (bridge columns `enrolled_students_id` / `enrolled_families_id`)
 * are visible, and only while un-returned. Returns [] on any lookup
 * failure so the parent Store section simply hides.
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const familyId = user.publicMetadata.registration_families_id as
    | number
    | undefined;
  if (!familyId) {
    return NextResponse.json([], { status: 200 });
  }

  try {
    const [students, assignments, devices] = await Promise.all([
      xano.students.getByFamilyId(familyId),
      xano.laptopAssignments.getAll(),
      xano.laptops.getAll(),
    ]);
    const studentNameById = new Map(
      students.map((s) => [s.id, `${s.first_name} ${s.last_name}`.trim()])
    );
    const deviceById = new Map(devices.map((d) => [d.id, d]));

    const own = assignments
      .filter((a) => {
        // Still checked out…
        if (a.returned_date) return false;
        // …and linked to this family (directly, or via one of its
        // students).
        return (
          Number(a.enrolled_families_id) === familyId ||
          studentNameById.has(Number(a.enrolled_students_id))
        );
      })
      .sort((a, b) => (a.assigned_date ?? 0) - (b.assigned_date ?? 0))
      .map((a) => {
        const device = deviceById.get(Number(a.laptops_id));
        return {
          id: a.id,
          student_name:
            studentNameById.get(Number(a.enrolled_students_id)) ?? "",
          make_model: device?.model ?? "School laptop",
          serial_number: device?.serial_number ?? "",
          asset_tag: device?.asset_number ?? "",
          /** Unix ms; 0 = unknown. */
          assigned_date: a.assigned_date ?? 0,
        };
      });
    return NextResponse.json(own, { status: 200 });
  } catch (err) {
    console.error("[/api/laptops] lookup failed:", err);
    return NextResponse.json([], { status: 200 });
  }
}

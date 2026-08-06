import { auth, currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { xano } from "@/lib/xano";

/**
 * Laptops assigned to the authenticated family's students — shown on
 * the parent Store page. Returns [] when the
 * `registration_student_laptops` table isn't reachable so the section
 * simply hides.
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
    const [students, laptops] = await Promise.all([
      xano.students.getByFamilyId(familyId),
      xano.studentLaptops.getAll(),
    ]);
    const nameById = new Map(
      students.map((s) => [s.id, `${s.first_name} ${s.last_name}`.trim()])
    );
    const own = laptops
      .filter((l) => nameById.has(Number(l.registration_students_id)))
      .sort((a, b) =>
        (a.assigned_date ?? "").localeCompare(b.assigned_date ?? "")
      )
      .map((l) => ({
        id: l.id,
        student_name:
          nameById.get(Number(l.registration_students_id)) ?? "",
        make_model: l.make_model ?? "",
        serial_number: l.serial_number ?? "",
        asset_tag: (l.asset_tag ?? "").trim(),
        assigned_date: l.assigned_date ?? "",
      }));
    return NextResponse.json(own, { status: 200 });
  } catch (err) {
    console.error("[/api/laptops] lookup failed:", err);
    return NextResponse.json([], { status: 200 });
  }
}

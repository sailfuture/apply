import { NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";

/**
 * Laptop assignments from the staff-side inventory system, joined
 * with device info and the enrolled-student linkage, plus the
 * student roster for the link picker.
 *
 * This app doesn't create or edit assignments — the staff system
 * owns that flow (RFID checkout etc.). Admin's only job here is
 * LINKING each assignment to an enrolled student so it shows on the
 * family's Store page; see the [id] PATCH route.
 *
 *   GET → { assignments: AdminLaptopRow[], students: LaptopStudentOption[] }
 */
export async function GET() {
  try {
    await requireAdmin();
    const [assignmentsR, devicesR, studentsAll, families] = await Promise.all([
      // Ops-group reads degrade to [] so the card renders a hint
      // instead of failing the whole page when the group is down.
      xano.laptopAssignments.getAll().catch((err) => {
        console.error("[/api/admin/laptops] assignments unavailable:", err);
        return [];
      }),
      xano.laptops.getAll().catch((err) => {
        console.error("[/api/admin/laptops] devices unavailable:", err);
        return [];
      }),
      xano.students.getAll(),
      xano.families.getAll(),
    ]);

    const familyName = new Map(
      families.map((f) => [f.id, f.family_name ?? ""])
    );
    const studentById = new Map(studentsAll.map((s) => [s.id, s]));
    const deviceById = new Map(devicesR.map((d) => [d.id, d]));

    const assignments: AdminLaptopRow[] = assignmentsR
      .map((a) => {
        const device = deviceById.get(Number(a.laptops_id));
        const linked = studentById.get(Number(a.enrolled_students_id));
        return {
          id: a.id,
          asset_number: device?.asset_number ?? "",
          model: device?.model ?? "Unknown device",
          serial_number: device?.serial_number ?? "",
          assigned_date: a.assigned_date ?? 0,
          assigned_condition: (a.assigned_condition ?? "").trim(),
          returned: !!a.returned_date,
          returned_date: a.returned_date ?? 0,
          enrolled_students_id: Number(a.enrolled_students_id) || 0,
          student_name: linked
            ? `${linked.first_name} ${linked.last_name}`.trim()
            : "",
          family_name: linked
            ? familyName.get(Number(linked.registration_families_id)) || ""
            : "",
        };
      })
      // Active checkouts first (newest assignment on top), returned
      // history after.
      .sort(
        (a, b) =>
          Number(a.returned) - Number(b.returned) ||
          (b.assigned_date || 0) - (a.assigned_date || 0)
      );

    const students: LaptopStudentOption[] = studentsAll
      .filter((s) => s.isArchived !== true)
      .map((s) => ({
        id: s.id,
        name: `${s.first_name} ${s.last_name}`.trim(),
        family_name: familyName.get(Number(s.registration_families_id)) || "",
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({ assignments, students });
  } catch (err) {
    return handleAdminError(err);
  }
}

/** One assignment row shaped for the admin Store page. */
export interface AdminLaptopRow {
  id: number;
  asset_number: string;
  model: string;
  serial_number: string;
  /** Unix ms; 0 = unknown. */
  assigned_date: number;
  assigned_condition: string;
  returned: boolean;
  returned_date: number;
  /** 0 = not linked to an enrolled student yet. */
  enrolled_students_id: number;
  student_name: string;
  family_name: string;
}

export interface LaptopStudentOption {
  id: number;
  name: string;
  family_name: string;
}

export interface AdminLaptopsResponse {
  assignments: AdminLaptopRow[];
  students: LaptopStudentOption[];
}

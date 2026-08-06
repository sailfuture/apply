import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { parseLaptopBody } from "@/lib/laptops";
import { xano } from "@/lib/xano";
import type { XanoStudentLaptop } from "@/lib/xano";

/**
 * Admin laptop assignments — full list with student + family names
 * joined, plus the student roster for the assign dialog's picker.
 *
 *   GET → { laptops: AdminLaptopRow[], students: LaptopStudentOption[] }
 *   POST { registration_students_id, make_model, serial_number,
 *          asset_tag?, assigned_date?, notes? }
 */
export async function GET() {
  try {
    await requireAdmin();
    const [laptopsR, studentsAll, families] = await Promise.all([
      // Laptops degrade to [] so the page still renders (with the
      // setup hint) before the Xano table exists.
      xano.studentLaptops.getAll().catch((err) => {
        console.error("[/api/admin/laptops] table unavailable:", err);
        return [];
      }),
      xano.students.getAll(),
      xano.families.getAll(),
    ]);
    const familyName = new Map(
      families.map((f) => [f.id, f.family_name ?? ""])
    );
    const studentById = new Map(studentsAll.map((s) => [s.id, s]));
    const laptops: AdminLaptopRow[] = laptopsR
      .map((l) => {
        const s = studentById.get(Number(l.registration_students_id));
        return {
          ...l,
          student_name: s ? `${s.first_name} ${s.last_name}`.trim() : "—",
          family_name: s
            ? familyName.get(Number(s.registration_families_id)) || ""
            : "",
        };
      })
      .sort((a, b) => a.student_name.localeCompare(b.student_name));

    const students: LaptopStudentOption[] = studentsAll
      .filter((s) => s.isArchived !== true)
      .map((s) => ({
        id: s.id,
        name: `${s.first_name} ${s.last_name}`.trim(),
        family_name: familyName.get(Number(s.registration_families_id)) || "",
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({ laptops, students });
  } catch (err) {
    return handleAdminError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = await req.json().catch(() => null);
    const parsed = parseLaptopBody(body, { requireCore: true });
    if ("error" in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const created = await xano.studentLaptops.create({
      registration_students_id: parsed.registration_students_id!,
      make_model: parsed.make_model!,
      serial_number: parsed.serial_number!,
      asset_tag: parsed.asset_tag ?? "",
      assigned_date: parsed.assigned_date ?? "",
      notes: parsed.notes ?? "",
    });
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    return handleAdminError(err);
  }
}

export type AdminLaptopRow = XanoStudentLaptop & {
  student_name: string;
  family_name: string;
};

export interface LaptopStudentOption {
  id: number;
  name: string;
  family_name: string;
}

export interface AdminLaptopsResponse {
  laptops: AdminLaptopRow[];
  students: LaptopStudentOption[];
}

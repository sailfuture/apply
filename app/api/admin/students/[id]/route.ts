import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";

/**
 * Per-student admin view — returns everything the multi-year history
 * page needs in a single response:
 *
 *   - the student record (basics + cross-year document arrays)
 *   - the family record (so the page can link back / show family name)
 *   - every application across every year for this student
 *   - every packet across every year for this student, enriched via
 *     `/registration_student_registration_details` (so each carries its
 *     school year + registration type inline)
 *
 * This collapses what would otherwise be N+M+1 separate fetches into one
 * server-side aggregation. The cost is a few parallel Xano calls — fine
 * for an admin tool.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const { id: idParam } = await params;
    const studentId = Number(idParam);
    if (!Number.isFinite(studentId)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const student = await xano.students.getById(studentId);
    if (!student) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    const familyId = student.registration_families_id;

    // Pull family details + applications in parallel. Apps live inside
    // the `/registration_families_all_details` payload so we lift them
    // out by family id, then narrow to this student.
    const [familiesDetails, packetIdsRaw] = await Promise.all([
      xano.families.getAllDetails(),
      Promise.resolve(student.registration_student_registration_id ?? []),
    ]);

    const family =
      familiesDetails.find((f) => f.id === familyId) ?? null;

    const studentApps = (family?.registration_students_id ?? [])
      .filter((a) => Number(a.registration_students_id) === studentId)
      .sort(
        (a, b) =>
          Number(b.registration_school_years_id) -
          Number(a.registration_school_years_id)
      );

    // Enrich each packet via the new details endpoint — sequential
    // would be slow, parallel is cheap.
    const packetIds = (packetIdsRaw as number[]).filter(
      (id) => typeof id === "number" && id > 0
    );
    const packets = (
      await Promise.all(
        packetIds.map((pid) => xano.studentRegistration.getDetailsById(pid))
      )
    ).filter((p): p is NonNullable<typeof p> => p !== null);

    // Sort packets newest year first so the page shows current year up top.
    packets.sort(
      (a, b) =>
        Number(b.registration_school_years_id) -
        Number(a.registration_school_years_id)
    );

    return NextResponse.json({
      student,
      family: family
        ? {
            id: family.id,
            family_name: family.family_name,
            isAccepted: family.isAccepted,
            isSubmitted: family.isSubmitted,
          }
        : null,
      applications: studentApps,
      packets,
    });
  } catch (err) {
    return handleAdminError(err);
  }
}

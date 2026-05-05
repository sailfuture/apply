import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import type {
  XanoApplication,
  XanoEmergencyContact,
  XanoFamily,
  XanoParent,
  XanoStudent,
  XanoStudentRegistration,
  XanoStudentRegistrationProgress,
} from "@/lib/xano";

/**
 * Admin GET — aggregated family registration view.
 *
 * Returns everything the family-focused registration detail page
 * needs to render the four packet section cards (Tuition / Enrollment
 * Agreement / Registration Packet / Volunteer Hours) including the
 * full per-student packet contents (sizes, medical, file uploads,
 * waiver state) and the family's emergency contacts roster.
 *
 * Strategy:
 *   - `admin_family_application` aggregate gives us family + parents
 *     + students + apps for the year in one call
 *   - Family-level `registration_student_registration_progress` row
 *     holds the four packet booleans + tuition / enrollment-agreement
 *     fields; resolved-or-created so the page renders even before
 *     the parent has touched a single section
 *   - Per-student `registration_student_registration` packets pulled
 *     for the year and joined to active applications. We surface the
 *     ENTIRE packet shape (not just confirmation state) so the page
 *     can render the parent-facing form as a read-only summary —
 *     mirrors the application page's "view what the parent sees"
 *     pattern.
 *   - Emergency contacts pulled by family id since they're family-
 *     scoped, not per-student
 *
 * Each lookup is wrapped in try/catch and missing data falls back to
 * sensible defaults so a single Xano hiccup never 500s the page.
 *
 * URL: `/api/admin/registrations/[familyId]?yearId=X`
 *   (the `[id]` param is the family id — we mirror the
 *   `/admin/families/[id]` URL shape so the dynamic segment is the
 *   thing humans navigate to)
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const { id: idParam } = await params;
    const familyId = Number(idParam);
    if (!Number.isFinite(familyId) || familyId <= 0) {
      return NextResponse.json(
        { error: "Invalid family id" },
        { status: 400 }
      );
    }

    const yearIdParam = req.nextUrl.searchParams.get("yearId");
    const yearId = Number(yearIdParam);
    if (!Number.isFinite(yearId) || yearId <= 0) {
      return NextResponse.json(
        { error: "yearId is required" },
        { status: 400 }
      );
    }

    const [
      aggResult,
      progressResult,
      packetsResult,
      parentsResult,
      studentsResult,
      emergencyResult,
    ] = await Promise.allSettled([
      xano.applications.getAdminFamilyDetail(familyId, yearId),
      xano.studentRegistrationProgress.resolve(familyId, yearId),
      xano.studentRegistration.getByYear(yearId),
      xano.parents.getAll(),
      xano.students.getAll(),
      xano.emergencyContacts.getByFamilyId(familyId),
    ]);

    if (aggResult.status === "rejected") {
      console.error(
        "[/api/admin/registrations/[id]] admin_family_application failed:",
        aggResult.reason
      );
    }
    if (progressResult.status === "rejected") {
      console.error(
        "[/api/admin/registrations/[id]] family progress resolve failed:",
        progressResult.reason
      );
    }
    if (packetsResult.status === "rejected") {
      console.error(
        "[/api/admin/registrations/[id]] student packets failed:",
        packetsResult.reason
      );
    }
    if (emergencyResult.status === "rejected") {
      console.error(
        "[/api/admin/registrations/[id]] emergency contacts failed:",
        emergencyResult.reason
      );
    }

    const agg =
      aggResult.status === "fulfilled" ? aggResult.value : null;
    const progress =
      progressResult.status === "fulfilled" ? progressResult.value : null;
    const allPackets =
      packetsResult.status === "fulfilled" ? packetsResult.value : [];
    const parents =
      parentsResult.status === "fulfilled" ? parentsResult.value : [];
    const studentsAll =
      studentsResult.status === "fulfilled" ? studentsResult.value : [];
    const emergencyContacts =
      emergencyResult.status === "fulfilled" ? emergencyResult.value : [];

    if (!agg) {
      return NextResponse.json(
        { error: "Family not found for this year" },
        { status: 404 }
      );
    }

    const family: XanoFamily | null = agg.family
      ? // Aggregate omits the emergency-contacts back-reference; cast
        // through unknown since we don't read that field here.
        ((agg.family as unknown) as XanoFamily)
      : null;
    const schoolYear = agg.school_year;
    const apps: XanoApplication[] = Array.isArray(agg.application)
      ? agg.application
      : [];

    const activeApps = apps.filter((a) => a.isActive !== false);
    const activeStudentIds = new Set(
      activeApps.map((a) => Number(a.registration_students_id))
    );

    const studentById = new Map(studentsAll.map((s) => [s.id, s]));
    const packetByStudentId = new Map<number, XanoStudentRegistration>();
    for (const p of allPackets) {
      const sid = Number(p.registration_students_id);
      if (activeStudentIds.has(sid)) {
        packetByStudentId.set(sid, p);
      }
    }

    const parentIds = family ? xano.families.getParentIds(family) : [];
    const familyParents = parents.filter((p) => parentIds.includes(p.id));
    const sortedParents = familyParents
      .slice()
      .sort((a, b) => a.id - b.id);
    const primary: XanoParent | null = sortedParents[0] ?? null;

    // Per-student packet rows — the entire `XanoStudentRegistration`
    // shape, plus the joined student bio fields the page uses for the
    // section header (name, DOB, grade). Returning the full packet
    // lets the client render every parent-facing field as a
    // disabled-input summary the same way the application page does.
    const studentRows: AdminFamilyRegistrationStudentRow[] = activeApps.map(
      (app) => {
        const studentId = Number(app.registration_students_id);
        const student: XanoStudent | null = studentById.get(studentId) ?? null;
        const packet: XanoStudentRegistration | null =
          packetByStudentId.get(studentId) ?? null;
        return {
          application_id: app.id,
          student_id: studentId,
          student_first_name: student?.first_name ?? "",
          student_last_name: student?.last_name ?? "",
          student_full_name: student
            ? `${student.first_name ?? ""} ${student.last_name ?? ""}`.trim()
            : `Student #${studentId}`,
          student_date_of_birth: student?.date_of_birth ?? "",
          student_grade: app.current_grade ?? "",
          packet,
        };
      }
    );

    return NextResponse.json({
      family: family
        ? {
            id: family.id,
            family_name: family.family_name ?? "",
          }
        : null,
      primary: primary
        ? {
            id: primary.id,
            first_name: primary.first_name ?? "",
            last_name: primary.last_name ?? "",
            email: primary.email ?? "",
            phone: primary.phone ?? "",
          }
        : null,
      school_year: {
        id: schoolYear.id,
        year_name: schoolYear.year_name ?? "",
        tuition: schoolYear.tuition ?? 0,
        annual_fees: schoolYear.annual_fees ?? 0,
        transportation_fees: schoolYear.transportation_fees ?? 0,
      },
      progress: progress as XanoStudentRegistrationProgress | null,
      students: studentRows,
      emergency_contacts: emergencyContacts as XanoEmergencyContact[],
    } satisfies AdminFamilyRegistrationResponse);
  } catch (err) {
    return handleAdminError(err);
  }
}

/**
 * Response shape the family registration detail page consumes. Carries
 * the full per-student packet object so the page can render every
 * parent-facing field as a disabled summary input, plus the family-
 * scoped emergency contacts roster.
 */
export interface AdminFamilyRegistrationResponse {
  family: { id: number; family_name: string } | null;
  primary: {
    id: number;
    first_name: string;
    last_name: string;
    email: string;
    phone: string;
  } | null;
  school_year: {
    id: number;
    year_name: string;
    tuition: number;
    annual_fees: number;
    transportation_fees: number;
  };
  progress: XanoStudentRegistrationProgress | null;
  students: AdminFamilyRegistrationStudentRow[];
  emergency_contacts: XanoEmergencyContact[];
}

export interface AdminFamilyRegistrationStudentRow {
  application_id: number;
  student_id: number;
  student_first_name: string;
  student_last_name: string;
  student_full_name: string;
  student_date_of_birth: string;
  student_grade: string;
  /** Full packet object; null when the parent hasn't started one yet. */
  packet: XanoStudentRegistration | null;
}

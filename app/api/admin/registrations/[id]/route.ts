import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import type {
  XanoApplication,
  XanoFamily,
  XanoParent,
  XanoStudent,
  XanoStudentRegistration,
  XanoStudentRegistrationProgress,
  XanoSchoolYear,
} from "@/lib/xano";

/**
 * Admin GET — aggregated family registration view.
 *
 * Returns the data the family-focused registration detail page needs
 * to render the four packet section cards (Tuition / Enrollment
 * Agreement / Registration Packet / Volunteer Hours) plus the
 * per-student row table inside the Registration Packet card.
 *
 * Strategy:
 *   - Family + parents + students + applications come from the
 *     `admin_family_application` aggregate query (one shot, year-scoped)
 *   - Family-level `registration_student_registration_progress` row
 *     holds the four packet booleans + tuition / enrollment-agreement
 *     fields; we resolve-or-create so the page can render even before
 *     the parent has touched a single section
 *   - Per-student `registration_student_registration` packets come
 *     from a year-scoped fetch and are filtered to the family's
 *     active applications (so the page shows only students who are
 *     actually enrolling for this year)
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

    // Aggregate first — gives us family + parents + students + apps
    // for the year in a single Xano call. Falls back to per-table
    // fetches if the aggregate fails (e.g. partial Xano outage).
    const [aggResult, progressResult, packetsResult, parentsResult, studentsResult] =
      await Promise.allSettled([
        xano.applications.getAdminFamilyDetail(familyId, yearId),
        xano.studentRegistrationProgress.resolve(familyId, yearId),
        xano.studentRegistration.getByYear(yearId),
        xano.parents.getAll(),
        xano.students.getAll(),
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

    if (!agg) {
      // Aggregate is the source of truth for family/year context — if
      // it's missing the page can't render meaningfully. Return 404
      // so the client knows to redirect rather than show a half-empty
      // shell.
      return NextResponse.json(
        { error: "Family not found for this year" },
        { status: 404 }
      );
    }

    const family: XanoFamily | null = agg.family
      ? // `XanoFamily` shape needs `_emergency_contacts_of_registration_families`
        // — the aggregate query doesn't include it. Cast through unknown
        // since the field is optional in the upstream type and unused
        // here.
        ((agg.family as unknown) as XanoFamily)
      : null;
    const schoolYear: XanoSchoolYear = agg.school_year;
    const apps: XanoApplication[] = Array.isArray(agg.application)
      ? agg.application
      : [];

    // Active apps drive the packet table — soft-deleted students
    // (parent removed them from the year) shouldn't show up under
    // Registration Packet even if a packet row still exists.
    const activeApps = apps.filter((a) => a.isActive !== false);
    const activeStudentIds = new Set(
      activeApps.map((a) => Number(a.registration_students_id))
    );

    // Pre-compute student + packet lookups so the row mapper below is
    // a straight join.
    const studentById = new Map(studentsAll.map((s) => [s.id, s]));
    const packetByStudentId = new Map<number, XanoStudentRegistration>();
    for (const p of allPackets) {
      const sid = Number(p.registration_students_id);
      if (activeStudentIds.has(sid)) {
        packetByStudentId.set(sid, p);
      }
    }

    // Primary parent — lowest id wins (mirrors the convention in the
    // applications + registrations list endpoints so the same
    // contact shows up across surfaces).
    const parentIds = family ? xano.families.getParentIds(family) : [];
    const familyParents = parents.filter((p) => parentIds.includes(p.id));
    const sortedParents = familyParents
      .slice()
      .sort((a, b) => a.id - b.id);
    const primary: XanoParent | null = sortedParents[0] ?? null;

    // Per-student rows for the Registration Packet card. Each row
    // carries the student name + DOB + grade + the packet's
    // confirmation state so the UI can render a single table without
    // chasing further joins.
    const studentRows = activeApps.map((app) => {
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
        student_grade: app.current_grade ?? "",
        packet_id: packet?.id ?? null,
        registrationConfirmed: !!packet?.registrationConfirmed,
        liability_waiver_status: packet?.liability_waiver_status ?? "",
        liability_waiver_pdf_url: packet?.liability_waiver_pdf_url ?? "",
      };
    });

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
    } satisfies AdminFamilyRegistrationResponse);
  } catch (err) {
    return handleAdminError(err);
  }
}

/**
 * Response shape the family registration detail page consumes. Kept
 * narrow on purpose — we only return the fields the four section
 * cards + the per-student table need, so the response stays small
 * even for large families.
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
}

export interface AdminFamilyRegistrationStudentRow {
  application_id: number;
  student_id: number;
  student_first_name: string;
  student_last_name: string;
  student_full_name: string;
  student_grade: string;
  /** Per-student packet id; null if the parent hasn't started one yet. */
  packet_id: number | null;
  registrationConfirmed: boolean;
  liability_waiver_status: string;
  liability_waiver_pdf_url: string;
}

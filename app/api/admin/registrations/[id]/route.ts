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
      paymentResult,
    ] = await Promise.allSettled([
      xano.applications.getAdminFamilyDetail(familyId, yearId),
      xano.studentRegistrationProgress.resolve(familyId, yearId),
      xano.studentRegistration.getByYear(yearId),
      xano.parents.getAll(),
      xano.students.getAll(),
      xano.emergencyContacts.getByFamilyId(familyId),
      // Legacy `registration_families_payment` row — pulled here as a
      // fallback for the Tuition card's monthly snapshot. The Approve
      // flow snapshots the monthly tuition + transport onto BOTH this
      // legacy row and the registration progress row, but families
      // approved before the dual-write fix landed only carry the
      // amounts on this legacy row. Reading both lets us paper over
      // that delta until the legacy table is fully retired.
      xano.familyPayments.getByFamilyAndYear(familyId, yearId),
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
    if (paymentResult.status === "rejected") {
      console.error(
        "[/api/admin/registrations/[id]] family payment fallback failed:",
        paymentResult.reason
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
    const familyPayment =
      paymentResult.status === "fulfilled" ? paymentResult.value : null;

    // Backfill the progress row's monthly columns from the legacy
    // `registration_families_payment` row when missing. Conditions:
    //   - Progress column reads as 0 / undefined (default).
    //   - Legacy column carries a real value.
    // The legacy `transportation_total` is annual; convert to monthly
    // before comparing/assigning. Mutates the in-memory `progress`
    // only — Xano isn't written from here. This is a read-side
    // shim; the durable fix lives on the Approve flow's dual-write.
    if (progress && familyPayment) {
      // `monthly_tuition_payment` on the legacy row is nullable now
      // (pre-acceptance rows carry null). Narrow before comparing.
      if (
        (!progress.monthly_tuition_payment ||
          progress.monthly_tuition_payment === 0) &&
        typeof familyPayment.monthly_tuition_payment === "number" &&
        familyPayment.monthly_tuition_payment > 0
      ) {
        progress.monthly_tuition_payment =
          familyPayment.monthly_tuition_payment;
      }
      if (
        (!progress.monthly_transportation_payment ||
          progress.monthly_transportation_payment === 0) &&
        typeof familyPayment.transportation_total === "number" &&
        familyPayment.transportation_total > 0
      ) {
        progress.monthly_transportation_payment =
          Math.round((familyPayment.transportation_total / 12) * 100) /
          100;
      }
    }

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
          // Evergreen document uploads live on the *student* row as
          // arrays of file blobs (not on the per-year packet — those
          // columns are legacy / empty). Parents can upload multiple
          // files per category, so the row carries the raw arrays;
          // the per-student card renders one row per file.
          student_documents: {
            birth_certificate: normalizeFileArray(student?.birth_certificate),
            school_health_form: normalizeFileArray(
              student?.school_health_form
            ),
            transcripts: normalizeFileArray(student?.transcripts),
            iep: normalizeFileArray(student?.iep),
            ssn_card: normalizeFileArray(student?.ssn_card),
            immunization_forms: normalizeFileArray(student?.immunization_forms),
            passport: normalizeFileArray(student?.passport),
            student_state_id: normalizeFileArray(student?.student_state_id),
          },
          // Per-document admin-confirm state. Live on the student
          // row (added against the `2GcBXyoA` admin group). Optional
          // on `XanoStudent` — legacy rows return `undefined` for
          // these fields, which the UI reads as "not yet confirmed."
          document_confirms: {
            birth_certificate: {
              confirmed: student?.birth_certificate_admin_confirm === true,
              confirmed_time:
                student?.birth_certificate_admin_confirm_time ?? null,
              confirmed_admin:
                student?.birth_certificate_admin_confirm_admin ?? "",
            },
            school_health_form: {
              confirmed:
                student?.school_health_form_admin_confirm === true,
              confirmed_time:
                student?.school_health_form_admin_confirm_time ?? null,
              confirmed_admin:
                student?.school_health_form_admin_confirm_admin ?? "",
            },
            transcripts: {
              confirmed: student?.transcripts_admin_confirm === true,
              confirmed_time:
                student?.transcripts_admin_confirm_time ?? null,
              confirmed_admin:
                student?.transcripts_admin_confirm_admin ?? "",
            },
            immunization_forms: {
              confirmed: student?.immunization_admin_confirm === true,
              confirmed_time:
                student?.immunization_admin_confirm_time ?? null,
              confirmed_admin:
                student?.immunization_admin_confirm_admin ?? "",
            },
          },
          // Admin verification triplet — lives on the per-packet
          // `registration_student_registration` row (each year a
          // student re-enrolls gets its own packet, with its own
          // verify state). Surfaced here so the per-student card
          // can render the "Verify {Name} Registration" footer +
          // audit caption without an extra fetch.
          is_verified: packet?.registrationConfirmed === true,
          is_admin_verified_time:
            packet?.registration_confirmed_admin_time ?? null,
          is_admin_verified_admin:
            packet?.regisration_admin_confirmed_admin ?? "",
          // Per-application fields driving the Tuition card's
          // per-student breakdown table. Same data the parent's
          // `/dashboard/tuition` reads — the family-side and admin-
          // side surfaces compute the same numbers from the same
          // source so admin sees exactly what the parent signed.
          sufs_status: app.sufs_status ?? "",
          sufs_type: app.sufs_type ?? "",
          opportunity_scholarship_award_amount:
            app.opportunity_scholarship_award_amount ?? null,
          is_bus_transportation: !!app.is_bus_transportation,
          bus_stop: app.bus_stop ?? "",
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
        // Per-SUFS-tier award amounts. The Tuition card's per-student
        // breakdown reads these to compute the green "Step Up Award
        // Amount" line — same math the parent dashboard's
        // /dashboard/tuition page runs. Falls back to 0 for any tier
        // not configured on this year.
        fes_eo_8: schoolYear.fes_eo_8 ?? 0,
        fes_eo_9: schoolYear.fes_eo_9 ?? 0,
        ftc_8: schoolYear.ftc_8 ?? 0,
        ftc_9: schoolYear.ftc_9 ?? 0,
        fes_ua_8_ese_1_3: schoolYear.fes_ua_8_ese_1_3 ?? 0,
        fes_ua_9_ese_1_3: schoolYear.fes_ua_9_ese_1_3 ?? 0,
        fes_ua_ese_4: schoolYear.fes_ua_ese_4 ?? 0,
        fes_ua_ese_5: schoolYear.fes_ua_ese_5 ?? 0,
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
    fes_eo_8: number;
    fes_eo_9: number;
    ftc_8: number;
    ftc_9: number;
    fes_ua_8_ese_1_3: number;
    fes_ua_9_ese_1_3: number;
    fes_ua_ese_4: number;
    fes_ua_ese_5: number;
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
  /** Evergreen document arrays from the student row (not the packet).
   *  One file blob per upload — parents can upload multiple per
   *  category. Each entry carries Xano's `{ name, path, url?, mime,
   *  size }` shape. */
  student_documents: {
    birth_certificate: Record<string, unknown>[];
    school_health_form: Record<string, unknown>[];
    transcripts: Record<string, unknown>[];
    iep: Record<string, unknown>[];
    ssn_card: Record<string, unknown>[];
    immunization_forms: Record<string, unknown>[];
    passport: Record<string, unknown>[];
    student_state_id: Record<string, unknown>[];
  };
  /** Per-document admin-confirm state for the four required
   *  documents. The bool is what the UI reads/writes; time + admin
   *  name are auto-stamped server-side. Audit triplets live on the
   *  student row in Xano (added against the `2GcBXyoA` admin
   *  group). All three optional because legacy rows pre-date the
   *  column add. */
  document_confirms: {
    birth_certificate: {
      confirmed: boolean;
      confirmed_time: number | null;
      confirmed_admin: string;
    };
    school_health_form: {
      confirmed: boolean;
      confirmed_time: number | null;
      confirmed_admin: string;
    };
    transcripts: {
      confirmed: boolean;
      confirmed_time: number | null;
      confirmed_admin: string;
    };
    immunization_forms: {
      confirmed: boolean;
      confirmed_time: number | null;
      confirmed_admin: string;
    };
  };
  /** Admin verification triplet pulled from the student row. */
  is_verified: boolean;
  is_admin_verified_time: number | null;
  is_admin_verified_admin: string;
  /** Per-application Step Up status / type / scholarship amount and
   *  transportation election. Same fields the parent-facing tuition
   *  table reads from the application row — surfaced here so the
   *  Tuition card on the registration detail page can render the
   *  identical breakdown without admin needing to cross-reference
   *  the apply-flow view. */
  sufs_status: string;
  sufs_type: string;
  opportunity_scholarship_award_amount: number | null;
  is_bus_transportation: boolean;
  bus_stop: string;
}

/**
 * Coerce Xano's file column into an array of file blobs. Xano has
 * historically returned `[]`, `null`, or `{}` for empty file
 * columns — the live schema settled on `[]`, but we tolerate the
 * older shapes so a partial migration doesn't crash the page.
 * Mirrors the helper in `/api/admin/enrolled/[id]`.
 */
function normalizeFileArray(raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw)) {
    return raw.filter(
      (entry): entry is Record<string, unknown> =>
        typeof entry === "object" && entry !== null
    );
  }
  return [];
}

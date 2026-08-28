import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import type { EnrolledExportRow } from "@/lib/enrolled-export-columns";

/**
 * Data source for the Enrolled Students XLSX export.
 *
 *   GET /api/admin/enrolled/export?yearId=Y  →  EnrolledExportRow[]
 *
 * One row per student who is either officially enrolled OR formally
 * unenrolled for the year — the same two buckets the Enrolled Students
 * page renders (never-enrolled / pending students live in the
 * application + registration queues, not here). Every value is a
 * pre-formatted string so the client can drop it straight into a
 * spreadsheet cell; the `is_*` booleans back the modal's status /
 * program filters and aren't exported as columns.
 *
 * Joins mirror `/api/admin/enrolled` exactly (student is the pivot;
 * packet supplies placement + medical; family supplies the program
 * flag + label; parent supplies the primary contact), but the row is
 * the comprehensive export projection rather than the lean list shape.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const yearIdParam = req.nextUrl.searchParams.get("yearId");
    const yearId = Number(yearIdParam);
    if (!Number.isFinite(yearId) || yearId <= 0) {
      return NextResponse.json(
        { error: "yearId must be a positive number" },
        { status: 400 }
      );
    }

    const [
      packetsResult,
      appsResult,
      studentsResult,
      familiesResult,
      parentsResult,
      contactsResult,
    ] = await Promise.allSettled([
      xano.studentRegistration.getByYear(yearId),
      xano.applications.getAll(),
      xano.students.getAll(),
      xano.families.getAll(),
      xano.parents.getAll(),
      xano.emergencyContacts.getAll(),
    ]);

    const packets =
      packetsResult.status === "fulfilled" ? packetsResult.value : [];
    const apps = appsResult.status === "fulfilled" ? appsResult.value : [];
    const students =
      studentsResult.status === "fulfilled" ? studentsResult.value : [];
    const families =
      familiesResult.status === "fulfilled" ? familiesResult.value : [];
    const parents =
      parentsResult.status === "fulfilled" ? parentsResult.value : [];
    const contacts =
      contactsResult.status === "fulfilled" ? contactsResult.value : [];

    if (studentsResult.status === "rejected") {
      console.error(
        "[/api/admin/enrolled/export] failed to load students:",
        studentsResult.reason
      );
    }

    const familyById = new Map(families.map((f) => [f.id, f]));
    const appByStudent = new Map<number, (typeof apps)[number]>();
    for (const a of apps) {
      if (Number(a.registration_school_years_id) !== yearId) continue;
      if (a.isActive === false) continue;
      appByStudent.set(Number(a.registration_students_id), a);
    }
    const packetByStudent = new Map<number, (typeof packets)[number]>();
    for (const p of packets) {
      packetByStudent.set(Number(p.registration_students_id), p);
    }
    // Primary + secondary parents per family — lowest id is primary,
    // matching the other admin list endpoints.
    const parentsByFamily = new Map<number, (typeof parents)>();
    for (const f of families) {
      const ids = xano.families.getParentIds(f);
      const matched = parents
        .filter((p) => ids.includes(p.id))
        .sort((a, b) => a.id - b.id);
      parentsByFamily.set(f.id, matched);
    }
    // Emergency contacts grouped by family, joined into one cell.
    const contactsByFamily = new Map<number, string>();
    for (const c of contacts) {
      const fid = Number(c.registration_families_id);
      if (!fid) continue;
      const name = `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim();
      if (!name) continue;
      const part = `${name}${c.relationship?.trim() ? ` (${c.relationship.trim()})` : ""}${c.phone?.toString().trim() ? ` · ${c.phone}` : ""}`;
      contactsByFamily.set(
        fid,
        contactsByFamily.has(fid)
          ? `${contactsByFamily.get(fid)}; ${part}`
          : part
      );
    }

    const rows: EnrolledExportRow[] = [];
    for (const student of students) {
      const app = appByStudent.get(student.id);
      if (!app) continue; // not on this year's roster

      const isEnrolled =
        student.isEnrolled === true && student.isArchived !== true;
      const isArchived = student.isArchived === true;
      // Match the page: only enrolled or formally-unenrolled students.
      // Accepted-but-pending students belong to the registration queue.
      if (!isEnrolled && !isArchived) continue;

      const familyId = Number(app.registration_families_id);
      const family = familyById.get(familyId) ?? null;
      const familyParents = parentsByFamily.get(familyId) ?? [];
      const primary = familyParents[0] ?? null;
      const secondary = familyParents[1] ?? null;
      const packet = packetByStudent.get(student.id) ?? null;
      const enrolledAt =
        packet?.registration_confirmed_admin_time ??
        packet?.created_at ??
        student.created_at ??
        0;
      // `grade_level` + `crew_assignment` are admin placement fields
      // that exist on the Xano packet row but may not be declared on
      // the local `XanoStudentRegistration` type on this branch — read
      // them through a narrow cast so the export compiles and runs
      // regardless of which branch the type lives on.
      const placement = (packet ?? {}) as {
        grade_level?: string;
        crew_assignment?: string;
      };

      rows.push({
        student_id: student.id,
        is_enrolled: isEnrolled,
        is_archived: isArchived,
        is_residential: family?.is_residential === true,

        first_name: student.first_name ?? "",
        last_name: student.last_name ?? "",
        school_email: student.school_email ?? "",
        date_of_birth: student.date_of_birth ?? "",
        gender: student.gender ?? "",
        ethnicity: student.ethnicity ?? "",

        grade_level: placement.grade_level ?? "",
        incoming_grade: app.current_grade ?? "",
        crew_assignment: placement.crew_assignment ?? "",
        shirt_size: packet?.shirt_size ?? "",
        pant_size: packet?.pant_size ?? "",
        swim_level: packet?.swim_level ?? "",

        enrollment_status: isEnrolled ? "Enrolled" : "Unenrolled",
        program: family?.is_residential === true ? "Residential" : "Community",
        enrolled_date: tsToDate(enrolledAt),
        unenrollment_date: student.unenrollment_date ?? "",
        unenrollment_reason: student.unenrollment_reason ?? "",
        liability_waiver_status: packet?.liability_waiver_status ?? "",

        bus_transportation: app.is_bus_transportation === true ? "Yes" : "No",
        bus_stop: app.bus_stop ?? "",

        family_name: family?.family_name?.trim() || `Family #${familyId}`,
        primary_name: primary
          ? `${primary.first_name ?? ""} ${primary.last_name ?? ""}`.trim()
          : "",
        primary_email: primary?.email ?? "",
        primary_phone: (primary?.phone ?? "").toString(),
        secondary_name: secondary
          ? `${secondary.first_name ?? ""} ${secondary.last_name ?? ""}`.trim()
          : "",
        secondary_email: secondary?.email ?? "",
        secondary_phone: (secondary?.phone ?? "").toString(),
        emergency_contacts: contactsByFamily.get(familyId) ?? "",

        allergies: packet?.allergies ?? "",
        health_conditions: packet?.health_conditions ?? "",
        dietary_restrictions: packet?.dietary_restrictions ?? "",
        prescription_medications: packet?.prescription_medications ?? "",
        vision_impairments: packet?.vision_impairments ?? "",
        hearing_impairments: packet?.hearing_impairments ?? "",
        carry_epi_pen: packet?.carry_epi_pen === true ? "Yes" : "No",
        epi_pen_notes: packet?.epipen_explainer ?? "",
        acetaminophen_permission: packet?.permission_for_acetaminophen ?? "",
        counseling_interest: packet?.interested_in_counseling_services ?? "",
        additional_health_notes: packet?.additional_health_information ?? "",
        on_medicaid: packet?.is_student_on_medicaid === true ? "Yes" : "No",
        medicaid_number: packet?.medicaid_number
          ? String(packet.medicaid_number)
          : "",
        medicaid_provider: packet?.medicaid_provider ?? "",

        approved_pickup_adults: packet?.other_adults_approved_for_pickup ?? "",
        prohibited_adults: packet?.prohibited_adults ?? "",

        doc_birth_certificate: docState(
          student.birth_certificate,
          student.birth_certificate_admin_confirm
        ),
        doc_school_health_form: docState(
          student.school_health_form,
          student.school_health_form_admin_confirm
        ),
        doc_transcripts: docState(
          student.transcripts,
          student.transcripts_admin_confirm
        ),
        doc_immunization: docState(
          student.immunization_forms,
          student.immunization_admin_confirm
        ),

        nwea_math: numToStr(student.initial_screening_nwea_math),
        nwea_reading: numToStr(student.initial_screening_nwea_reading),
        nwea_math_date: student.initial_screening_nwea_math_date ?? "",
        nwea_reading_date: student.initial_screening_nwea_reading_date ?? "",
      });
    }

    // Stable, scan-friendly order: last name, then first name.
    rows.sort(
      (a, b) =>
        a.last_name.localeCompare(b.last_name) ||
        a.first_name.localeCompare(b.first_name)
    );

    return NextResponse.json(rows);
  } catch (err) {
    return handleAdminError(err);
  }
}

/** Required-document cell: admin-approved beats merely-uploaded;
 *  no valid file at all reads "Missing". */
function docState(
  files: unknown,
  approved: boolean | undefined
): string {
  const uploaded =
    Array.isArray(files) &&
    files.some(
      (f) => f && typeof f === "object" && (f as { path?: unknown }).path
    );
  if (approved === true) return "Approved";
  return uploaded ? "Uploaded" : "Missing";
}

/** Unix-ms timestamp → "YYYY-MM-DD", or "" for missing/zero. */
function tsToDate(ms: number | null | undefined): string {
  if (!ms || !Number.isFinite(ms)) return "";
  return new Date(ms).toISOString().slice(0, 10);
}

/** Numeric score → string, or "" when null/undefined. */
function numToStr(n: number | null | undefined): string {
  return typeof n === "number" && Number.isFinite(n) ? String(n) : "";
}

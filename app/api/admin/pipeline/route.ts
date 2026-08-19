import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano, toIdOrNull } from "@/lib/xano";

/**
 * Admissions Pipeline — one row per family per year, with a derived
 * `stage` that places the family in exactly one pipeline column:
 *
 *   - "application"  — has an apply-flow progress row, not yet accepted
 *   - "registration" — accepted (admin Approve), registration not yet
 *                      confirmed
 *   - "enrollment"   — registration confirmed (the family-level
 *                      `isRegistrationConfirmed` latch)
 *
 * Archived families (either the apply-flow `is_archived` or the
 * registration-flow `isArchived`) keep their stage but carry
 * `is_archived: true` — the board hides them and the export always
 * excludes them.
 *
 * Joins mirror /api/admin/applications: each Xano call is isolated so
 * a single hiccup degrades labels/counts instead of 500ing the route.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const yearIdParam = req.nextUrl.searchParams.get("yearId");
    if (!yearIdParam) {
      return NextResponse.json(
        { error: "yearId is required" },
        { status: 400 }
      );
    }
    const yearId = Number(yearIdParam);
    if (!Number.isFinite(yearId) || yearId <= 0) {
      return NextResponse.json(
        { error: "yearId must be a positive number" },
        { status: 400 }
      );
    }

    const [
      applyResult,
      regProgressResult,
      familiesResult,
      parentsResult,
      appsResult,
      studentsResult,
    ] = await Promise.allSettled([
      xano.familyApplicationProgress.getByYear(yearId),
      xano.studentRegistrationProgress.getByYear(yearId),
      xano.families.getAll(),
      xano.parents.getAll(),
      xano.applications.getAll(),
      xano.students.getAll(),
    ]);

    for (const [label, result] of [
      ["apply progress", applyResult],
      ["registration progress", regProgressResult],
      ["families list", familiesResult],
      ["parents list", parentsResult],
      ["applications list", appsResult],
      ["students list", studentsResult],
    ] as const) {
      if (result.status === "rejected") {
        console.error(
          `[/api/admin/pipeline] failed to load ${label}:`,
          result.reason
        );
      }
    }

    const applyRows =
      applyResult.status === "fulfilled" ? applyResult.value : [];
    const regRows =
      regProgressResult.status === "fulfilled" ? regProgressResult.value : [];
    const families =
      familiesResult.status === "fulfilled" ? familiesResult.value : [];
    const parents =
      parentsResult.status === "fulfilled" ? parentsResult.value : [];
    const apps = appsResult.status === "fulfilled" ? appsResult.value : [];
    const studentsAll =
      studentsResult.status === "fulfilled" ? studentsResult.value : [];

    const familyById = new Map(families.map((f) => [f.id, f]));
    const studentById = new Map(studentsAll.map((s) => [s.id, s]));
    const regByFamily = new Map(
      regRows.map((r) => [
        toIdOrNull(r.registration_families_id) ?? r.registration_families_id,
        r,
      ])
    );

    const parentsByFamily = new Map<number, typeof parents>();
    for (const family of families) {
      const ids = xano.families.getParentIds(family);
      const matched = parents.filter((p) => ids.includes(p.id));
      matched.sort((a, b) => a.id - b.id);
      parentsByFamily.set(family.id, matched);
    }

    // Active students per family for the year — one application row per
    // student; `isActive === false` rows are soft-deleted. FKs on the
    // application row are coerced with `toIdOrNull` because Xano
    // sometimes returns them as expanded `{ id, ... }` relation objects
    // — `Number(object)` is NaN, which silently zeroed every student
    // count (and blanked every card's student-names line) whenever the
    // endpoint responded in that shape.
    //
    // The per-student detail (grade, bus stop, pickup address, …) rides
    // along for the export: bus-route planning needs one line per
    // student, and all of it lives on the application + student rows
    // this route already fetches.
    const studentsByFamily = new Map<number, PipelineStudentDetail[]>();
    for (const a of apps) {
      if (toIdOrNull(a.registration_school_years_id) !== yearId) continue;
      if (a.isActive === false) continue;
      const fid = toIdOrNull(a.registration_families_id);
      const sid = toIdOrNull(a.registration_students_id);
      if (fid == null || sid == null) continue;
      const s = studentById.get(sid);
      const arr = studentsByFamily.get(fid) ?? [];
      arr.push({
        student_id: sid,
        name: s
          ? `${s.first_name ?? ""} ${s.last_name ?? ""}`.trim()
          : "",
        date_of_birth: s?.date_of_birth ?? "",
        gender: s?.gender ?? "",
        grade: a.current_grade ?? "",
        is_bus_transportation: a.is_bus_transportation === true,
        bus_stop: a.bus_stop ?? "",
        pickup_address: a.primary_home ?? "",
        transportation_cost: a.transportation_cost ?? null,
      });
      studentsByFamily.set(fid, arr);
    }

    const rows: PipelineFamilyRow[] = applyRows.map((p) => {
      const familyId =
        toIdOrNull(p.registration_families_id) ?? p.registration_families_id;
      const family = familyById.get(familyId) ?? null;
      const familyParents = parentsByFamily.get(familyId) ?? [];
      const primary = familyParents[0] ?? null;
      const students = studentsByFamily.get(familyId) ?? [];
      const studentNames = students.map((s) => s.name).filter(Boolean);

      const reg = regByFamily.get(familyId) ?? null;
      const isAccepted = !!p.isAccepted;
      const isConfirmed = reg?.isRegistrationConfirmed === true;
      const stage: PipelineStage =
        isAccepted && isConfirmed
          ? "enrollment"
          : isAccepted
            ? "registration"
            : "application";

      const appSections = [
        p.family_completed,
        p.students_completed,
        p.financial_aid_completed,
        p.testing_completed,
      ].filter(Boolean).length;
      const regSections = reg
        ? [
            reg.isTuition,
            reg.isEnrollment,
            reg.isRegistration,
            reg.isVolunteerHours,
          ].filter(Boolean).length
        : 0;

      return {
        id: p.id,
        family_id: familyId,
        year_id: p.registration_school_years_id,
        stage,
        flow_type: p.type === "Re-Enrollment" ? "reapply" : "apply",
        family_name: family?.family_name?.trim() || `Family #${familyId}`,
        primary_name: primary
          ? `${primary.first_name ?? ""} ${primary.last_name ?? ""}`.trim()
          : "",
        primary_email: primary?.email ?? "",
        primary_phone: primary?.phone ?? "",
        student_count: students.length,
        student_names: studentNames.join(", "),
        students,
        app_sections_complete: appSections,
        app_sections_total: 4,
        isSubmitted: !!p.isSubmitted,
        isAccepted,
        submitted_at: p.submitted_at ?? null,
        accepted_at: p.accepted_at ?? null,
        reg_sections_complete: regSections,
        reg_sections_total: 4,
        reg_tuition_done: !!reg?.isTuition,
        reg_enrollment_done: !!reg?.isEnrollment,
        reg_packet_done: !!reg?.isRegistration,
        reg_volunteer_done: !!reg?.isVolunteerHours,
        reg_submitted: !!reg?.isSubmitted,
        reg_submitted_date: reg?.submitted_date ?? null,
        is_registration_confirmed: isConfirmed,
        registration_confirmed_time: reg?.registration_confirmed_time ?? null,
        last_edited: p.last_edited ?? null,
        is_archived: p.is_archived === true || reg?.isArchived === true,
        reason_for_archive: p.reason_for_archive ?? null,
      };
    });

    // Most recently touched first within whatever grouping the page
    // applies; the board re-buckets by stage anyway.
    rows.sort((a, b) => {
      const aEdit = a.last_edited ?? a.submitted_at ?? 0;
      const bEdit = b.last_edited ?? b.submitted_at ?? 0;
      return bEdit - aEdit;
    });

    return NextResponse.json(rows);
  } catch (err) {
    return handleAdminError(err);
  }
}

/** Which pipeline column the family sits in. Derived, never stored —
 *  acceptance moves a family application → registration; the
 *  registration-confirmed latch moves registration → enrollment. */
export type PipelineStage = "application" | "registration" | "enrollment";

/** Per-student detail joined from the student's application row (bus
 *  election + grade) and student row (name / DOB / gender). Backs the
 *  export's Student-details columns and its one-row-per-student mode. */
export interface PipelineStudentDetail {
  student_id: number;
  name: string;
  /** ISO `YYYY-MM-DD` from the student row; empty when unset. */
  date_of_birth: string;
  gender: string;
  /** `current_grade` off the application row. */
  grade: string;
  is_bus_transportation: boolean;
  bus_stop: string;
  /** Formatted pickup-address snapshot (`primary_home`) captured when
   *  the family picked the bus stop. Empty when no bus election. */
  pickup_address: string;
  transportation_cost: number | null;
}

export interface PipelineFamilyRow {
  /** family_application_progress row id */
  id: number;
  family_id: number;
  year_id: number;
  stage: PipelineStage;
  flow_type: "apply" | "reapply";
  family_name: string;
  primary_name: string;
  primary_email: string;
  primary_phone: string;
  student_count: number;
  /** Comma-joined active-student names for the year. */
  student_names: string;
  /** One entry per active student on the year — see
   *  `PipelineStudentDetail`. */
  students: PipelineStudentDetail[];
  app_sections_complete: number;
  app_sections_total: number;
  isSubmitted: boolean;
  isAccepted: boolean;
  submitted_at: number | null;
  accepted_at: number | null;
  reg_sections_complete: number;
  reg_sections_total: number;
  /** Parent finished the tuition-schedule step (/tuition). */
  reg_tuition_done: boolean;
  /** Enrollment agreement signed + first payment (/enrollment-signing). */
  reg_enrollment_done: boolean;
  /** Student registration packet done (/registration). */
  reg_packet_done: boolean;
  /** Volunteer-hours acknowledgment done (/volunteer-hours). */
  reg_volunteer_done: boolean;
  reg_submitted: boolean;
  reg_submitted_date: number | null;
  is_registration_confirmed: boolean;
  registration_confirmed_time: number | null;
  last_edited: number | null;
  /** True when either the apply-flow or registration-flow archive flag
   *  is set — hidden from the board, always excluded from the export. */
  is_archived: boolean;
  reason_for_archive: string | null;
}

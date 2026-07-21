import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";

/**
 * Admin SUFS list — one row per student whose family registration has
 * been **confirmed** for the requested academic year, carrying that
 * student's Step Up For Students award data.
 *
 * This is the reconciliation surface: admin works this list against
 * the Step Up portal, ticking each student off as they're enrolled
 * there. It is deliberately narrower than `/api/admin/registrations`:
 *
 *   - Registrations shows the whole accepted pipeline (not started →
 *     submitted → completed) so admin can chase families.
 *   - SUFS shows only the *finished* end of it, because a student who
 *     hasn't completed registration shouldn't be enrolled on the
 *     portal yet.
 *
 * "Completed" === the family-level
 * `registration_student_registration_progress.isRegistrationConfirmed`
 * — the same latch that drives the Completed bucket on the
 * Registrations list. Note this lives on the *family* progress row, so
 * confirming a family surfaces all of its active students here at
 * once.
 *
 * Acceptance is still checked first (a family can't have a confirmed
 * registration without being accepted, but the two flags live on
 * different tables and we don't want a stale/orphaned progress row to
 * leak a non-accepted student onto this list).
 *
 * Joins mirror `/api/admin/registrations` — see that route for why
 * each one is needed. Every fetch is wrapped in `Promise.allSettled`
 * so one Xano hiccup degrades a column instead of 500-ing the page.
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
      appsResult,
      studentsResult,
      familiesResult,
      progressResult,
      familyProgressResult,
      packetsResult,
    ] = await Promise.allSettled([
      xano.applications.getAll(),
      xano.students.getAll(),
      xano.families.getAll(),
      xano.studentRegistrationProgress.getByYear(yearId),
      xano.familyApplicationProgress.getByYear(yearId),
      // Per-(student, year) registration packets — the SUFS enrolled
      // latch + note live here (`registration_student_registration`),
      // NOT on the application row.
      xano.studentRegistration.getByYear(yearId),
    ]);

    if (appsResult.status === "rejected") {
      console.error(
        "[/api/admin/sufs] failed to load applications:",
        appsResult.reason
      );
    }
    if (studentsResult.status === "rejected") {
      console.error(
        "[/api/admin/sufs] failed to load students:",
        studentsResult.reason
      );
    }
    if (familiesResult.status === "rejected") {
      console.error(
        "[/api/admin/sufs] failed to load families:",
        familiesResult.reason
      );
    }
    if (progressResult.status === "rejected") {
      console.error(
        "[/api/admin/sufs] failed to load registration progress:",
        progressResult.reason
      );
    }
    if (familyProgressResult.status === "rejected") {
      console.error(
        "[/api/admin/sufs] failed to load family application progress:",
        familyProgressResult.reason
      );
    }
    if (packetsResult.status === "rejected") {
      console.error(
        "[/api/admin/sufs] failed to load registration packets:",
        packetsResult.reason
      );
    }

    const apps = appsResult.status === "fulfilled" ? appsResult.value : [];
    const students =
      studentsResult.status === "fulfilled" ? studentsResult.value : [];
    const families =
      familiesResult.status === "fulfilled" ? familiesResult.value : [];
    const progressRows =
      progressResult.status === "fulfilled" ? progressResult.value : [];
    const familyProgressRows =
      familyProgressResult.status === "fulfilled"
        ? familyProgressResult.value
        : [];
    const packets =
      packetsResult.status === "fulfilled" ? packetsResult.value : [];

    const studentById = new Map(students.map((s) => [s.id, s]));
    const familyById = new Map(families.map((f) => [f.id, f]));

    // Packet lookup keyed by student id — `getByYear` already scopes to
    // the requested year, so one packet per student. The SUFS enrolled
    // flag + note (and the packet id the client PATCHes) come from here.
    const packetByStudent = new Map(
      packets.map((p) => [Number(p.registration_students_id), p])
    );

    // Same authoritative acceptance set the Registrations route builds
    // — family-level `isAccepted`, with the legacy per-student flag
    // honored as a fallback below.
    const acceptedFamilyIds = new Set(
      familyProgressRows
        .filter((p) => p.isAccepted === true)
        .map((p) => p.registration_families_id)
    );

    // Families whose registration admin has confirmed for this year.
    // This is the gate for appearing on the SUFS list at all.
    const confirmedFamilyIds = new Set(
      progressRows
        .filter((p) => p.isRegistrationConfirmed === true)
        .map((p) => p.registration_families_id)
    );

    const eligibleApps = apps.filter((a) => {
      if (Number(a.registration_school_years_id) !== yearId) return false;
      // `isActive === false` is a soft delete (parent pulled the
      // student from the year). `undefined` counts as active so
      // legacy rows still appear — same convention as Registrations.
      if ((a as { isActive?: boolean }).isActive === false) return false;
      const familyId = Number(a.registration_families_id);
      if (!confirmedFamilyIds.has(familyId)) return false;
      const familyAccepted = acceptedFamilyIds.has(familyId);
      const legacyStudentAccepted =
        (a as { isAccepted?: boolean }).isAccepted === true;
      return familyAccepted || legacyStudentAccepted;
    });

    const rows: SufsStudentRow[] = eligibleApps.map((app) => {
      const studentId = Number(app.registration_students_id);
      const familyId = Number(app.registration_families_id);
      const student = studentById.get(studentId) ?? null;
      const family = familyById.get(familyId) ?? null;
      // The enrolled latch + note live on the per-(student, year)
      // packet. A confirmed registration always has a packet, but we
      // tolerate its absence (packet_id null → the client disables the
      // checkbox rather than PATCHing a nonexistent row).
      const packet = packetByStudent.get(studentId) ?? null;
      return {
        id: app.id,
        application_id: app.id,
        packet_id: packet?.id ?? null,
        student_id: studentId,
        family_id: familyId,
        year_id: yearId,
        student_first_name: student?.first_name ?? "",
        student_last_name: student?.last_name ?? "",
        student_full_name: student
          ? `${student.first_name ?? ""} ${student.last_name ?? ""}`.trim()
          : `Student #${studentId}`,
        student_grade: app.current_grade ?? "",
        family_name: family?.family_name?.trim() || `Family #${familyId}`,
        // 0 is the "not entered yet" sentinel the parent-facing award-ID
        // input writes, so normalize it to null for the UI rather than
        // rendering a literal "0".
        sufs_award_id:
          typeof app.sufs_award_id === "number" && app.sufs_award_id > 0
            ? app.sufs_award_id
            : null,
        sufs_type: app.sufs_type ?? "",
        sufs_status: app.sufs_status ?? "",
        // Canonical stored award dollars — never re-derived from the
        // tier here, so custom amounts print correctly.
        sufs_amount:
          typeof app.sufs_amount === "number" ? app.sufs_amount : null,
        // Pipeline state from the packet. `undefined` on rows
        // predating the columns reads as false. Every audit stamp is
        // gated on its bool: un-ticking writes null/"" clears that
        // Xano's edit endpoint drops, so the stored stamp lingers —
        // suppressing it here keeps every consumer (table tooltips,
        // CSV export) from showing stale audit data.
        sufs_enrollment_request_sent:
          packet?.sufs_enrollment_request_sent === true,
        // Trimmed because a cleared note is stored as a single space —
        // Xano drops empty-string inputs, so "" can't round-trip. See
        // the sentinel write in `/api/admin/student-registration/[id]`.
        sufs_enrollment_request_notes: (
          packet?.sufs_enrollment_request_notes ?? ""
        ).trim(),
        sufs_enrollment_request_time:
          packet?.sufs_enrollment_request_sent === true
            ? (packet?.sufs_enrollment_request_time ?? null)
            : null,
        sufs_enrollment_request_by:
          packet?.sufs_enrollment_request_sent === true
            ? (packet?.sufs_enrollment_request_by ?? "").trim()
            : "",
        sufs_parent_enrollment_confirmation:
          packet?.sufs_parent_enrollment_confirmation === true,
        sufs_parent_enrollment_request_time:
          packet?.sufs_parent_enrollment_confirmation === true
            ? (packet?.sufs_parent_enrollment_request_time ?? null)
            : null,
        sufs_parent_enrollment_request_by:
          packet?.sufs_parent_enrollment_confirmation === true
            ? (packet?.sufs_parent_enrollment_request_by ?? "").trim()
            : "",
        sufs_q1_payment: packet?.sufs_q1_payment === true,
        sufs_q1_payment_confirmed:
          packet?.sufs_q1_payment === true
            ? (packet?.sufs_q1_payment_confirmed ?? null)
            : null,
        sufs_q1_payment_confirmed_by:
          packet?.sufs_q1_payment === true
            ? (packet?.sufs_q1_payment_confirmed_by ?? "").trim()
            : "",
        sufs_q2_payment: packet?.sufs_q2_payment === true,
        sufs_q2_payment_confirmed:
          packet?.sufs_q2_payment === true
            ? (packet?.sufs_q2_payment_confirmed ?? null)
            : null,
        sufs_q2_payment_confirmed_by:
          packet?.sufs_q2_payment === true
            ? (packet?.sufs_q2_payment_confirmed_by ?? "").trim()
            : "",
        sufs_q3_payment: packet?.sufs_q3_payment === true,
        sufs_q3_payment_confirmed:
          packet?.sufs_q3_payment === true
            ? (packet?.sufs_q3_payment_confirmed ?? null)
            : null,
        sufs_q3_payment_confirmed_by:
          packet?.sufs_q3_payment === true
            ? (packet?.sufs_q3_payment_confirmed_by ?? "").trim()
            : "",
        sufs_q4_payment: packet?.sufs_q4_payment === true,
        sufs_q4_payment_confirmed:
          packet?.sufs_q4_payment === true
            ? (packet?.sufs_q4_payment_confirmed ?? null)
            : null,
        sufs_q4_payment_confirmed_by:
          packet?.sufs_q4_payment === true
            ? (packet?.sufs_q4_payment_confirmed_by ?? "").trim()
            : "",
      };
    });

    rows.sort((a, b) => {
      // Alphabetical by last name, then first — deliberately NOT by
      // pipeline status. The client groups rows into the three status
      // tables itself (from the same cached data its optimistic
      // updates mutate), so ticking a checkbox moves the row between
      // groups instantly instead of waiting on this route's slow
      // multi-table refetch. A status-dependent server order would
      // fight that by reshuffling rows when the refetch lands.
      const last = (a.student_last_name ?? "").localeCompare(
        b.student_last_name ?? ""
      );
      if (last !== 0) return last;
      return (a.student_first_name ?? "").localeCompare(
        b.student_first_name ?? ""
      );
    });

    return NextResponse.json(rows);
  } catch (err) {
    return handleAdminError(err);
  }
}

export interface SufsStudentRow {
  /** Stable row id — the application row's id (unique per student per
   *  year), used as the DataTable/React key. */
  id: number;
  application_id: number;
  /** Primary key of this student's `registration_student_registration`
   *  packet — the row the Enrolled checkbox + note PATCH targets.
   *  `null` in the (unexpected) case a confirmed student has no packet;
   *  the client disables editing rather than PATCHing a missing row. */
  packet_id: number | null;
  student_id: number;
  family_id: number;
  year_id: number;
  student_first_name: string;
  student_last_name: string;
  student_full_name: string;
  student_grade: string;
  family_name: string;
  /** Parent-entered 9-digit Step Up award ID. `null` when unset (the
   *  underlying column uses 0 as its empty sentinel). */
  sufs_award_id: number | null;
  /** Award tier key (`fes_eo_9`, `ftc_8`, `custom`, …). "" = not on a
   *  SUFS scholarship. */
  sufs_type: string;
  /** Pending / Approved / Denied, or "" when unset. */
  sufs_status: string;
  /** Stored award dollars for this student. */
  sufs_amount: number | null;
  // ── Pipeline stage 1: enrollment request sent on the Step Up
  //    portal (admin action). Field names match the Xano columns so
  //    the page's PATCH bodies and optimistic cache folds can reuse
  //    them verbatim.
  sufs_enrollment_request_sent: boolean;
  /** Free-text reconciliation note (on the packet). */
  sufs_enrollment_request_notes: string;
  sufs_enrollment_request_time: number | null;
  sufs_enrollment_request_by: string;
  // ── Stage 2: parent completed their enrollment confirmation
  //    (admin-verified). Audit columns named `..._request_*` on Xano.
  sufs_parent_enrollment_confirmation: boolean;
  sufs_parent_enrollment_request_time: number | null;
  sufs_parent_enrollment_request_by: string;
  // ── Stage 3: quarterly payment confirmations. `_confirmed` is the
  //    ms timestamp, `_confirmed_by` the admin display name.
  sufs_q1_payment: boolean;
  sufs_q1_payment_confirmed: number | null;
  sufs_q1_payment_confirmed_by: string;
  sufs_q2_payment: boolean;
  sufs_q2_payment_confirmed: number | null;
  sufs_q2_payment_confirmed_by: string;
  sufs_q3_payment: boolean;
  sufs_q3_payment_confirmed: number | null;
  sufs_q3_payment_confirmed_by: string;
  sufs_q4_payment: boolean;
  sufs_q4_payment_confirmed: number | null;
  sufs_q4_payment_confirmed_by: string;
}

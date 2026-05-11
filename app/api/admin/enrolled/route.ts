import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";

/**
 * Admin Enrolled Students list — one row per student whose
 * `registration_students.isAccepted` is true for the requested
 * academic year.
 *
 * "Enrolled" === the student row carries `isAccepted=true` (set by
 * the parent-dashboard cascade once admin Approves the family) AND
 * the student isn't `isArchived` (the unenrollment flag captured by
 * the Unenroll modal on the detail page). The per-year scope is
 * enforced via `registration_application` — the student must have
 * an active app for the selected year. The student's registration
 * packet (`registration_student_registration`) is joined as a side
 * lookup for liability-waiver state, but no longer gates the list:
 * a student is enrolled when admin has accepted them, full stop.
 *
 * Joins:
 *   - `xano.students.getAll()` → primary pivot, gated by isAccepted
 *   - `xano.applications.getAll()` → year scope + `current_grade`
 *   - `xano.studentRegistration.getByYear(year)` → waiver state +
 *     "verified at" timestamp (side join, not the gate)
 *   - `xano.families.getAll()` → family label
 *   - `xano.parents.getAll()` → primary parent name + email
 *
 * Each lookup is wrapped in `Promise.allSettled` so a single Xano
 * hiccup degrades gracefully rather than 500'ing the whole route.
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
      packetsResult,
      appsResult,
      studentsResult,
      familiesResult,
      parentsResult,
    ] = await Promise.allSettled([
      xano.studentRegistration.getByYear(yearId),
      xano.applications.getAll(),
      xano.students.getAll(),
      xano.families.getAll(),
      xano.parents.getAll(),
    ]);

    if (packetsResult.status === "rejected") {
      console.error(
        "[/api/admin/enrolled] failed to load packets:",
        packetsResult.reason
      );
    }
    if (appsResult.status === "rejected") {
      console.error(
        "[/api/admin/enrolled] failed to load applications:",
        appsResult.reason
      );
    }
    if (studentsResult.status === "rejected") {
      console.error(
        "[/api/admin/enrolled] failed to load students:",
        studentsResult.reason
      );
    }
    if (familiesResult.status === "rejected") {
      console.error(
        "[/api/admin/enrolled] failed to load families:",
        familiesResult.reason
      );
    }
    if (parentsResult.status === "rejected") {
      console.error(
        "[/api/admin/enrolled] failed to load parents:",
        parentsResult.reason
      );
    }

    const packets =
      packetsResult.status === "fulfilled" ? packetsResult.value : [];
    const apps =
      appsResult.status === "fulfilled" ? appsResult.value : [];
    const students =
      studentsResult.status === "fulfilled" ? studentsResult.value : [];
    const families =
      familiesResult.status === "fulfilled" ? familiesResult.value : [];
    const parents =
      parentsResult.status === "fulfilled" ? parentsResult.value : [];

    const studentById = new Map(students.map((s) => [s.id, s]));
    const familyById = new Map(families.map((f) => [f.id, f]));
    // Per-student app for the year — gives us the current grade. Map by
    // student id so the join below stays an O(1) lookup.
    const appByStudent = new Map<number, (typeof apps)[number]>();
    for (const a of apps) {
      if (Number(a.registration_school_years_id) !== yearId) continue;
      if (a.isActive === false) continue;
      appByStudent.set(Number(a.registration_students_id), a);
    }

    // Primary parent per family — lowest id wins, mirroring how the
    // applications + registrations endpoints pick one for display.
    const primaryByFamily = new Map<number, (typeof parents)[number] | null>();
    for (const f of families) {
      const ids = xano.families.getParentIds(f);
      const matched = parents
        .filter((p) => ids.includes(p.id))
        .sort((a, b) => a.id - b.id);
      primaryByFamily.set(f.id, matched[0] ?? null);
    }

    // Pivot off the student row's `isAccepted` flag. That's set by
    // the parent dashboard cascade — once admin Approves a family
    // (`family_application_progress.isAccepted = true`), the
    // /apply/year/[yearId] page PATCHes `isAccepted: true` onto
    // every student in the family. So `student.isAccepted === true`
    // means "this student belongs in the enrolled cohort for the
    // family's accepted year." The unenrollment filter
    // (`isArchived !== true`) drops students whose admin has
    // explicitly unenrolled via the detail-page Unenroll modal.
    //
    // The per-year packet is joined below as a side lookup for
    // waiver state + "verified at" timestamp; it no longer gates
    // the list. A student who's been accepted but whose packet
    // admin hasn't verified yet still appears here — that's the
    // point of the switch.
    const acceptedStudents = students.filter(
      (s) => s.isAccepted === true && s.isArchived !== true
    );

    // Side join: packet lookup by student id so each row can
    // surface waiver state without a separate query per student.
    // `null` when the family hasn't started the year's packet yet.
    const packetByStudent = new Map<
      number,
      (typeof packets)[number] | null
    >();
    for (const p of packets) {
      packetByStudent.set(Number(p.registration_students_id), p);
    }

    const rows: EnrolledStudentRow[] = acceptedStudents.flatMap((student) => {
      const studentId = student.id;
      // Year scope: the student must have an active application
      // for the requested year. Drops students who were accepted
      // in a prior year but aren't re-enrolled this cycle, plus
      // accepted students whose app for the year was soft-deleted.
      const app = appByStudent.get(studentId);
      if (!app) return [];
      const familyId = Number(app.registration_families_id);
      const family = familyById.get(familyId) ?? null;
      const primary = primaryByFamily.get(familyId) ?? null;
      // Side-joined packet (if any). Used for waiver state and the
      // "verified at" enrolled-at fallback. Optional — students
      // accepted but with no packet yet still render here.
      const packet = packetByStudent.get(studentId) ?? null;
      // Audit "enrolled at" timestamp prefers the packet's verify
      // time (when admin actually clicked Verify Registration);
      // falls back to packet.created_at (when the parent opened
      // the packet); finally to the student row's `created_at`
      // (when the student was added to the system). Always picks
      // the most recent meaningful timestamp available.
      const enrolledAt =
        packet?.registration_confirmed_admin_time ??
        packet?.created_at ??
        student.created_at ??
        0;
      return [
        {
          id: studentId,
          packet_id: packet?.id ?? null,
          student_id: studentId,
          family_id: familyId,
          year_id: yearId,
          student_first_name: student.first_name ?? "",
          student_last_name: student.last_name ?? "",
          student_full_name:
            `${student.first_name ?? ""} ${student.last_name ?? ""}`.trim() ||
            `Student #${studentId}`,
          student_dob: student.date_of_birth ?? "",
          student_grade: app.current_grade ?? "",
          family_name:
            family?.family_name?.trim() || `Family #${familyId}`,
          primary_name: primary
            ? `${primary.first_name ?? ""} ${primary.last_name ?? ""}`.trim()
            : "",
          primary_email: primary?.email ?? "",
          confirmed_at: enrolledAt,
          liability_waiver_status: packet?.liability_waiver_status ?? "",
          liability_waiver_pdf_url: packet?.liability_waiver_pdf_url ?? "",
        },
      ];
    });

    rows.sort((a, b) => {
      // Most recently confirmed first, then alphabetical by last
      // name. Newest at the top puts the active enrollment work in
      // admin's eye line.
      if (a.confirmed_at !== b.confirmed_at) {
        return (b.confirmed_at ?? 0) - (a.confirmed_at ?? 0);
      }
      return (a.student_last_name ?? "").localeCompare(
        b.student_last_name ?? ""
      );
    });

    return NextResponse.json(rows);
  } catch (err) {
    return handleAdminError(err);
  }
}

export interface EnrolledStudentRow {
  /** Stable row id — uses the student id (unique per row in the
   *  list) so React keys stay stable even when a student has no
   *  packet yet. */
  id: number;
  /** Packet id when the parent has opened the year's packet, or
   *  `null` when admin has accepted the student but the parent
   *  hasn't started the registration packet yet. The list no
   *  longer gates on packet existence — the student's
   *  `isAccepted` is the canonical signal. */
  packet_id: number | null;
  student_id: number;
  family_id: number;
  year_id: number;
  student_first_name: string;
  student_last_name: string;
  student_full_name: string;
  student_dob: string;
  student_grade: string;
  family_name: string;
  primary_name: string;
  primary_email: string;
  /** Best-effort "enrolled at" timestamp — packet verify time,
   *  packet created_at, or student created_at, in that order of
   *  preference. */
  confirmed_at: number;
  liability_waiver_status: string;
  liability_waiver_pdf_url: string;
  /** Index signature so the row matches `DataTable`'s
   *  `<T extends Record<string, unknown>>` constraint without a
   *  client-side cast. Mirrors the same pattern on
   *  `RegistrationStudentRow`. */
  [key: string]: unknown;
}

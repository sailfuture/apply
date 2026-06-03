import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";

/**
 * Admin Enrolled Students list — one row per student who has an
 * active application for the requested academic year. Each row
 * carries an `is_enrolled` flag so the page can split the list into
 * two groups: officially enrolled vs not-yet-enrolled (or
 * unenrolled). Admin sees the full population of students tied to
 * the year, with the workflow status surfaced as the group divide.
 *
 * "Enrolled" === the student row carries `isEnrolled=true` AND
 * `isArchived !== true`. The registration-progress route cascades
 * `isEnrolled=true` onto every family student when admin clicks
 * Confirm Family Registration (so the family's registration is
 * formally confirmed first). The Unenroll modal on the detail page
 * clears `isEnrolled=false` + sets `isArchived=true` together.
 *
 * Per-year scope is enforced via `registration_application` — the
 * student must have an active app for the selected year. The
 * student's registration packet
 * (`registration_student_registration`) is joined as a side lookup
 * for liability-waiver state + "verified at" timestamp, but
 * doesn't gate the list.
 *
 * Joins:
 *   - `xano.students.getAll()` → primary pivot, gated by isEnrolled
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

    // List ALL students with an active application for the year —
    // both currently enrolled and not-yet-enrolled / unenrolled.
    // The `is_enrolled` flag on each row tells the page which group
    // to render it under; the gate that used to filter to
    // enrolled-only was `student.isEnrolled === true &&
    // student.isArchived !== true`. We compute the same predicate
    // per-row below.
    const studentsForYear = students.filter((s) =>
      appByStudent.has(s.id)
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

    const rows: EnrolledStudentRow[] = studentsForYear.flatMap((student) => {
      const studentId = student.id;
      const app = appByStudent.get(studentId);
      // Defensive guard — `studentsForYear` was built off the same
      // map, so this is effectively always defined; the guard keeps
      // TypeScript happy without an `!` assertion.
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
      const isEnrolled =
        student.isEnrolled === true && student.isArchived !== true;
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
          // Admin-assigned grade level from the packet (the placement
          // field set on the student detail page). The roster groups
          // students by this. Empty until admin sets it — those rows
          // fall under the "No grade level set" group.
          grade_level: packet?.grade_level ?? "",
          family_name:
            family?.family_name?.trim() || `Family #${familyId}`,
          primary_name: primary
            ? `${primary.first_name ?? ""} ${primary.last_name ?? ""}`.trim()
            : "",
          primary_email: primary?.email ?? "",
          confirmed_at: enrolledAt,
          liability_waiver_status: packet?.liability_waiver_status ?? "",
          liability_waiver_pdf_url: packet?.liability_waiver_pdf_url ?? "",
          is_enrolled: isEnrolled,
          is_archived: student.isArchived === true,
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
  /** Admin-assigned grade level from the registration packet
   *  ("8th"–"12th"). The enrolled roster groups students by this
   *  field. Distinct from `student_grade` (the application's incoming
   *  grade); empty until admin sets it on the student detail page. */
  grade_level: string;
  family_name: string;
  primary_name: string;
  primary_email: string;
  /** Best-effort "enrolled at" timestamp — packet verify time,
   *  packet created_at, or student created_at, in that order of
   *  preference. */
  confirmed_at: number;
  liability_waiver_status: string;
  liability_waiver_pdf_url: string;
  /** True when the student is officially enrolled for the year:
   *  `student.isEnrolled === true && student.isArchived !== true`.
   *  Drives the Enrolled vs Not Enrolled grouping on the page. */
  is_enrolled: boolean;
  /** True when the student has been formally unenrolled via the
   *  Unenroll modal (sets `isArchived=true` alongside
   *  `isEnrolled=false` + reason/date/notes). Distinguishes
   *  "never enrolled yet" from "was enrolled and later removed". */
  is_archived: boolean;
  /** Index signature so the row matches `DataTable`'s
   *  `<T extends Record<string, unknown>>` constraint without a
   *  client-side cast. Mirrors the same pattern on
   *  `RegistrationStudentRow`. */
  [key: string]: unknown;
}

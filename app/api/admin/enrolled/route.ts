import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";

/**
 * Admin Enrolled Students list — one row per student whose
 * registration packet has been admin-confirmed for the requested
 * academic year.
 *
 * "Enrolled" === per-student `registration_student_registration`
 * packet has `registrationConfirmed=true` for the year. The flag is
 * flipped from the family registration detail page after admin
 * reviews the packet (medical forms, emergency contacts, liability
 * waiver, etc.). We don't need a separate "enrolled_students" Xano
 * table — `registrationConfirmed` is the single source of truth.
 *
 * Joins:
 *   - `xano.studentRegistration.getByYear(year)` → confirmed packets
 *   - `xano.applications.getAll()` for `current_grade` per student
 *   - `xano.students.getAll()` for student names + DOB
 *   - `xano.families.getAll()` for the family label
 *   - `xano.parents.getAll()` for the primary parent's name + email
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

    // Only confirmed packets — `registrationConfirmed=true` is the
    // admin's "this student is enrolled" signal. Drop everything else.
    const confirmedPackets = packets.filter(
      (p) => p.registrationConfirmed === true
    );

    const rows: EnrolledStudentRow[] = confirmedPackets.flatMap((packet) => {
      const studentId = Number(packet.registration_students_id);
      const student = studentById.get(studentId) ?? null;
      // Need the application row to find the family + grade. If the
      // app was deleted out from under a confirmed packet (rare),
      // skip the row — admin can re-confirm from a fresh app.
      const app = appByStudent.get(studentId);
      if (!app) return [];
      const familyId = Number(app.registration_families_id);
      const family = familyById.get(familyId) ?? null;
      const primary = primaryByFamily.get(familyId) ?? null;
      return [
        {
          // Packet id is the row's natural key — unique per (student, year).
          id: packet.id,
          packet_id: packet.id,
          student_id: studentId,
          family_id: familyId,
          year_id: yearId,
          student_first_name: student?.first_name ?? "",
          student_last_name: student?.last_name ?? "",
          student_full_name: student
            ? `${student.first_name ?? ""} ${student.last_name ?? ""}`.trim()
            : `Student #${studentId}`,
          student_dob: student?.date_of_birth ?? "",
          student_grade: app.current_grade ?? "",
          family_name:
            family?.family_name?.trim() || `Family #${familyId}`,
          primary_name: primary
            ? `${primary.first_name ?? ""} ${primary.last_name ?? ""}`.trim()
            : "",
          primary_email: primary?.email ?? "",
          confirmed_at: packet.created_at,
          liability_waiver_status: packet.liability_waiver_status ?? "",
          liability_waiver_pdf_url: packet.liability_waiver_pdf_url ?? "",
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
  /** Stable row id — uses the packet id since it's unique per (student, year). */
  id: number;
  packet_id: number;
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
  /** Packet `created_at` — used as a proxy "enrolled at" timestamp. */
  confirmed_at: number;
  liability_waiver_status: string;
  liability_waiver_pdf_url: string;
  /** Index signature so the row matches `DataTable`'s
   *  `<T extends Record<string, unknown>>` constraint without a
   *  client-side cast. Mirrors the same pattern on
   *  `RegistrationStudentRow`. */
  [key: string]: unknown;
}

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";

/**
 * Retention report for the Enrollment → Retention page.
 *
 *   GET /api/admin/retention?yearId=Y
 *
 * Splits the year's student body into currently-enrolled vs
 * officially-unenrolled and surfaces the why:
 *
 *   - Enrolled  — student registered for the year, `isEnrolled` true
 *     (the Confirm Family Registration cascade), not archived.
 *   - Unenrolled — archived through the official Unenroll modal,
 *     which stamps `unenrollment_reason` / `unenrollment_date` /
 *     `unenrollment_notes` on the student row. Application-stage
 *     archives (families set aside before ever enrolling) carry no
 *     unenrollment stamp and deliberately DON'T count — retention
 *     measures students the school lost, not applicants who never
 *     started.
 *
 * Year membership reads the student's `registration_school_years_id`
 * array (Xano may return expanded relation objects — normalized
 * below). Grade comes from the year's application row when one
 * exists.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const yearId = Number(req.nextUrl.searchParams.get("yearId"));
    if (!Number.isFinite(yearId) || yearId <= 0) {
      return NextResponse.json(
        { error: "yearId is required" },
        { status: 400 }
      );
    }

    const [students, families, apps] = await Promise.all([
      xano.students.getAll(),
      xano.families.getAll().catch(() => []),
      xano.applications.getAll().catch(() => []),
    ]);

    const familyNameById = new Map(
      families.map((f) => [
        f.id,
        f.family_name?.trim() || `Family #${f.id}`,
      ])
    );
    // Grade per student for THIS year — the app row whether or not it
    // is still active (the unenroll cascade deactivates it, but the
    // grade is still the right historical label).
    const gradeByStudent = new Map<number, string>();
    for (const a of apps) {
      if (Number(a.registration_school_years_id) !== yearId) continue;
      const sid = Number(a.registration_students_id);
      if (!sid) continue;
      const grade = (a.current_grade ?? "").trim();
      if (grade && !gradeByStudent.has(sid)) {
        gradeByStudent.set(sid, grade);
      }
    }

    const memberOfYear = (s: (typeof students)[number]): boolean =>
      (s.registration_school_years_id ?? []).some(
        (y) =>
          (typeof y === "number"
            ? y
            : Number((y as { id?: number } | null)?.id)) === yearId
      );

    let enrolledCount = 0;
    const unenrolled: RetentionUnenrolledRow[] = [];
    for (const s of students) {
      if (!memberOfYear(s)) continue;
      const officiallyUnenrolled =
        s.isArchived === true &&
        Boolean(
          (s.unenrollment_reason ?? "").trim() ||
            s.unenrollment_date ||
            (s.unenrollment_notes ?? "").trim()
        );
      if (officiallyUnenrolled) {
        const fid = Number(s.registration_families_id) || 0;
        unenrolled.push({
          student_id: s.id,
          student_name:
            `${s.first_name ?? ""} ${s.last_name ?? ""}`.trim() ||
            `Student #${s.id}`,
          grade: gradeByStudent.get(s.id) ?? "",
          family_id: fid,
          family_name: familyNameById.get(fid) ?? `Family #${fid}`,
          date: s.unenrollment_date ?? null,
          reason: (s.unenrollment_reason ?? "").trim(),
          notes: (s.unenrollment_notes ?? "").trim(),
        });
      } else if (s.isArchived !== true && s.isEnrolled === true) {
        enrolledCount += 1;
      }
    }

    // Newest departures first; undated rows sink to the bottom.
    unenrolled.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));

    // Reason rollup — free-text strings grouped verbatim (trimmed,
    // case-insensitive key, first-seen casing displayed).
    const reasonCounts = new Map<string, { reason: string; count: number }>();
    for (const u of unenrolled) {
      const label = u.reason || "No reason recorded";
      const key = label.toLowerCase();
      const bucket = reasonCounts.get(key) ?? { reason: label, count: 0 };
      bucket.count += 1;
      reasonCounts.set(key, bucket);
    }
    const reasons = [...reasonCounts.values()].sort(
      (a, b) => b.count - a.count
    );

    const total = enrolledCount + unenrolled.length;
    return NextResponse.json({
      enrolledCount,
      unenrolledCount: unenrolled.length,
      // Share of the year's student body still enrolled. Null until
      // anyone is counted at all — 0/0 isn't "0% retention".
      retentionRate: total > 0 ? enrolledCount / total : null,
      reasons,
      unenrolled,
    } satisfies RetentionResponse);
  } catch (err) {
    return handleAdminError(err);
  }
}

export interface RetentionUnenrolledRow {
  student_id: number;
  student_name: string;
  grade: string;
  family_id: number;
  family_name: string;
  /** `YYYY-MM-DD` effective date from the Unenroll modal, or null. */
  date: string | null;
  reason: string;
  notes: string;
}

export interface RetentionResponse {
  enrolledCount: number;
  unenrolledCount: number;
  /** enrolled / (enrolled + unenrolled); null when the year has no
   *  counted students yet. */
  retentionRate: number | null;
  /** Distinct unenrollment reasons, most common first. */
  reasons: Array<{ reason: string; count: number }>;
  unenrolled: RetentionUnenrolledRow[];
}

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import { sortYearsOldestFirst } from "@/lib/school-years";

/**
 * Retention report for the Enrollment → Retention page.
 *
 *   GET /api/admin/retention?yearId=Y
 *
 * Splits the year's student body into currently-enrolled vs
 * officially-unenrolled and surfaces the why:
 *
 *   - Enrolled  — an ACTIVE application row for the year (the same
 *     membership test the Enrolled roster uses, so the two
 *     Enrollment-group pages can't disagree) + `isEnrolled` true
 *     (the Confirm Family Registration cascade) + not archived.
 *     Membership deliberately isn't the student's
 *     `registration_school_years_id` array — that's append-only at
 *     application creation, so a merely re-applied (unconfirmed)
 *     student would count as enrolled in the upcoming year.
 *   - Unenrolled — archived through the official Unenroll modal,
 *     which stamps `unenrollment_reason` / `unenrollment_date` /
 *     `unenrollment_notes` on the student row. Application-stage
 *     archives (families set aside before ever enrolling) carry no
 *     unenrollment stamp and deliberately DON'T count — retention
 *     measures students the school lost, not applicants who never
 *     started.
 *
 * DEPARTURE-YEAR ATTRIBUTION: the unenrollment stamp lives on the
 * student row (evergreen), while a multi-year student belongs to
 * several years — counting them unenrolled in EVERY year they ever
 * attended would deflate past years' retention for a later
 * departure. Each departure is attributed to exactly ONE year: the
 * year whose [start_date, next start_date) window contains
 * `unenrollment_date`, falling back to the student's latest
 * membership year when the date is missing or no window matches.
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

    const [students, families, apps, years, packets] = await Promise.all([
      xano.students.getAll(),
      xano.families.getAll().catch(() => []),
      xano.applications.getAll().catch(() => []),
      xano.schoolYears.getAll().catch(() => []),
      xano.studentRegistration.getByYear(yearId).catch(() => []),
    ]);

    // Grade comes ONLY from the admin packet's `grade_level` dropdown
    // — `current_grade` on the application is parent-typed free text
    // and renders inconsistently ("10" vs "10th"). Blank when the
    // student has no packet placement for the year.
    const gradeByStudent = new Map<number, string>();
    for (const p of packets) {
      const sid = Number(p.registration_students_id);
      const grade = (p.grade_level ?? "").trim();
      if (sid && grade) gradeByStudent.set(sid, grade);
    }

    const familyNameById = new Map(
      families.map((f) => [
        f.id,
        f.family_name?.trim() || `Family #${f.id}`,
      ])
    );

    // Winning application row per (student, year): ACTIVE rows only,
    // newest (highest id) wins — re-created rows happen, and the
    // fresh row carries the corrected grade. Membership in a year =
    // having a winner for it, matching the Enrolled roster's test.
    const winnerByStudentYear = new Map<
      string,
      (typeof apps)[number]
    >();
    for (const a of apps) {
      if (a.isActive === false) continue;
      const sid = Number(a.registration_students_id);
      const yid = Number(a.registration_school_years_id);
      if (!sid || !yid) continue;
      const key = `${sid}:${yid}`;
      const prev = winnerByStudentYear.get(key);
      if (!prev || Number(a.id) > Number(prev.id)) {
        winnerByStudentYear.set(key, a);
      }
    }
    const memberYearsByStudent = new Map<number, number[]>();
    for (const key of winnerByStudentYear.keys()) {
      const [sidStr, yidStr] = key.split(":");
      const sid = Number(sidStr);
      const list = memberYearsByStudent.get(sid) ?? [];
      list.push(Number(yidStr));
      memberYearsByStudent.set(sid, list);
    }

    // Year timeline for departure attribution: each year's window
    // runs from its start_date to the NEXT year's start_date (the
    // last year's window is open-ended). Years without a start_date
    // can't be windowed and fall back to latest-membership below.
    const sortedYears = sortYearsOldestFirst(years);
    const yearOrder = new Map(sortedYears.map((y, i) => [y.id, i]));
    const yearWindows: Array<{ id: number; start: number; end: number }> =
      [];
    for (let i = 0; i < sortedYears.length; i += 1) {
      const start = Date.parse(
        `${sortedYears[i].start_date ?? ""}T00:00:00Z`
      );
      if (!Number.isFinite(start)) continue;
      let end = Infinity;
      for (let j = i + 1; j < sortedYears.length; j += 1) {
        const next = Date.parse(
          `${sortedYears[j].start_date ?? ""}T00:00:00Z`
        );
        if (Number.isFinite(next)) {
          end = next;
          break;
        }
      }
      yearWindows.push({ id: sortedYears[i].id, start, end });
    }
    const latestMemberYear = (memberYears: number[]): number =>
      [...memberYears].sort(
        (a, b) => (yearOrder.get(a) ?? -1) - (yearOrder.get(b) ?? -1)
      )[memberYears.length - 1];
    /** The single year a departure belongs to — window containing
     *  `unenrollment_date` when the student attended that year,
     *  otherwise their latest membership year. Null = no membership
     *  anywhere (nothing to attribute). */
    const attributeDepartureYear = (
      s: (typeof students)[number]
    ): number | null => {
      const memberYears = memberYearsByStudent.get(s.id) ?? [];
      if (memberYears.length === 0) return null;
      const dateMs = s.unenrollment_date
        ? Date.parse(`${s.unenrollment_date}T00:00:00Z`)
        : NaN;
      if (Number.isFinite(dateMs)) {
        const hit = yearWindows.find(
          (w) => dateMs >= w.start && dateMs < w.end
        );
        if (hit && memberYears.includes(hit.id)) return hit.id;
      }
      return latestMemberYear(memberYears);
    };

    // Community vs residential segmentation (user request):
    // residential/foster placements churn by design, so mixing them
    // into one retention number buries the community signal. A family
    // is residential when its `is_residential` flag is set.
    const residentialFamilies = new Set(
      families.filter((f) => f.is_residential === true).map((f) => f.id)
    );

    const enrolled = { all: 0, community: 0, residential: 0 };
    const unenrolled: RetentionUnenrolledRow[] = [];
    for (const s of students) {
      const yearApp = winnerByStudentYear.get(`${s.id}:${yearId}`);
      const fid = Number(s.registration_families_id) || 0;
      const residential = residentialFamilies.has(fid);
      const officiallyUnenrolled =
        s.isArchived === true &&
        Boolean(
          (s.unenrollment_reason ?? "").trim() ||
            s.unenrollment_date ||
            (s.unenrollment_notes ?? "").trim()
        );
      if (officiallyUnenrolled) {
        if (attributeDepartureYear(s) !== yearId) continue;
        unenrolled.push({
          student_id: s.id,
          student_name:
            `${s.first_name ?? ""} ${s.last_name ?? ""}`.trim() ||
            `Student #${s.id}`,
          grade: gradeByStudent.get(s.id) ?? "",
          family_id: fid,
          family_name: familyNameById.get(fid) ?? `Family #${fid}`,
          residential,
          date: s.unenrollment_date ?? null,
          reason: (s.unenrollment_reason ?? "").trim(),
          notes: (s.unenrollment_notes ?? "").trim(),
          retention_exempt: s.isRetentionExempt === true,
        });
      } else if (
        yearApp &&
        s.isArchived !== true &&
        s.isEnrolled === true
      ) {
        enrolled.all += 1;
        if (residential) enrolled.residential += 1;
        else enrolled.community += 1;
      }
    }

    // Newest departures first; undated rows sink to the bottom.
    unenrolled.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));

    // The selected year's display name rides along so the page can
    // title itself "Retention — 2026-2027" without a second fetch.
    const selectedYear = years.find((y) => Number(y.id) === yearId);

    return NextResponse.json({
      year: { id: yearId, year_name: selectedYear?.year_name ?? "" },
      enrolled,
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
  /** True when the family's `is_residential` flag is set — drives
   *  the page's All / Community / Residential filter. */
  residential: boolean;
  /** `YYYY-MM-DD` effective date from the Unenroll modal, or null. */
  date: string | null;
  reason: string;
  notes: string;
  /** True when admin marked the departure as not-a-real-enrollment
   *  (student never attended) — the row still lists but is excluded
   *  from the unenrolled count and the retention rate. */
  retention_exempt: boolean;
}

export interface RetentionResponse {
  /** The year this report covers — `year_name` is "" when the id
   *  doesn't resolve (stale link), and the page falls back to a
   *  plain "Retention" title. */
  year: { id: number; year_name: string };
  /** Currently-enrolled counts, segmented by family type — the page
   *  derives the displayed count and retention rate from whichever
   *  segment its filter selects. */
  enrolled: { all: number; community: number; residential: number };
  unenrolled: RetentionUnenrolledRow[];
}

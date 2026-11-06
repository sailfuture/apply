import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { ADMIN_YEAR_COOKIE, parseAdminYearId } from "@/lib/school-year-default";
import { buildStageIndex, type StageTarget } from "@/lib/admin-stage";
import { xano } from "@/lib/xano";

/**
 * Where one family (and each of its students) is in the admissions
 * funnel right now — the resolved link target for sheets and buttons
 * that name a family without loading its pipeline rows (the Messages
 * inbox's Family details sheet, the lead sheet's "Open this family").
 * Same resolver as the dashboard search and the list pages
 * (`lib/admin-stage`), fed this family's rows across every year.
 *
 * `?yearId=` is the admin's working year (breaks ties between years
 * the family is equally far along in); the remembered-year cookie
 * fills in when the caller has none.
 */
export interface FamilyStageResponse {
  family: StageTarget;
  /** Keyed by student id — every student on the family, including
   *  unenrolled ones (their target is their own page). */
  students: Record<string, StageTarget>;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const { id: idParam } = await params;
    const familyId = Number(idParam);
    if (!Number.isFinite(familyId) || familyId <= 0) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    const preferredYearId =
      parseAdminYearId(req.nextUrl.searchParams.get("yearId")) ??
      parseAdminYearId(req.cookies.get(ADMIN_YEAR_COOKIE)?.value);

    // The progress tables have no by-family helper; both full reads
    // are Data-Cached list calls the search index makes anyway.
    const [students, applications, applyProgress, regProgress, packets, years] =
      await Promise.all([
        xano.students.getByFamilyId(familyId).catch(() => []),
        xano.applications.getByFamilyId(familyId).catch(() => []),
        xano.familyApplicationProgress.getAll().catch(() => []),
        xano.studentRegistrationProgress.getAll().catch(() => []),
        xano.studentRegistration.getAll().catch(() => []),
        xano.schoolYears.getAll().catch(() => []),
      ]);
    const studentIds = new Set(students.map((s) => s.id));

    const index = buildStageIndex(
      {
        applyProgress: applyProgress.filter(
          (p) => Number(p.registration_families_id) === familyId
        ),
        regProgress: regProgress.filter(
          (r) => Number(r.registration_families_id) === familyId
        ),
        applications,
        students,
        packets: packets.filter((p) =>
          studentIds.has(Number(p.registration_students_id))
        ),
        years,
      },
      { preferredYearId }
    );

    const payload: FamilyStageResponse = {
      family: index.family(familyId, preferredYearId),
      students: Object.fromEntries(
        students.map((s) => [
          String(s.id),
          index.student(s.id, preferredYearId) ??
            index.family(familyId, preferredYearId),
        ])
      ),
    };
    return NextResponse.json(payload);
  } catch (err) {
    return handleAdminError(err);
  }
}

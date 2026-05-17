import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";

const BASE = process.env.XANO_API_BASE_URL;

/**
 * Counts dashboard backing route. Reads basic Xano tables via parallel
 * fetches; each call is isolated with `Promise.allSettled` so a single
 * failed read can't 500 the whole dashboard. Failures log to the server
 * console with the underlying error.
 *
 * Application counts come from the basic `registration_application`
 * list (filtered by year client-side) instead of the enriched
 * `_all_details` endpoint — `_all_details` skips families without
 * expanded data, so the totals here match what the Applications table
 * shows by definition.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const { searchParams } = new URL(req.url);
    const yearIdParam = searchParams.get("yearId");
    const yearId = yearIdParam ? Number(yearIdParam) : null;

    const [
      appsResult,
      inquiriesResult,
      registrationsResult,
      studentsResult,
    ] = await Promise.allSettled([
      xano.applications.getAll(),
      fetch(`${BASE}/registration_inquiry`, { cache: "no-store" }).then((r) =>
        r.ok ? r.json() : []
      ),
      fetch(`${BASE}/registration_student_registration`, { cache: "no-store" }).then(
        (r) => (r.ok ? r.json() : [])
      ),
      fetch(`${BASE}/registration_students`, { cache: "no-store" }).then((r) =>
        r.ok ? r.json() : []
      ),
    ]);

    if (appsResult.status === "rejected") {
      console.error(
        "[/api/admin/stats] failed to load applications:",
        appsResult.reason
      );
    }
    if (inquiriesResult.status === "rejected") {
      console.error(
        "[/api/admin/stats] failed to load inquiries:",
        inquiriesResult.reason
      );
    }
    if (registrationsResult.status === "rejected") {
      console.error(
        "[/api/admin/stats] failed to load registrations:",
        registrationsResult.reason
      );
    }
    if (studentsResult.status === "rejected") {
      console.error(
        "[/api/admin/stats] failed to load students:",
        studentsResult.reason
      );
    }

    const allApplications =
      appsResult.status === "fulfilled" ? appsResult.value : [];
    const inquiries =
      inquiriesResult.status === "fulfilled"
        ? (inquiriesResult.value as { created_at: number }[])
        : [];
    const registrations =
      registrationsResult.status === "fulfilled"
        ? (registrationsResult.value as { is_submitted: boolean }[])
        : [];
    // Students for enrollment / withdrawal counts. We need the full
    // row shape (isEnrolled / isArchived) so the dashboard tiles can
    // count both groups; cast to the relevant subset rather than a
    // narrow `unknown[]` so the filters below typecheck.
    const students =
      studentsResult.status === "fulfilled"
        ? (studentsResult.value as Array<{
            id: number;
            isEnrolled?: boolean;
            isArchived?: boolean;
          }>)
        : [];

    // Hide soft-deleted (`isActive=false`) applications from every
    // dashboard count. Treat `undefined` as active so legacy rows
    // still surface.
    const activeApplications = allApplications.filter(
      (a) => (a as { isActive?: boolean }).isActive !== false
    );
    const applications = yearId
      ? activeApplications.filter(
          (a) => Number(a.registration_school_years_id) === yearId
        )
      : activeApplications;

    const totalInquiries = inquiries.length;
    const totalApplications = applications.length;
    const submitted = applications.filter((a) => a.isSubmitted).length;
    const offered = applications.filter((a) => a.isOffered).length;
    const accepted = applications.filter((a) => a.isAccepted).length;
    const denied = applications.filter((a) => a.isDenied === true).length;
    const draft = totalApplications - submitted;
    const totalRegistrations = registrations.length;
    const completedRegistrations = registrations.filter(
      (r) => r.is_submitted
    ).length;
    const totalStudents = students.length;

    // Enrollment / withdrawal counts — gated to the selected year via
    // the per-student application join. A student "belongs to" the
    // selected year when they have an active application for it; their
    // `isEnrolled` / `isArchived` flags are then evaluated. Both flags
    // are per-student (not per-year), so without the year filter we
    // can't distinguish "withdrawn this year" from "withdrawn ever".
    // With no year selected, count across all students.
    const yearStudentIds = yearId
      ? new Set(applications.map((a) => Number(a.registration_students_id)))
      : null;
    const enrollmentScope = yearStudentIds
      ? students.filter((s) => yearStudentIds.has(s.id))
      : students;
    const enrolledCount = enrollmentScope.filter(
      (s) => s.isEnrolled === true && s.isArchived !== true
    ).length;
    const withdrawnCount = enrollmentScope.filter(
      (s) => s.isArchived === true
    ).length;

    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const recentInquiries = inquiries.filter(
      (i) => i.created_at > thirtyDaysAgo
    ).length;

    return NextResponse.json({
      inquiries: { total: totalInquiries, recent: recentInquiries },
      applications: {
        total: totalApplications,
        draft,
        submitted,
        offered,
        accepted,
        denied,
      },
      registrations: {
        total: totalRegistrations,
        completed: completedRegistrations,
        inProgress: totalRegistrations - completedRegistrations,
      },
      students: { total: totalStudents },
      // Per-year enrollment lifecycle counts. Drives the dashboard's
      // "Enrolled" + "Withdrawn" stat tiles. `enrolled` and `withdrawn`
      // are both scoped to the selected year via the application
      // join above.
      enrollment: {
        enrolled: enrolledCount,
        withdrawn: withdrawnCount,
      },
    });
  } catch (err) {
    return handleAdminError(err);
  }
}

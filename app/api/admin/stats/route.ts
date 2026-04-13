import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { NextRequest, NextResponse } from "next/server";

const BASE = process.env.XANO_API_BASE_URL;

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();

    const { searchParams } = new URL(req.url);
    const yearId = searchParams.get("yearId");

    // Fetch all data in parallel
    const [inquiriesRes, applicationsRes, registrationsRes, studentsRes] =
      await Promise.all([
        fetch(`${BASE}/registration_inquiry`, { cache: "no-store" }),
        fetch(`${BASE}/registration_application`, { cache: "no-store" }),
        fetch(`${BASE}/registration_student_registration`, { cache: "no-store" }),
        fetch(`${BASE}/registration_students`, { cache: "no-store" }),
      ]);

    const inquiries = inquiriesRes.ok ? await inquiriesRes.json() : [];
    const allApplications = applicationsRes.ok ? await applicationsRes.json() : [];
    const registrations = registrationsRes.ok ? await registrationsRes.json() : [];
    const students = studentsRes.ok ? await studentsRes.json() : [];

    // Filter applications by year if provided
    const applications = yearId
      ? allApplications.filter(
          (a: { registration_school_years_id: number }) =>
            Number(a.registration_school_years_id) === Number(yearId)
        )
      : allApplications;

    // Compute stats
    const totalInquiries = inquiries.length;
    const totalApplications = applications.length;
    const submitted = applications.filter((a: { isSubmitted: boolean }) => a.isSubmitted).length;
    const offered = applications.filter((a: { isOffered: boolean }) => a.isOffered).length;
    const accepted = applications.filter((a: { isAccepted: boolean }) => a.isAccepted).length;
    const draft = totalApplications - submitted;
    const totalRegistrations = registrations.length;
    const completedRegistrations = registrations.filter(
      (r: { is_submitted: boolean }) => r.is_submitted
    ).length;
    const totalStudents = students.length;

    // Recent inquiries (last 30 days)
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const recentInquiries = inquiries.filter(
      (i: { created_at: number }) => i.created_at > thirtyDaysAgo
    ).length;

    return NextResponse.json({
      inquiries: {
        total: totalInquiries,
        recent: recentInquiries,
      },
      applications: {
        total: totalApplications,
        draft,
        submitted,
        offered,
        accepted,
      },
      registrations: {
        total: totalRegistrations,
        completed: completedRegistrations,
        inProgress: totalRegistrations - completedRegistrations,
      },
      students: {
        total: totalStudents,
      },
    });
  } catch (err) {
    return handleAdminError(err);
  }
}

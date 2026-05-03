import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";

const BASE = process.env.XANO_API_BASE_URL;

/**
 * Counts dashboard backing route. Reads the enriched
 * `/registration_families_all_details` endpoint for the application
 * counts so they line up exactly with what the families + applications
 * tables show, then layers on the inquiries + registrations counts from
 * their own tables.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const { searchParams } = new URL(req.url);
    const yearIdParam = searchParams.get("yearId");
    const yearId = yearIdParam ? Number(yearIdParam) : null;

    const [familiesDetails, inquiriesRes, registrationsRes, studentsRes] =
      await Promise.all([
        xano.families.getAllDetails(),
        fetch(`${BASE}/registration_inquiry`, { cache: "no-store" }),
        fetch(`${BASE}/registration_student_registration`, { cache: "no-store" }),
        fetch(`${BASE}/registration_students`, { cache: "no-store" }),
      ]);

    const inquiries = inquiriesRes.ok ? await inquiriesRes.json() : [];
    const registrations = registrationsRes.ok ? await registrationsRes.json() : [];
    const students = studentsRes.ok ? await studentsRes.json() : [];

    // Flatten applications across families, then filter by year if asked.
    const allApplications = familiesDetails.flatMap(
      (f) => f.registration_students_id
    );
    const applications = yearId
      ? allApplications.filter(
          (a) => Number(a.registration_school_years_id) === yearId
        )
      : allApplications;

    // Counts. Each decision boolean is independent — admin flips one of
    // offered/denied/accepted on a submitted app — so a simple per-flag
    // tally is correct.
    const totalInquiries = inquiries.length;
    const totalApplications = applications.length;
    const submitted = applications.filter((a) => a.isSubmitted).length;
    const offered = applications.filter((a) => a.isOffered).length;
    const accepted = applications.filter((a) => a.isAccepted).length;
    const denied = applications.filter((a) => a.isDenied === true).length;
    const draft = totalApplications - submitted;
    const totalRegistrations = registrations.length;
    const completedRegistrations = registrations.filter(
      (r: { is_submitted: boolean }) => r.is_submitted
    ).length;
    const totalStudents = students.length;

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
        denied,
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

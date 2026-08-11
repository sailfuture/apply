import { auth, currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { xano } from "@/lib/xano";

/**
 * Submit a residential family's mid-year student application. Residential
 * / foster families (the `is_residential` checkbox on the family record)
 * enroll placements directly, so there is no admissions-review queue:
 * submitting creates the student's `registration_student_registration`
 * packet, which IS the accept — the parent lands straight in the packet
 * form, and both parent surfaces derive "registration started" from the
 * packet's existence. Admin's final `registrationConfirmed` gate on the
 * completed packet is unchanged.
 *
 * Scoped tightly on purpose: the application must belong to the
 * authenticated parent's family AND carry `is_residential_addition`.
 *
 * The parent's school-detail field saves still go through the standard
 * `/api/applications/[id]` PATCH (those fields are allowlisted there);
 * this route owns only the submit transition.
 */
export async function PATCH(
  _req: NextRequest,
  { params }: { params: Promise<{ applicationId: string }> }
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const familyId = Number(user.publicMetadata.registration_families_id);
  if (!familyId) {
    return NextResponse.json({ error: "No family found" }, { status: 400 });
  }

  const { applicationId } = await params;
  const appId = Number(applicationId);
  if (!Number.isFinite(appId) || appId <= 0) {
    return NextResponse.json(
      { error: "Invalid application id" },
      { status: 400 }
    );
  }

  // Ownership + residential-addition gate.
  const familyApps = await xano.applications.getByFamilyId(familyId);
  const app = familyApps.find((a) => a.id === appId);
  if (!app) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (app.is_residential_addition !== true) {
    return NextResponse.json(
      { error: "Not a residential addition" },
      { status: 400 }
    );
  }

  // Creating the packet IS the accept — there are no decision-flag
  // columns on `registration_application` to flip (writes to them were
  // silently dropped by Xano; audited 2026-08-10). Both the parent
  // page and the dashboard derive "registration started" from this
  // packet row's existence.
  const studentId = Number(app.registration_students_id);
  const yearId = Number(app.registration_school_years_id);
  if (
    !Number.isFinite(studentId) ||
    studentId <= 0 ||
    !Number.isFinite(yearId) ||
    yearId <= 0
  ) {
    return NextResponse.json(
      { error: "Application is missing its student or year link." },
      { status: 500 }
    );
  }
  const packet = await xano.studentRegistration.resolve(studentId, yearId);

  return NextResponse.json({ ok: true, packetId: packet.id }, { status: 200 });
}

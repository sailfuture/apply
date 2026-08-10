import { auth, currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { xano } from "@/lib/xano";

/**
 * Submit a residential family's mid-year student application. Residential
 * / foster families (the `is_residential` checkbox on the family record)
 * enroll placements directly, so there is no admissions-review queue:
 * submitting auto-accepts the application (all three decision latches,
 * same as the admin "accepted" shorthand) and immediately ensures the
 * student's `registration_student_registration` packet exists — the same
 * cascade the admin accept in `/api/admin/applications/[id]` runs — so
 * the parent lands straight in the packet form. Admin's final
 * `registrationConfirmed` gate on the completed packet is unchanged.
 *
 * Scoped tightly on purpose: the application must belong to the
 * authenticated parent's family AND carry `is_residential_addition`. We
 * keep this submit latch OFF the shared `/api/applications/[id]` PATCH
 * allowlist — exposing `isSubmitted` there would let a parent submit any
 * application out of band, bypassing the family-progress submit flow the
 * normal apply wizard routes through.
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

  const updated = await xano.applications.update(appId, {
    isSubmitted: true,
    isOffered: true,
    isAccepted: true,
  });

  // Best-effort, mirroring the admin accept cascade — the packet form's
  // own endpoints fetch-or-create the packet too, so a failure here just
  // means the packet materializes on first load instead.
  try {
    const studentId = Number(updated.registration_students_id);
    const yearId = Number(updated.registration_school_years_id);
    if (
      Number.isFinite(studentId) &&
      studentId > 0 &&
      Number.isFinite(yearId) &&
      yearId > 0
    ) {
      await xano.studentRegistration.resolve(studentId, yearId);
    }
  } catch (err) {
    console.error(
      `[/api/residential-students/${appId}] failed to ensure packet on accept:`,
      err
    );
  }

  return NextResponse.json(updated, { status: 200 });
}

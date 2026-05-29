import { auth, currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { xano } from "@/lib/xano";

/**
 * Submit a residential family's mid-year student application for admin
 * review. Flips `isSubmitted = true` on the single
 * `is_residential_addition` application so it reads as "submitted" in the
 * admin per-student status derivation.
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

  const updated = await xano.applications.update(appId, { isSubmitted: true });
  return NextResponse.json(updated, { status: 200 });
}

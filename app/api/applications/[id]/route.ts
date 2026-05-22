import { auth, currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { xano } from "@/lib/xano";

/** Normalize Clerk metadata value to a number (it may be stored as string) */
function toNumber(val: unknown): number {
  if (typeof val === "number") return val;
  if (typeof val === "string") return Number(val);
  return NaN;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
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

  const { id } = await params;
  let application;
  try {
    application = await xano.applications.getById(Number(id));
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const appFamilyId = typeof application.registration_families_id === "object" && application.registration_families_id !== null
    ? Number((application.registration_families_id as { id?: number }).id ?? application.registration_families_id)
    : Number(application.registration_families_id);

  if (!application || appFamilyId !== familyId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(application, { status: 200 });
}

// Fields the parent apply-flow surfaces are allowed to PATCH.
// Anything outside this list — billing math, scholarship-confirm
// audit columns, decision booleans, status FKs — is admin-owned
// and writable only through `/api/admin/*` routes. The allowlist
// is the structural guardrail against a buggy or stale parent
// client (autosave, optimistic write, etc.) clobbering an admin-
// entered value like `remaining_opportunity_amount`.
const PARENT_FIELD_ALLOWLIST = [
  // Student Details step — school history + transportation
  "current_previous_school",
  "last_grade_completed",
  "current_grade",
  "describe_student_strengths",
  "describe_student_opportunities_for_growth",
  "is_bus_transportation",
  "bus_stop",
  "primary_home",
  // Initial Testing step
  "nwea_testing_complete",
  "nwea_testing_scheduled",
  // Financial Aid step — parent's SUFS tier pick
  "sufs_award_id",
] as const;

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
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

  const { id } = await params;
  const appId = Number(id);

  try {
    // Verify ownership by checking the family's application list
    const familyApps = await xano.applications.getByFamilyId(familyId);
    if (!familyApps.some((a) => a.id === appId)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const body = await req.json();
    const patch: Record<string, unknown> = {};
    for (const field of PARENT_FIELD_ALLOWLIST) {
      if (field in body) patch[field] = body[field];
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json(
        { error: "No editable fields in body" },
        { status: 400 }
      );
    }

    const updated = await xano.applications.update(appId, patch);
    return NextResponse.json(updated, { status: 200 });
  } catch (err) {
    console.error("Failed to update application:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Update failed" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const familyId = toNumber(user.publicMetadata.registration_families_id);

  const { id } = await params;
  const appId = Number(id);

  try {
    // Verify the application belongs to this family
    const familyApps = await xano.applications.getByFamilyId(familyId);
    const owns = familyApps.some((a) => a.id === appId);

    if (!owns) {
      console.log("[DELETE /api/applications] ownership check failed", {
        appId,
        familyId,
        familyAppIds: familyApps.map((a) => a.id),
      });
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await xano.applications.delete(appId);
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    console.error("Failed to delete application:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Delete failed" },
      { status: 500 }
    );
  }
}

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

  const familyId = toNumber(user.publicMetadata.registration_families_id);

  const { id } = await params;
  const application = await xano.applications.getById(Number(id));

  if (!application || toNumber(application.registration_families_id) !== familyId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(application, { status: 200 });
}

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

  const familyId = toNumber(user.publicMetadata.registration_families_id);

  const { id } = await params;

  try {
    const existing = await xano.applications.getById(Number(id));

    if (!existing || toNumber(existing.registration_families_id) !== familyId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const body = await req.json();
    const updated = await xano.applications.update(Number(id), body);
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

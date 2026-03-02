import { auth, clerkClient, currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { xano, ensureParentRecord } from "@/lib/xano";

async function resolveParents(family: ReturnType<typeof xano.families.getById> extends Promise<infer T> ? T : never) {
  const embedded = xano.families.getEmbeddedParents(family);
  if (embedded.length > 0) return embedded;

  const ids = xano.families.getParentIds(family);
  return await Promise.all(ids.map((id) => xano.parents.getById(id)));
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const familyId = user.publicMetadata.registration_families_id as
    | number
    | undefined;
  if (familyId) {
    return NextResponse.json(
      { error: "You already belong to a family" },
      { status: 409 }
    );
  }

  const { family_name } = await req.json();
  if (!family_name || typeof family_name !== "string") {
    return NextResponse.json(
      { error: "family_name is required" },
      { status: 400 }
    );
  }

  const parent = await ensureParentRecord(userId, user);

  const family = await xano.families.create({
    family_name,
    registration_parents_id: [parent.id],
    registration_students_id: [],
  });

  const clerk = await clerkClient();
  await clerk.users.updateUserMetadata(userId, {
    publicMetadata: { registration_families_id: family.id },
  });

  return NextResponse.json(family, { status: 201 });
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const familyId = user.publicMetadata.registration_families_id as
    | number
    | undefined;

  if (familyId) {
    try {
      const family = await xano.families.getById(familyId);
      const parents = await resolveParents(family);
      return NextResponse.json({ ...family, parents }, { status: 200 });
    } catch {
      return NextResponse.json(null, { status: 200 });
    }
  }

  const parent = await xano.parents.findByClerkId(userId);
  if (!parent) {
    return NextResponse.json(null, { status: 200 });
  }

  const family = await xano.families.findByParentId(parent.id);
  if (!family) {
    return NextResponse.json(null, { status: 200 });
  }

  const clerk = await clerkClient();
  await clerk.users.updateUserMetadata(userId, {
    publicMetadata: { registration_families_id: family.id },
  });

  const parents = await resolveParents(family);
  return NextResponse.json({ ...family, parents }, { status: 200 });
}

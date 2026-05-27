import { auth, clerkClient, currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { xano } from "@/lib/xano";

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { email, first_name, last_name, relationship } =
    await req.json();

  if (!email || typeof email !== "string") {
    return NextResponse.json({ error: "email is required" }, { status: 400 });
  }

  const existingByEmail = await xano.parents.findByEmail(email);
  if (existingByEmail) {
    return NextResponse.json(
      { error: "A parent with this email already exists" },
      { status: 409 }
    );
  }

  // Use Clerk publicMetadata.registration_families_id as the source of
  // truth for "which family does this user belong to" — same pattern as
  // /api/students and /api/applications. The previous parent->family
  // lookup via findByParentId was failing for users whose Xano relation
  // had drifted (Xano many-relation filter quirks, expansion glitches)
  // even though the metadata pointer was correct. Fall back to the
  // parent-lookup only if metadata is missing, so users created before
  // the metadata stamping was added still work.
  let familyId = user.publicMetadata.registration_families_id as
    | number
    | undefined;

  if (!familyId) {
    const currentParent = await xano.parents.findByClerkId(userId);
    if (!currentParent) {
      return NextResponse.json({ error: "Parent record not found" }, { status: 404 });
    }
    const fallback = await xano.families.findByParentId(currentParent.id);
    if (!fallback) {
      return NextResponse.json(
        { error: "You must create a family first" },
        { status: 400 }
      );
    }
    familyId = fallback.id;
    // Repair the metadata pointer so subsequent calls hit the fast path.
    try {
      const clerk = await clerkClient();
      await clerk.users.updateUserMetadata(userId, {
        publicMetadata: { registration_families_id: familyId },
      });
    } catch (err) {
      console.error(`Failed to backfill registration_families_id for ${userId}:`, err);
    }
  }

  const family = await xano.families.getById(familyId);
  if (!family) {
    return NextResponse.json(
      { error: "You must create a family first" },
      { status: 400 }
    );
  }

  const newParent = await xano.parents.create({
    clerk_user_id: "",
    first_name: first_name ?? "",
    last_name: last_name ?? "",
    email,
    phone: "",
    relationship: relationship ?? "",
    invite_status: "pending",
    address_line_1: "",
    address_line_2: "",
    city: "",
    state: "",
    zipcode: "",
  });

  const existingIds = xano.families.getParentIds(family);
  await xano.families.update(family.id, {
    registration_parents_id: [...existingIds, newParent.id],
  });

  try {
    const clerk = await clerkClient();
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const signUpParams = new URLSearchParams();
    if (first_name) signUpParams.set("firstName", first_name);
    if (last_name) signUpParams.set("lastName", last_name);
    if (email) signUpParams.set("email", email);
    const qs = signUpParams.toString();
    await clerk.invitations.createInvitation({
      emailAddress: email,
      redirectUrl: `${appUrl}/sign-up${qs ? `?${qs}` : ""}`,
    });
  } catch (err) {
    console.error("Failed to send Clerk invitation:", err);
  }

  return NextResponse.json(
    { message: "Invitation sent", parent: newParent },
    { status: 201 }
  );
}

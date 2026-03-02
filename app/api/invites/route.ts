import { auth, clerkClient } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { xano } from "@/lib/xano";

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
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

  const currentParent = await xano.parents.findByClerkId(userId);
  if (!currentParent) {
    return NextResponse.json({ error: "Parent record not found" }, { status: 404 });
  }

  const family = await xano.families.findByParentId(currentParent.id);
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

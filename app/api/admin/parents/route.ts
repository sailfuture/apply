import { NextRequest, NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";

/**
 * Admin POST — add a parent to a family on the family's behalf.
 *
 * Mirrors the parent-side `/api/invites` route: creates a fresh
 * `registration_parents` row, links it into the family's
 * `registration_parents_id` array, and sends a Clerk invitation so
 * the new parent can sign in and pick up where the existing
 * parent left off. Distinct from `/api/invites`:
 *
 *   - `requireAdmin` instead of any signed-in Clerk session
 *   - Takes an explicit `familyId` rather than deriving from the
 *     authenticated parent's record (admin acts on any family)
 *   - Still uses the same Xano writes + same Clerk invitation
 *     flow, so the downstream side-effects (email landing in the
 *     new parent's inbox, sign-up landing with their name pre-
 *     filled, post-signup webhook stamping `clerk_user_id`) are
 *     identical
 *
 * Email is required — Clerk invitations are addressed by email
 * and the parent's sign-up flow keys off the email Clerk has on
 * file. If admin needs to add a parent contact who genuinely
 * doesn't have an email (rare; usually shared phone-only
 * relatives), they can use Emergency Contacts instead — those
 * don't carry a Clerk login.
 *
 * Idempotent on email collision: returns 409 if a parent with the
 * same email already exists anywhere in Xano. Admin then patches
 * the existing parent's family link instead of creating a dupe.
 *
 * Body:
 *   - `familyId` (required) — which family the new parent attaches to
 *   - `email` (required) — parent's email; used for the Clerk
 *     invitation and stored on the parent row
 *   - `first_name`, `last_name`, `phone`, `relationship` (optional;
 *     empty string default — parent can finish their profile after
 *     they sign up)
 */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = await req.json();

    const familyId = Number(body?.familyId);
    if (!Number.isFinite(familyId) || familyId <= 0) {
      return NextResponse.json(
        { error: "familyId is required" },
        { status: 400 }
      );
    }

    const email = typeof body?.email === "string" ? body.email.trim() : "";
    if (!email) {
      return NextResponse.json(
        { error: "email is required" },
        { status: 400 }
      );
    }

    // Email uniqueness check — Clerk treats email as primary
    // identity and we don't want two `registration_parents` rows
    // pointing to the same identity. Mirrors the parent-side
    // /api/invites route's collision check.
    const existing = await xano.parents.findByEmail(email);
    if (existing) {
      return NextResponse.json(
        { error: "A parent with this email already exists." },
        { status: 409 }
      );
    }

    const firstName =
      typeof body?.first_name === "string" ? body.first_name : "";
    const lastName =
      typeof body?.last_name === "string" ? body.last_name : "";
    const phone = typeof body?.phone === "string" ? body.phone : "";
    const relationship =
      typeof body?.relationship === "string" ? body.relationship : "";

    // Pull the family up-front so we can append the new parent to
    // its `registration_parents_id` array. If the row doesn't
    // exist we 404 — adding a parent to a phantom family would
    // create an orphaned row.
    const family = await xano.families.getById(familyId);
    if (!family) {
      return NextResponse.json(
        { error: "Family not found." },
        { status: 404 }
      );
    }

    const newParent = await xano.parents.create({
      clerk_user_id: "",
      first_name: firstName,
      last_name: lastName,
      email,
      phone,
      relationship,
      // `invite_status: "pending"` signals the parent hasn't yet
      // accepted their Clerk invitation. Webhook flips this to
      // "accepted" once they sign up.
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

    // Send the Clerk invitation. Same shape as the parent-side
    // /api/invites: a redirect URL to /sign-up with pre-filled
    // first/last/email so the new parent's sign-up form lands
    // populated. Best-effort — failures log but don't fail the
    // primary creation since the parent row + family link are
    // already persisted; admin can re-invite from Clerk's
    // dashboard if needed.
    try {
      const clerk = await clerkClient();
      const appUrl =
        process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
      const signUpParams = new URLSearchParams();
      if (firstName) signUpParams.set("firstName", firstName);
      if (lastName) signUpParams.set("lastName", lastName);
      if (email) signUpParams.set("email", email);
      const qs = signUpParams.toString();
      await clerk.invitations.createInvitation({
        emailAddress: email,
        redirectUrl: `${appUrl}/sign-up${qs ? `?${qs}` : ""}`,
      });
    } catch (err) {
      console.error(
        "[/api/admin/parents] Clerk invitation failed (parent row was still created):",
        err
      );
    }

    return NextResponse.json(
      { message: "Invitation sent", parent: newParent },
      { status: 201 }
    );
  } catch (err) {
    return handleAdminError(err);
  }
}

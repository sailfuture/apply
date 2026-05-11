import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import type { XanoParent } from "@/lib/xano";

/**
 * Admin-only PATCH for a single `registration_parents` row. Used by
 * the Parents / Guardians card on the family detail page to inline-
 * edit contact info on behalf of the family.
 *
 * Distinct from the parent-side `/api/parents/[id]` route: that one
 * is gated on the authenticated parent's Clerk session and only
 * lets them write their own family's parents. This admin route
 * accepts any parent id and skips Clerk-sync side effects — admin
 * edits the Xano row directly. If the parent's Clerk profile needs
 * to track the change too, the parent-side route handles it on
 * their next self-service edit.
 *
 * Allowlist matches the parent-side route's editable fields. `id`
 * / `created_at` / `clerk_user_id` are deliberately excluded —
 * those are managed by the Clerk webhook, not admin workflows.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const { id: idParam } = await params;
    const id = Number(idParam);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json(
        { error: "Invalid parent id" },
        { status: 400 }
      );
    }

    const body = await req.json();
    const ALLOWED: Array<keyof XanoParent> = [
      "first_name",
      "last_name",
      "email",
      "phone",
      "relationship",
      "address_line_1",
      "address_line_2",
      "city",
      "state",
      "zipcode",
    ];
    const patch: Record<string, unknown> = {};
    for (const key of ALLOWED) {
      if (key in body) patch[key] = body[key];
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json(
        { error: "No editable fields in body" },
        { status: 400 }
      );
    }

    const updated = await xano.parents.update(id, patch);
    return NextResponse.json(updated);
  } catch (err) {
    return handleAdminError(err);
  }
}

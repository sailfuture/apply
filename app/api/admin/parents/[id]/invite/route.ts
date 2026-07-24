import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import { resendParentInvite, InviteError } from "@/lib/invites";

/**
 * Admin-only "Resend invite" safety button behind every secondary
 * parent / guardian row on the family + enrolled detail pages.
 *
 * Operates on an existing `registration_parents` row (never creates
 * one) and delegates the idempotent Clerk work to `resendParentInvite`
 * — so clicking repeatedly can't produce duplicate parents or stack
 * duplicate Clerk invitations. See `lib/invites.ts` for the invariants.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();

    const { id: idParam } = await params;
    const id = Number(idParam);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: "Invalid parent id" }, { status: 400 });
    }

    const parent = await xano.parents.getById(id);
    const result = await resendParentInvite(parent);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof InviteError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return handleAdminError(err);
  }
}

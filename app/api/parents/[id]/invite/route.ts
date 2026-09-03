import { getFamilyAuth } from "@/lib/family-auth";
import { NextRequest, NextResponse } from "next/server";
import { xano } from "@/lib/xano";
import { resendParentInvite, InviteError } from "@/lib/invites";

/**
 * Parent-facing "Resend invite" for a co-parent / guardian on the
 * signed-in user's own family. Same ownership model as the PATCH /
 * DELETE handlers in `../route.ts`: the caller can only act on parent
 * rows linked to the family their Clerk metadata points at.
 *
 * The actual send is delegated to `resendParentInvite`, which is
 * idempotent and cannot create a duplicate parent row or a second
 * live Clerk invite (see `lib/invites.ts`).
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getFamilyAuth();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { familyId } = session;
    if (!familyId) {
      return NextResponse.json({ error: "No family found" }, { status: 400 });
    }

    const family = await xano.families.getById(familyId);
    const parentIds = xano.families.getParentIds(family);
    const { id } = await params;
    const parentId = Number(id);

    // Ownership gate — only parents on the caller's own family are
    // resend-able. A 404 (not 403) mirrors the sibling PATCH/DELETE
    // routes so we don't leak whether the id exists elsewhere.
    if (!parentIds.includes(parentId)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const parent = await xano.parents.getById(parentId);
    const result = await resendParentInvite(parent);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof InviteError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[/api/parents/[id]/invite]", err);
    return NextResponse.json(
      { error: "Couldn't send the invitation." },
      { status: 500 }
    );
  }
}

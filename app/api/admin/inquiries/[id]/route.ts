import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { NextRequest, NextResponse } from "next/server";
import { xano } from "@/lib/xano";
import type { XanoInquiry } from "@/lib/xano";

/**
 * Admin-only PATCH for a single `registration_inquiry` row.
 *
 * The list view uses this to flip `isFollowedUp` when an admin marks an
 * inquiry as contacted, which moves the row between the "Followed Up"
 * and "Not Followed Up" sections on the inquiries dashboard.
 *
 * Only fields on the allowlist are forwarded to Xano — the form
 * collects PII fields (parent name, email, etc.) that admins shouldn't
 * be retroactively editing from the dashboard, so we don't pass those
 * through here.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const { id } = await params;
    const body = await req.json();

    const allowed: Array<keyof XanoInquiry> = ["isFollowedUp"];
    const patch: Partial<XanoInquiry> = {};
    for (const key of allowed) {
      if (key in body) {
        // We've already narrowed the key to a known XanoInquiry field.
        (patch as Record<string, unknown>)[key as string] = body[key];
      }
    }

    const updated = await xano.inquiries.update(Number(id), patch);
    return NextResponse.json(updated, { status: 200 });
  } catch (err) {
    return handleAdminError(err);
  }
}

/**
 * Hard-delete an inquiry row. Used by the inquiry list page's row-
 * level Delete affordance — admin spots a junk / test / duplicate
 * inquiry and removes it after confirming through the modal. Hard
 * delete (not soft) because inquiries are pre-application and don't
 * have downstream relations admin needs to preserve for audit.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const { id: idParam } = await params;
    const id = Number(idParam);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    await xano.inquiries.delete(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleAdminError(err);
  }
}

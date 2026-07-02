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

    const allowed: Array<keyof XanoInquiry> = [
      "isFollowedUp",
      "status",
      "status_reason",
      "interest_level",
    ];
    const patch: Partial<XanoInquiry> = {};
    for (const key of allowed) {
      if (key in body) {
        // We've already narrowed the key to a known XanoInquiry field.
        (patch as Record<string, unknown>)[key as string] = body[key];
      }
    }

    // 0–5 only; 0 clears the rating. Verified against the live
    // endpoint: integer 0 IS applied (only empty strings / null get
    // dropped by Xano's conditional field mapping).
    if ("interest_level" in patch) {
      const v = patch.interest_level;
      if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 5) {
        return NextResponse.json(
          { error: "interest_level must be an integer from 0 to 5" },
          { status: 400 }
        );
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

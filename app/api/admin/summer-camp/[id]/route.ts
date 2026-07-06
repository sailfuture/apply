import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { NextRequest, NextResponse } from "next/server";
import { xano } from "@/lib/xano";

/**
 * Admin PATCH for a single `registration_summer_camp` row. Only the
 * attendance flag is writable from the dashboard — the rest of the
 * record is what the parent submitted and admins shouldn't
 * retroactively edit it here. Verified against the live endpoint:
 * booleans round-trip in both directions (unlike empty strings,
 * `false` is not dropped by Xano's field mapping).
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
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    const body = await req.json();
    if (typeof body?.isNotAttending !== "boolean") {
      return NextResponse.json(
        { error: "isNotAttending must be a boolean" },
        { status: 400 }
      );
    }
    const updated = await xano.summerCamp.update(id, {
      isNotAttending: body.isNotAttending,
    });
    return NextResponse.json(updated);
  } catch (err) {
    return handleAdminError(err);
  }
}

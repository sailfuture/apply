import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { NextRequest, NextResponse } from "next/server";
import { xano } from "@/lib/xano";

/**
 * Admin PATCH for a single `registration_summer_camp` row. Only the
 * admin flags are writable from the dashboard — the rest of the
 * record is what the parent submitted and admins shouldn't
 * retroactively edit it here:
 *   - `isNotAttending` — archive flag (family backed out)
 *   - `attended_camp`  — student actually showed up to camp
 *   - `interest_level` — 1–5 conversion stars (All Leads page); 0
 *     clears (integer 0 IS applied by Xano's field mapping, verified
 *     on the inquiries endpoint)
 * Verified against the live endpoint: booleans round-trip in both
 * directions (unlike empty strings, `false` is not dropped by Xano's
 * field mapping).
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
    const patch: {
      isNotAttending?: boolean;
      attended_camp?: boolean;
      interest_level?: number;
    } = {};
    if ("isNotAttending" in body) {
      if (typeof body.isNotAttending !== "boolean") {
        return NextResponse.json(
          { error: "isNotAttending must be a boolean" },
          { status: 400 }
        );
      }
      patch.isNotAttending = body.isNotAttending;
    }
    if ("attended_camp" in body) {
      if (typeof body.attended_camp !== "boolean") {
        return NextResponse.json(
          { error: "attended_camp must be a boolean" },
          { status: 400 }
        );
      }
      patch.attended_camp = body.attended_camp;
    }
    if ("interest_level" in body) {
      const v = body.interest_level;
      if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 5) {
        return NextResponse.json(
          { error: "interest_level must be an integer from 0 to 5" },
          { status: 400 }
        );
      }
      patch.interest_level = v;
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json(
        { error: "Nothing to update" },
        { status: 400 }
      );
    }
    const updated = await xano.summerCamp.update(id, patch);
    return NextResponse.json(updated);
  } catch (err) {
    return handleAdminError(err);
  }
}

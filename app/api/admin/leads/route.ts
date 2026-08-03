import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { LEAD_NOTE_SOURCES, type LeadNoteSource } from "@/lib/xano";
import { updateLead, type LeadAdminPatch } from "@/lib/leads";

/**
 * Admin writes for any recruitment lead, routed to the lead's own
 * source table:
 *
 *   PATCH { source, id, interest_level?, isFollowedUp? }
 *
 * Two admin-owned fields, shared by all four lead tables:
 *   - `interest_level` — 1–5 conversion stars; 0 clears (integer 0 IS
 *     applied by Xano's field mapping, unlike empty strings/null)
 *   - `isFollowedUp`   — "we've reached out" flag
 *
 * `last_reach_out` is deliberately NOT writable here — it's stamped
 * server-side when a note is added (see `/api/admin/notes`), so it
 * stays an honest record of contact rather than a hand-editable field.
 */
export async function PATCH(req: NextRequest) {
  try {
    await requireAdmin();
    const body = await req.json().catch(() => null);
    const source = body?.source as LeadNoteSource;
    const id = Number(body?.id);
    if (!LEAD_NOTE_SOURCES.includes(source) || !Number.isFinite(id) || id <= 0) {
      return NextResponse.json(
        { error: "source (inquiry|camp|visit|tasco) and id are required" },
        { status: 400 }
      );
    }

    const patch: LeadAdminPatch = {};
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
    if ("isFollowedUp" in body) {
      if (typeof body.isFollowedUp !== "boolean") {
        return NextResponse.json(
          { error: "isFollowedUp must be a boolean" },
          { status: 400 }
        );
      }
      patch.isFollowedUp = body.isFollowedUp;
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const updated = await updateLead(source, id, patch);
    return NextResponse.json(updated);
  } catch (err) {
    return handleAdminError(err);
  }
}

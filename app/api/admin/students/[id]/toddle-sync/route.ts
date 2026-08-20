import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import { isToddleConfigured, ToddleSyncError } from "@/lib/toddle";
import {
  buildToddleSyncShared,
  syncStudentToToddle,
} from "@/lib/toddle-sync";

/**
 * Admin-only "Sync to Toddle" — pushes one enrolled student into the
 * school's Toddle org. Updates the existing Toddle student when one
 * matches (stored id → sourceId lookup → name fallback, see
 * `lib/toddle.ts#upsertStudent`), creates one when none does.
 *
 * The actual sync lives in `lib/toddle-sync.ts#syncStudentToToddle`,
 * shared with the bulk `/api/admin/students/toddle-sync-all` route:
 * identity fields, school email, enrollment date, home address,
 * photo, family contacts (parent accounts + contact cards), and crew
 * class placement.
 *
 * Body (optional): `{ gradeLevel?: string }` — the admin-assigned
 * placement grade ("9th") from the student's packet; the server falls
 * back to the packet itself. Required only when the sync has to
 * CREATE the Toddle student (Toddle mandates a year group).
 *
 * Response: `{ action, toddleId, matchedBy, persisted, photo,
 * familyMembers, crew }`.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const { id: idParam } = await params;
    const id = Number(idParam);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: "Invalid student id" }, { status: 400 });
    }
    if (!isToddleConfigured()) {
      return NextResponse.json(
        {
          error:
            "Toddle isn't configured — set TODDLE_API_TOKEN (and TODDLE_REGION or TODDLE_API_BASE_URL) in the environment.",
        },
        { status: 503 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const gradeLevel =
      typeof body?.gradeLevel === "string" ? body.gradeLevel.trim() : "";

    const student = await xano.students.getById(id);
    const shared = await buildToddleSyncShared();
    const outcome = await syncStudentToToddle(
      student,
      gradeLevel || undefined,
      shared
    );

    return NextResponse.json(outcome);
  } catch (err) {
    if (err instanceof ToddleSyncError) {
      // Admin-fixable condition (missing placement, ambiguous match,
      // unmapped year group) — 422 with the message shown verbatim.
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    return handleAdminError(err);
  }
}

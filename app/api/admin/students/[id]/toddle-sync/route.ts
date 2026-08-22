import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import { evaluateToddleReadiness } from "@/lib/toddle-readiness";
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
 * Response: `{ action ("created" | "updated" | "unchanged"),
 * changedFields (which profile fields actually differed), compared,
 * toddleId, matchedBy, persisted, photo,
 * familyMembers, crew }`.
 */
/**
 * Pre-flight for ONE student — what the sync will push and what it
 * can't, without touching Toddle.
 *
 *   GET → ToddleReadiness
 *
 * Backs the checklist inside the "Sync to Toddle" confirm dialog, so
 * the answer to "why did this student fail?" is visible before the
 * push rather than as an error toast after it.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const { id: idParam } = await params;
    const id = Number(idParam);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: "Invalid student id" }, { status: 400 });
    }

    const student = await xano.students.getById(id);
    const years = await xano.schoolYears.getAll().catch(() => []);
    const activeYear = years.find((y) => y.isActive) ?? null;

    // Same packet fallback the sync uses: the active year's packet
    // when there is one, otherwise whatever packet the student has.
    const packet = activeYear
      ? ((await xano.studentRegistration
          .getByStudentAndYear(id, activeYear.id)
          .catch(() => null)) ??
        (await xano.studentRegistration
          .getByStudentId(id)
          .catch(() => null)))
      : await xano.studentRegistration.getByStudentId(id).catch(() => null);

    // Contacts, primary (lowest id) first — the sync reads the primary
    // contact's address, so the order matters to the report.
    const familyId = Number(student.registration_families_id) || 0;
    const family = familyId
      ? await xano.families.getById(familyId).catch(() => null)
      : null;
    const parents = [] as Awaited<ReturnType<typeof xano.parents.getById>>[];
    if (family) {
      for (const pid of xano.families.getParentIds(family)) {
        const parent = await xano.parents.getById(pid).catch(() => null);
        if (parent) parents.push(parent);
      }
      parents.sort((a, b) => a.id - b.id);
    }

    return NextResponse.json(
      evaluateToddleReadiness({ student, packet, parents, years })
    );
  } catch (err) {
    return handleAdminError(err);
  }
}

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

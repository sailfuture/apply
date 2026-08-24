import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import { getAllStudents, isToddleConfigured } from "@/lib/toddle";

/**
 * Point one of our students at an EXISTING Toddle record.
 *
 *   POST { toddleId: "412204840572182566" } → { linked, toddleId, name }
 *
 * The answer to "Toddle already has this child under a different
 * spelling." Writing `toddle_student_id` makes every later sync a
 * direct update of that record — the name, email and DOB on our side
 * then overwrite Toddle's, which is what closes the drift that caused
 * the near-match in the first place.
 *
 * Deliberately does NOT touch Toddle. The link is one Xano column, so
 * a wrong choice is undone by linking to the other record and syncing
 * again; nothing has been created or overwritten in the meantime.
 *
 * The id is checked against the live roster before it's stored, so a
 * stale dialog can't persist an id that no longer exists.
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

    const body = await req.json().catch(() => null);
    const toddleId = String(body?.toddleId ?? "").trim();
    if (!toddleId) {
      return NextResponse.json(
        { error: "toddleId is required." },
        { status: 400 }
      );
    }

    const roster = await getAllStudents();
    const target = roster.find((r) => String(r.id) === toddleId);
    if (!target) {
      return NextResponse.json(
        {
          error:
            "That Toddle student is no longer on the roster — reopen the dialog to refresh the list.",
        },
        { status: 404 }
      );
    }

    // Don't let two of our students claim one Toddle record: the
    // second sync would overwrite the first student's profile with
    // the second student's details.
    const students = await xano.students.getAll();
    const taken = students.find(
      (s) => s.id !== id && (s.toddle_student_id ?? "").trim() === toddleId
    );
    if (taken) {
      return NextResponse.json(
        {
          error: `That Toddle record is already linked to ${(
            `${taken.first_name ?? ""} ${taken.last_name ?? ""}`.trim() ||
            `student #${taken.id}`
          )}.`,
        },
        { status: 409 }
      );
    }

    await xano.students.updateOnAdminGroup(id, {
      toddle_student_id: toddleId,
    });

    return NextResponse.json({
      linked: true,
      toddleId,
      name: `${(target.firstName ?? "").trim()} ${(
        target.lastName ?? ""
      ).trim()}`.trim(),
    });
  } catch (err) {
    return handleAdminError(err);
  }
}

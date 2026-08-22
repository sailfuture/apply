import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";

/**
 * Admin PATCH / DELETE for one academic season.
 *
 * PATCH allowlists name and the linked-term FK (0 unlinks — Xano
 * applies integer 0 fine, unlike null); the school-year FK is
 * deliberately not editable.
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
      return NextResponse.json(
        { error: "Invalid season id" },
        { status: 400 }
      );
    }
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 }
      );
    }

    const patch: Record<string, unknown> = {};
    if ("name" in body) {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name) {
        return NextResponse.json(
          { error: "Season name can't be empty" },
          { status: 400 }
        );
      }
      patch.name = name;
    }
    if ("registration_academic_terms_id" in body) {
      patch.registration_academic_terms_id = coerceFk(
        body.registration_academic_terms_id
      );
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json(
        { error: "No editable fields in body" },
        { status: 400 }
      );
    }

    const updated = await xano.academicSeasons.update(id, patch);
    return NextResponse.json(updated);
  } catch (err) {
    return handleAdminError(err);
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const { id: idParam } = await params;
    const id = Number(idParam);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json(
        { error: "Invalid season id" },
        { status: 400 }
      );
    }
    // Un-assign every calendar day pointing at this season BEFORE
    // deleting the row, so day rows never carry a dangling seasons_id.
    // All-years scan because the season row is the only thing that
    // knows its year and we're about to delete it anyway. Both slots
    // count: on a changeover date the season may hold only the
    // afternoon (`seasons_id_pm`). Losing the morning half promotes
    // the incoming season to sole owner rather than leaving an
    // afternoon with nobody before it.
    const days = await xano.schoolCalendar.getAll();
    const assigned = days.filter(
      (d) => Number(d.seasons_id) === id || Number(d.seasons_id_pm) === id
    );
    for (let i = 0; i < assigned.length; i += 10) {
      await Promise.all(
        assigned.slice(i, i + 10).map((d) =>
          xano.schoolCalendar.update(
            d.id,
            Number(d.seasons_id) === id
              ? {
                  seasons_id: Number(d.seasons_id_pm) || 0,
                  seasons_id_pm: 0,
                  season_handoff: 0,
                }
              : { seasons_id_pm: 0, season_handoff: 0 }
          )
        )
      );
    }
    await xano.academicSeasons.delete(id);
    return NextResponse.json({ ok: true, cleared: assigned.length });
  } catch (err) {
    return handleAdminError(err);
  }
}

/** Positive FK id, else 0 ("not linked" — Xano int inputs reject null). */
function coerceFk(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

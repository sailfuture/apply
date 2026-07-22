import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";

/**
 * Admin PATCH / DELETE for one academic term.
 *
 * PATCH allowlists term_name / start_date / end_date / isActive; the
 * school-year FK is deliberately not editable. NOTE: Xano's edit
 * endpoint drops null/empty inputs, so a saved date can be changed
 * but not cleared — the UI reflects that.
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
        { error: "Invalid term id" },
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
    if ("term_name" in body) {
      const name =
        typeof body.term_name === "string" ? body.term_name.trim() : "";
      if (!name) {
        return NextResponse.json(
          { error: "Term name can't be empty" },
          { status: 400 }
        );
      }
      patch.term_name = name;
    }
    const startDate = coerceDate(body.start_date);
    const endDate = coerceDate(body.end_date);
    if (startDate && endDate && endDate < startDate) {
      return NextResponse.json(
        { error: "End date can't be before the start date" },
        { status: 400 }
      );
    }
    if (startDate) patch.start_date = startDate;
    if (endDate) patch.end_date = endDate;
    if ("isActive" in body) patch.isActive = body.isActive === true;

    if (Object.keys(patch).length === 0) {
      return NextResponse.json(
        { error: "No editable fields in body" },
        { status: 400 }
      );
    }

    const updated = await xano.academicTerms.update(id, patch);
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
        { error: "Invalid term id" },
        { status: 400 }
      );
    }
    await xano.academicTerms.delete(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleAdminError(err);
  }
}

/** "YYYY-MM-DD" pass-through, null for anything else. */
function coerceDate(v: unknown): string | null {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

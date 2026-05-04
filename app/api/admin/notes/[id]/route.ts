import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";

/**
 * Per-note edit / delete. PATCH stamps `last_edited` so the UI can show
 * "(edited)" indicators. Authorship checks happen client-side for now —
 * any admin can edit any note. If we tighten this later we'll compare
 * `author_email` against the current admin in the route.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const { id: idParam } = await params;
    const id = Number(idParam);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const body = await req.json();
    const patch: Record<string, unknown> = { last_edited: Date.now() };

    if (typeof body?.body === "string") {
      const trimmed = body.body.trim();
      if (!trimmed) {
        return NextResponse.json(
          { error: "Note body cannot be empty" },
          { status: 400 }
        );
      }
      patch.body = trimmed;
    }
    if (typeof body?.category === "string") patch.category = body.category;
    if (typeof body?.is_pinned === "boolean") patch.is_pinned = body.is_pinned;
    // Parent-visibility toggle is editable post-write so admin can
    // un-share a note they accidentally flagged shared (or reveal
    // an internal note later). Section key is also editable — a
    // note that started general can be re-scoped if the surface it
    // was about gets a more specific home.
    if (typeof body?.is_shared_with_parent === "boolean") {
      patch.is_shared_with_parent = body.is_shared_with_parent;
    }
    if (typeof body?.section === "string" || body?.section === null) {
      patch.section =
        typeof body.section === "string" && body.section.trim().length > 0
          ? body.section.trim()
          : null;
    }

    const updated = await xano.adminNotes.update(id, patch);
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
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    await xano.adminNotes.delete(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleAdminError(err);
  }
}

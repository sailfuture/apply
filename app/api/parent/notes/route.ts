import { getFamilyAuth } from "@/lib/family-auth";
import { NextResponse } from "next/server";
import { xano } from "@/lib/xano";

/**
 * Parent-facing notes feed. Returns the admin notes tied to the
 * authenticated parent's family that admin has explicitly chosen to
 * share (`is_shared_with_parent === true`). Internal-only notes never
 * surface here — the family-wide drawer on the admin side is the
 * source of truth for what gets shared.
 *
 * Read-only: the parent doesn't edit, pin, or delete notes. They
 * just see what admin chose to surface (e.g. "Approved your testing
 * window for next Tuesday at 10am").
 *
 * Auth: standard parent flow — Clerk userId is required, family id
 * is read from `publicMetadata.registration_families_id` set during
 * family creation. Returns `[]` if the user has no family yet so
 * the UI can hide its trigger button cleanly.
 */
export async function GET() {
  const session = await getFamilyAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { familyId } = session;
  if (!familyId) {
    return NextResponse.json([]);
  }

  try {
    const all = await xano.adminNotes.getByFamilyId(familyId);
    // Defense-in-depth: even though `getByFamilyId` filters out
    // inquiry-scoped notes, narrow once more to the shared subset
    // here so the parent never sees an internal note that drifted
    // through. Sort newest-first to match the admin timeline shape.
    const visible = all
      .filter((n) => n.is_shared_with_parent === true)
      .sort((a, b) => b.created_at - a.created_at);
    return NextResponse.json(visible);
  } catch (err) {
    console.error("[parent/notes GET] failed:", err);
    return NextResponse.json([]);
  }
}

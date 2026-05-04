import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import type { XanoFamilyApplicationProgress } from "@/lib/xano";

/**
 * Admin GET — resolves the per-year progress row for a family. Mirrors
 * the `resolve` semantics so the caller always gets a row back (created
 * if missing). Useful so the Decision card on the family detail page
 * can render flipping `isAccepted` without first having to know whether
 * a row exists yet.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const familyIdParam = req.nextUrl.searchParams.get("familyId");
    const yearIdParam = req.nextUrl.searchParams.get("yearId");
    const familyId = Number(familyIdParam);
    const yearId = Number(yearIdParam);
    if (!Number.isFinite(familyId) || familyId <= 0) {
      return NextResponse.json(
        { error: "familyId is required" },
        { status: 400 }
      );
    }
    if (!Number.isFinite(yearId) || yearId <= 0) {
      return NextResponse.json(
        { error: "yearId is required" },
        { status: 400 }
      );
    }
    const row = await xano.familyApplicationProgress.resolve(familyId, yearId);
    return NextResponse.json(row);
  } catch (err) {
    return handleAdminError(err);
  }
}

/**
 * Admin-only PATCH for the per-year `registration_family_application_progress`
 * row. Used by the Decision card on the family detail page to flip
 * `isAccepted` (and its companions) without granting the parent-side
 * `/api/family-progress` route the same power — that one only allows the
 * authenticated parent to mutate progress on their own family, and
 * deliberately doesn't expose `isAccepted`.
 *
 * Resolves the row first so admins can accept a family that hasn't yet
 * touched the apply flow on their own (rare but possible — e.g. paper
 * applications transcribed by staff).
 *
 * Body: `{ familyId, yearId, isAccepted?, isSubmitted?, ... }`
 *
 * Only a small allowlist of fields is patchable; passing anything else
 * is silently ignored.
 */
export async function PATCH(req: NextRequest) {
  try {
    await requireAdmin();
    const body = await req.json();

    const familyId = Number(body?.familyId);
    const yearId = Number(body?.yearId);
    if (!Number.isFinite(familyId) || familyId <= 0) {
      return NextResponse.json(
        { error: "familyId is required" },
        { status: 400 }
      );
    }
    if (!Number.isFinite(yearId) || yearId <= 0) {
      return NextResponse.json(
        { error: "yearId is required" },
        { status: 400 }
      );
    }

    // Allowlist — admin can flip per-year decision flags + section
    // completion booleans (useful when correcting state), but not the
    // foreign keys or `id`. `last_edited` is bumped automatically.
    //
    // `is_archived` + `reason_for_archive` are scoped to the Archive
    // affordance in the family detail header. The reason field is
    // intentionally on the allowlist so the modal can pass the
    // captured rationale alongside the flag flip in one round
    // trip; the route doesn't enforce that reason is non-empty —
    // that's the UI's job (text required on the modal).
    const ALLOWED: Array<keyof XanoFamilyApplicationProgress> = [
      "isAccepted",
      "isSubmitted",
      "submitted_at",
      "family_completed",
      "students_completed",
      "financial_aid_completed",
      "testing_completed",
      "registration_type_id",
      "is_archived",
      "reason_for_archive",
    ];
    const patch: Record<string, unknown> = { last_edited: Date.now() };
    for (const key of ALLOWED) {
      if (key in body) patch[key] = body[key];
    }

    if (Object.keys(patch).length <= 1) {
      // Only `last_edited` — nothing meaningful to update.
      return NextResponse.json(
        { error: "No editable fields in body" },
        { status: 400 }
      );
    }

    const row = await xano.familyApplicationProgress.resolve(familyId, yearId);
    const updated = await xano.familyApplicationProgress.update(row.id, patch);
    return NextResponse.json(updated);
  } catch (err) {
    return handleAdminError(err);
  }
}

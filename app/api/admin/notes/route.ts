import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";

/**
 * Admin notes (the comms log). Scoped per family — pass `?familyId=X`
 * to list notes for that family. Notes can optionally narrow to a
 * specific student or year via the `registration_students_id` /
 * `registration_school_years_id` columns; filtering by those is done
 * client-side since we always read the full per-family list anyway.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const familyIdParam = req.nextUrl.searchParams.get("familyId");
    if (!familyIdParam) {
      return NextResponse.json(
        { error: "familyId is required" },
        { status: 400 }
      );
    }
    const familyId = Number(familyIdParam);
    if (!Number.isFinite(familyId)) {
      return NextResponse.json(
        { error: "familyId must be a number" },
        { status: 400 }
      );
    }
    const notes = await xano.adminNotes.getByFamilyId(familyId);
    return NextResponse.json(notes);
  } catch (err) {
    return handleAdminError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { admin } = await requireAdmin();
    const body = await req.json();

    const familyId = Number(body?.registration_families_id);
    if (!Number.isFinite(familyId) || familyId <= 0) {
      return NextResponse.json(
        { error: "registration_families_id is required" },
        { status: 400 }
      );
    }

    const trimmedBody = typeof body?.body === "string" ? body.body.trim() : "";
    if (!trimmedBody) {
      return NextResponse.json(
        { error: "Note body is required" },
        { status: 400 }
      );
    }

    const note = await xano.adminNotes.create({
      registration_families_id: familyId,
      registration_students_id: optionalNumber(body?.registration_students_id),
      registration_school_years_id: optionalNumber(
        body?.registration_school_years_id
      ),
      author_email: admin.email,
      author_name: admin.name,
      body: trimmedBody,
      category: typeof body?.category === "string" ? body.category : "other",
      is_pinned: body?.is_pinned === true,
    });
    return NextResponse.json(note, { status: 201 });
  } catch (err) {
    return handleAdminError(err);
  }
}

function optionalNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

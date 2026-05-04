import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";

/**
 * Admin notes (the comms log). Two scopes share the same table:
 *
 *  - `?familyId=X` — notes about a family, used on the family detail
 *    page's pinned bottom-right Notes drawer.
 *  - `?inquiryId=X` — notes about a prospective-family inquiry, used
 *    on the inquiries dashboard's per-row Sheet.
 *
 * Exactly one scope must be supplied. Inquiry scope is filtered on
 * `registration_inquiry_id` so family notes never bleed into the
 * inquiry timeline (and vice versa).
 *
 * Notes can optionally narrow to a specific student or year via the
 * `registration_students_id` / `registration_school_years_id` columns;
 * filtering by those is done client-side since we always read the full
 * per-scope list anyway.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const familyIdParam = req.nextUrl.searchParams.get("familyId");
    const inquiryIdParam = req.nextUrl.searchParams.get("inquiryId");

    if (!familyIdParam && !inquiryIdParam) {
      return NextResponse.json(
        { error: "familyId or inquiryId is required" },
        { status: 400 }
      );
    }
    if (familyIdParam && inquiryIdParam) {
      return NextResponse.json(
        { error: "Provide only one of familyId or inquiryId" },
        { status: 400 }
      );
    }

    // Optional `?section=…` filter — narrows a family's notes to a
    // specific surface (e.g. one contributing member's review).
    // Applied client-side after the per-scope fetch since Xano's
    // auto-generated GET doesn't honor arbitrary text filters.
    const sectionParam = req.nextUrl.searchParams.get("section");

    if (inquiryIdParam) {
      const inquiryId = Number(inquiryIdParam);
      if (!Number.isFinite(inquiryId)) {
        return NextResponse.json(
          { error: "inquiryId must be a number" },
          { status: 400 }
        );
      }
      const notes = await xano.adminNotes.getByInquiryId(inquiryId);
      return NextResponse.json(
        sectionParam ? notes.filter((n) => n.section === sectionParam) : notes
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
    return NextResponse.json(
      sectionParam ? notes.filter((n) => n.section === sectionParam) : notes
    );
  } catch (err) {
    return handleAdminError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { admin } = await requireAdmin();
    const body = await req.json();

    const familyId = optionalNumber(body?.registration_families_id);
    const inquiryId = optionalNumber(body?.registration_inquiry_id);

    // Exactly-one rule mirrors the GET — keeps a single note from
    // appearing in two timelines and simplifies cache invalidation.
    if (!familyId && !inquiryId) {
      return NextResponse.json(
        {
          error:
            "registration_families_id or registration_inquiry_id is required",
        },
        { status: 400 }
      );
    }
    if (familyId && inquiryId) {
      return NextResponse.json(
        {
          error:
            "Provide only one of registration_families_id / registration_inquiry_id",
        },
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

    // For family notes, `registration_families_id` is the required FK
    // on Xano. For inquiry-scoped notes we still send a families id
    // (Xano column is non-nullable on legacy rows) — set to 0 so
    // it's an explicit "no family" rather than dragging in a real one.
    const note = await xano.adminNotes.create({
      registration_families_id: familyId ?? 0,
      registration_students_id: optionalNumber(body?.registration_students_id),
      registration_school_years_id: optionalNumber(
        body?.registration_school_years_id
      ),
      registration_inquiry_id: inquiryId ?? null,
      author_email: admin.email,
      author_name: admin.name,
      body: trimmedBody,
      category: typeof body?.category === "string" ? body.category : "other",
      is_pinned: body?.is_pinned === true,
      section:
        typeof body?.section === "string" && body.section.trim().length > 0
          ? body.section.trim()
          : null,
      // Default-internal: a note is admin-only unless the caller
      // explicitly asks to share it. Avoids accidental disclosure
      // when a future surface forgets to set the field.
      is_shared_with_parent: body?.is_shared_with_parent === true,
    });

    // Bump the inquiry's `last_reach_out` so the dashboard can show
    // "last contacted X days ago" without scanning the notes timeline
    // on every render. Server-managed: the inquiries PATCH endpoint's
    // allowlist intentionally excludes this field so admins can't
    // edit it by hand.
    if (inquiryId) {
      try {
        await xano.inquiries.update(inquiryId, {
          last_reach_out: Date.now(),
        });
      } catch (err) {
        // Don't fail the note POST just because the timestamp bump
        // failed — admin still gets their note saved. Surface the
        // error in the server log so it's visible during diagnosis.
        console.error("Failed to bump last_reach_out:", err);
      }
    }

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

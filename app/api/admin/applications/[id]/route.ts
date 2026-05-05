import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";

/**
 * Admin GET / PATCH for a single `registration_application` row.
 *
 * The PATCH endpoint accepts either:
 *   - A `{ status: "submitted" | "offered" | "denied" | "accepted" | "draft" }`
 *     shorthand that flips the corresponding decision booleans (and
 *     unsets the others) — used by the inline status dropdown on the
 *     applications list.
 *   - A flat partial object with explicit fields to PATCH directly —
 *     used by the per-application detail page when editing arbitrary
 *     application values (grade, school, scholarship, etc.).
 *
 * Both shapes can be combined in one PATCH; status is applied first,
 * then the rest of the fields override.
 */
export async function GET(
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
    const app = await xano.applications.getById(id);
    return NextResponse.json(app);
  } catch (err) {
    return handleAdminError(err);
  }
}

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
    const patch: Record<string, unknown> = {};

    // Status shorthand → decision-boolean transitions. Each branch sets
    // exactly one of the four flags and clears the others so the row
    // never lands in an inconsistent state (e.g. both Offered and Denied).
    if (typeof body?.status === "string") {
      switch (body.status) {
        case "draft":
          patch.isSubmitted = false;
          patch.isOffered = false;
          patch.isAccepted = false;
          patch.isDenied = false;
          break;
        case "submitted":
          patch.isSubmitted = true;
          patch.isOffered = false;
          patch.isAccepted = false;
          patch.isDenied = false;
          break;
        case "offered":
          patch.isSubmitted = true;
          patch.isOffered = true;
          patch.isAccepted = false;
          patch.isDenied = false;
          break;
        case "denied":
          patch.isSubmitted = true;
          patch.isOffered = false;
          patch.isAccepted = false;
          patch.isDenied = true;
          break;
        case "accepted":
          patch.isSubmitted = true;
          patch.isOffered = true;
          patch.isAccepted = true;
          patch.isDenied = false;
          break;
        default:
          return NextResponse.json(
            { error: `Unknown status "${body.status}"` },
            { status: 400 }
          );
      }
    }

    // Allowlist of editable fields. Anything not in this list is ignored
    // — keeps an admin from accidentally overwriting Xano-managed columns
    // (id, created_at, foreign keys) by tossing extra props in the body.
    const FIELD_ALLOWLIST = [
      "registration_application_status_id",
      "type",
      "current_previous_school",
      "describe_student_opportunities_for_growth",
      "describe_student_strengths",
      "sufs_type",
      "sufs_status",
      "sufs_award_id",
      "sufs_confirmed",
      "confirmed_scholarship",
      "is_bus_transportation",
      "bus_stop",
      "test_scores",
      "nwea_testing_complete",
      "nwea_testing_scheduled",
      "last_grade_completed",
      "current_grade",
      "isSubmitted",
      "isOffered",
      "isAccepted",
      "isDenied",
      "isActive",
      "opportunity_scholarship_award_amount",
      // Liability-waiver fields removed — they live on the per-student
      // `registration_student_registration` packet now. Use
      // `/api/admin/student-registration/[id]` to PATCH waiver state
      // instead.
      "enrollment_agreement_pandadoc_id",
      "enrollment_agreement_status",
      "enrollment_agreement_sent_at",
      "enrollment_agreement_pdf_url",
    ] as const;
    for (const field of FIELD_ALLOWLIST) {
      if (field in body) patch[field] = body[field];
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json(
        { error: "No editable fields in body" },
        { status: 400 }
      );
    }

    const updated = await xano.applications.update(id, patch);
    return NextResponse.json(updated);
  } catch (err) {
    return handleAdminError(err);
  }
}

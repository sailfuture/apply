import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import type { XanoStudentRegistrationProgress } from "@/lib/xano";

/**
 * Admin-only PATCH for the per-year `registration_student_registration_progress`
 * row — the family-level packet progress that drives the four section
 * cards on the family registration detail page (Tuition / Enrollment
 * Agreement / Registration Packet / Volunteer Hours).
 *
 * Distinct from the parent-side `/api/registration-progress` route:
 * that one is gated on the authenticated parent and refuses to touch
 * fields admin needs to override (like flipping a section confirmed
 * on the family's behalf, or marking the packet submitted out of
 * band). This route is `requireAdmin` and exposes a focused
 * allowlist of fields admin actually wants to override.
 *
 * Resolves the row first so admin can act on a family that hasn't
 * yet started the registration flow on their own.
 *
 * Body: `{ familyId, yearId, isTuition?, isEnrollment?, ... }`
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

    // Allowlist — admin can flip the four section booleans, the
    // submission flag, the per-section names + signatures (for
    // override / void), and the enrollment-agreement metadata
    // (status, sent timestamp, PDF URL) so the Re-send affordance
    // can write back what PandaDoc returns.
    //
    // Foreign keys + `id` + `created_at` are deliberately excluded —
    // changing those would orphan the row.
    const ALLOWED: Array<keyof XanoStudentRegistrationProgress> = [
      "isTuition",
      "isEnrollment",
      "isRegistration",
      "isVolunteerHours",
      "isSubmitted",
      "submitted_date",
      "monthly_tuition_payment",
      "monthly_transportation_payment",
      "enrollment_agreement_pandadoc_id",
      "enrollment_agreement_status",
      "enrollment_agreement_sent",
      "enrollment_agreement_pdf_url",
      "is_enrollment_agreement_signed",
      "tuition_scholarship_signature",
      "signature_data_volunteer",
      "volunteer_signature_data",
      "name_volunteer",
      "signature_data",
      "name",
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

    const row = await xano.studentRegistrationProgress.resolve(
      familyId,
      yearId
    );
    const updated = await xano.studentRegistrationProgress.update(
      row.id,
      patch
    );
    return NextResponse.json(updated);
  } catch (err) {
    return handleAdminError(err);
  }
}

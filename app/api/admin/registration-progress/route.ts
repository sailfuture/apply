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
 * Distinct from the parent-side `/api/student-registration-progress`
 * route: that one is gated on the authenticated parent and refuses
 * to touch fields admin needs to override (like flipping a section
 * confirmed on the family's behalf, or marking the packet submitted
 * out of band). This route is `requireAdmin` and exposes a focused
 * allowlist of fields admin actually wants to override.
 *
 * Resolves the row first so admin can act on a family that hasn't
 * yet started the registration flow on their own.
 *
 * Body: `{ familyId, yearId, isTuition?, isEnrollment?, ... }`
 */

/**
 * Section-verify pairs — three columns per section that get stamped
 * together when admin clicks "Verify <Section>" on the registration
 * detail page. The bool is what the UI reads/writes; the time +
 * admin name are auto-managed here so clients don't have to (and
 * can't) hand-write them.
 *
 * Three sections track admin verification on this row: Tuition,
 * Enrollment, Volunteer Hours. The Registration Packet's
 * confirmation is per-student (lives on
 * `registration_student_registration.registrationConfirmed`), so
 * there's no entry for it here.
 *
 * Mirrors the same pattern used by the apply-flow family-progress
 * route's section-confirm pairs.
 */
const SECTION_VERIFY_PAIRS: Array<{
  confirmKey: keyof XanoStudentRegistrationProgress;
  timeKey: keyof XanoStudentRegistrationProgress;
  adminKey: keyof XanoStudentRegistrationProgress;
}> = [
  {
    confirmKey: "tuition_admin_confirm",
    timeKey: "tuition_admin_confirm_time",
    adminKey: "tuition_admin_confirm_admin",
  },
  {
    confirmKey: "enrollment_admin_confirm",
    timeKey: "enrollment_admin_confirm_time",
    adminKey: "enrollment_admin_confirm_admin",
  },
  {
    confirmKey: "volunteer_admin_confirm",
    timeKey: "volunteer_admin_confirm_time",
    adminKey: "volunteer_admin_confirm_admin",
  },
];

export async function PATCH(req: NextRequest) {
  try {
    const { admin } = await requireAdmin();
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

    // Allowlist — admin can flip the four parent-completion section
    // booleans, the submission flag, the per-section names +
    // signatures (for override / void), the enrollment-agreement
    // metadata (status, sent timestamp, PDF URL) so the re-send
    // affordance can write back what PandaDoc returns, and the three
    // section-verify bools the registration card footers toggle.
    //
    // Foreign keys + `id` + `created_at` are deliberately excluded —
    // changing those would orphan the row. `*_admin_confirm_time` +
    // `*_admin_confirm_admin` audit columns are NOT on the body
    // allowlist; we stamp those server-side from the admin's display
    // name + Date.now() based on the bool's new value.
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
      "tuition_admin_confirm",
      "enrollment_admin_confirm",
      "volunteer_admin_confirm",
    ];
    const patch: Record<string, unknown> = { last_edited: Date.now() };
    for (const key of ALLOWED) {
      if (key in body) patch[key] = body[key];
    }

    // Auto-stamp the audit pair for every section-verify bool that
    // appears in the patch. true → time = now, admin = display name;
    // false → time = null, admin = "". Stays in sync with whatever
    // bool admin just flipped without forcing the client to send the
    // audit fields.
    const now = Date.now();
    const adminName = admin?.name ?? "";
    for (const pair of SECTION_VERIFY_PAIRS) {
      if (pair.confirmKey in patch) {
        const next = patch[pair.confirmKey] === true;
        patch[pair.timeKey] = next ? now : null;
        patch[pair.adminKey] = next ? adminName : "";
      }
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

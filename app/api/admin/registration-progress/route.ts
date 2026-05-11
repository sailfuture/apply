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
 * Section-verify pairs — four columns per section: the bool, the
 * audit time, the audit admin name, and the matching parent-side
 * completion flag. The bool is what the UI reads/writes; time +
 * admin name are auto-managed here so clients can't hand-write
 * them.
 *
 * `completedKey` cascades on verify: when admin sets the verify
 * bool to `true`, we also flip `isXxx=true` so the parent's
 * sidenav reflects "section done" without the parent having to
 * remember to click Complete. Admin verification is the strongest
 * signal — if admin says it's good, the parent stops being asked
 * to finish it.
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
  /** Optional — when set, flipping the verify bool to `true` also
   *  flips this parent-completion bool to `true` (admin verify
   *  overrides parent in-progress state). Sections without a
   *  matching parent-completion column (e.g. emergency contacts,
   *  which is family-evergreen) leave this `null` and skip the
   *  cascade. */
  completedKey: keyof XanoStudentRegistrationProgress | null;
}> = [
  {
    confirmKey: "tuition_admin_confirm",
    timeKey: "tuition_admin_confirm_time",
    adminKey: "tuition_admin_confirm_admin",
    completedKey: "isTuition",
  },
  {
    confirmKey: "enrollment_admin_confirm",
    timeKey: "enrollment_admin_confirm_time",
    adminKey: "enrollment_admin_confirm_admin",
    completedKey: "isEnrollment",
  },
  {
    confirmKey: "volunteer_admin_confirm",
    timeKey: "volunteer_admin_confirm_time",
    adminKey: "volunteer_admin_confirm_admin",
    completedKey: "isVolunteerHours",
  },
  {
    // Emergency contacts — no parent-completion bool to cascade
    // into. Audit pair (time + admin name) still gets stamped, but
    // we leave the family's other state untouched.
    confirmKey: "emergency_contacts_admin_confirm",
    timeKey: "emergency_contacts_admin_confirm_time",
    adminKey: "emergency_contacts_admin_confirm_admin",
    completedKey: null,
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
      "emergency_contacts_admin_confirm",
      // Family-level registration-confirmed latch. The Family
      // Registration Confirmation card on the registration detail
      // page flips this; audit pair below (`registration_confirmed_time`
      // / `registration_confirmed_admin`) is auto-stamped.
      "isRegistrationConfirmed",
      // Archive flag. Set true from the Archive button on the
      // confirmation card; the family drops out of the active
      // Registrations queues without losing any uploaded packet
      // data. Mirrors `is_archived` on the apply-flow progress row.
      "isArchived",
    ];
    const patch: Record<string, unknown> = { last_edited: Date.now() };
    for (const key of ALLOWED) {
      if (key in body) patch[key] = body[key];
    }

    // Auto-stamp the audit pair + cascade to parent-completion
    // for every section-verify bool that appears in the patch.
    //
    // On verify (true):
    //   - time = now, admin = display name
    //   - matching `isXxx` flips to `true` so the parent's
    //     sidenav reflects "section done" — admin's verify
    //     overrides the parent's in-progress state
    //
    // On un-verify (false):
    //   - time = null, admin = ""
    //   - DO NOT touch `isXxx` — un-verifying is "I need to
    //     re-review", not "kick the parent back to editing".
    //     The existing parent-side cascade clears the verify pair
    //     when the parent flips `isXxx=false`, so the two
    //     directions stay coherent.
    const now = Date.now();
    const adminName = admin?.name ?? "";
    for (const pair of SECTION_VERIFY_PAIRS) {
      if (pair.confirmKey in patch) {
        const next = patch[pair.confirmKey] === true;
        patch[pair.timeKey] = next ? now : null;
        patch[pair.adminKey] = next ? adminName : "";
        if (next && pair.completedKey) {
          patch[pair.completedKey] = true;
        }
      }
    }

    // Family-level registration-confirmed audit. Same pattern as the
    // section-verify pairs above, but separate because this isn't a
    // section bool — it's the rollup the Family Registration
    // Confirmation card flips. Confirm → time = now, admin = display
    // name; unconfirm → time = null, admin = "". Clients can't hand-
    // write these — the route owns them.
    if ("isRegistrationConfirmed" in patch) {
      const next = patch.isRegistrationConfirmed === true;
      patch.registration_confirmed_time = next ? now : null;
      patch.registration_confirmed_admin = next ? adminName : "";
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

    // Cascade: when admin confirms the family's registration
    // (`isRegistrationConfirmed` flips true), flip
    // `student.isEnrolled = true` on every active student in the
    // family. That's what gates the Enrolled Students list — a
    // student isn't "enrolled" until admin has confirmed the
    // whole family's registration. Asymmetric on unconfirm: we
    // DO NOT clear `isEnrolled` when admin undoes the family
    // confirmation, because "I need to re-review" isn't the same
    // as "this student is no longer enrolled." Use the Unenroll
    // modal on the detail page for the explicit unenroll path
    // (sets `isEnrolled=false` + `isArchived=true` + reason).
    //
    // Best-effort: failures here are logged but don't fail the
    // primary PATCH. The route already returned success on the
    // progress row above; the cascade is housekeeping.
    if (patch.isRegistrationConfirmed === true) {
      try {
        await cascadeIsEnrolledTrue(familyId, yearId);
      } catch (cascadeErr) {
        console.error(
          "[/api/admin/registration-progress] isEnrolled cascade failed:",
          cascadeErr
        );
      }
    }

    return NextResponse.json(updated);
  } catch (err) {
    return handleAdminError(err);
  }
}

/**
 * Flip `isEnrolled=true` on every non-archived family student WHO
 * HAS AN ACTIVE APPLICATION for the year being confirmed. The
 * year gate is important — a family can carry "orphan" student
 * rows (kids added but never applied this cycle, or kids whose
 * apps are for a different year), and those students shouldn't
 * land in the enrolled cohort just because admin confirmed the
 * family's registration. Previously the cascade swept every
 * student attached to the family, which caused orphans to appear
 * under the enrolled list with no application context.
 *
 * Skipped per-student when:
 *   - The student has no active app for `yearId` (year gate)
 *   - `isArchived === true` (admin-unenrolled)
 *   - `isEnrolled === true` already (no-op write)
 *
 * Writes go through `updateOnAdminGroup` because `isEnrolled`
 * lives on the `2GcBXyoA` admin query alongside the other
 * admin-only student columns (doc confirms, unenrollment audit).
 */
async function cascadeIsEnrolledTrue(
  familyId: number,
  yearId: number
): Promise<void> {
  const [all, apps] = await Promise.all([
    xano.students.getByFamilyId(familyId),
    xano.applications.getByFamilyId(familyId),
  ]);
  // Build a set of student ids that have an active app for the
  // year. Treats `isActive === undefined` as active (legacy rows
  // pre-date the column).
  const studentsWithApp = new Set<number>();
  for (const a of apps) {
    if (Number(a.registration_school_years_id) !== yearId) continue;
    if (a.isActive === false) continue;
    studentsWithApp.add(Number(a.registration_students_id));
  }
  const targets = all.filter(
    (s) =>
      s.isArchived !== true &&
      s.isEnrolled !== true &&
      studentsWithApp.has(s.id)
  );
  await Promise.all(
    targets.map((s) =>
      xano.students.updateOnAdminGroup(s.id, { isEnrolled: true })
    )
  );
}

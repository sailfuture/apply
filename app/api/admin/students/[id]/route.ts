import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import type { XanoStudent } from "@/lib/xano";
import { removeStripeItemsForArchivedStudent } from "@/lib/per-student-billing";

/**
 * Document-confirm pairs — each entry maps the confirm bool to its
 * audit time + audit admin name columns. The bool is what the UI
 * sends; the route stamps time + admin name automatically. Lives
 * outside the handler so the loop reads cleanly.
 *
 * Mirrors the `SECTION_CONFIRM_PAIRS` pattern used by the
 * family-progress / registration-progress routes — bool flips
 * forward → time = now, admin = display name; bool flips back →
 * time = null, admin = "". Clients can't hand-write the audit
 * columns; the route owns them.
 */
const DOC_CONFIRM_PAIRS: Array<{
  confirmKey: keyof XanoStudent;
  timeKey: keyof XanoStudent;
  adminKey: keyof XanoStudent;
}> = [
  {
    confirmKey: "immunization_admin_confirm",
    timeKey: "immunization_admin_confirm_time",
    adminKey: "immunization_admin_confirm_admin",
  },
  {
    confirmKey: "birth_certificate_admin_confirm",
    timeKey: "birth_certificate_admin_confirm_time",
    adminKey: "birth_certificate_admin_confirm_admin",
  },
  {
    confirmKey: "school_health_form_admin_confirm",
    timeKey: "school_health_form_admin_confirm_time",
    adminKey: "school_health_form_admin_confirm_admin",
  },
  {
    confirmKey: "transcripts_admin_confirm",
    timeKey: "transcripts_admin_confirm_time",
    adminKey: "transcripts_admin_confirm_admin",
  },
];

/**
 * Admin-only PATCH for `registration_students`.
 *
 * Three admin-side write paths live here:
 *
 *   - Initial-screening NWEA scores + dates — entered after the
 *     student completes testing at the academy. Live on the
 *     student row (not the per-year application) so re-enrolling
 *     students keep their score history.
 *   - Per-document admin confirms for the four required documents
 *     (immunization forms, birth certificate, school health form,
 *     transcripts). Bool flips trigger an auto-stamped audit pair
 *     so the registration packet's Documents-to-Review surface can
 *     record who confirmed each document and when.
 *   - Unenrollment audit — `isArchived` + `unenrollment_reason` +
 *     `unenrollment_date` + `unenrollment_notes`. Captured by the
 *     Unenroll modal on the enrolled student detail page. Lives on
 *     the student row so the audit follows the student across
 *     re-enrollment attempts in future years.
 *
 * The `is_verified` flag on the student row was briefly written by
 * this route too, but admin verification was moved back to the
 * per-packet `registrationConfirmed` flag (with audit pair
 * `registration_confirmed_admin_time` /
 * `is_registration_admin_confirm_admin`). Use
 * `/api/admin/student-registration/[id]` for the verify toggle now;
 * that route auto-stamps the packet's audit pair.
 *
 * Parents never write to these columns; their /api/students/[id]
 * route excludes the admin-only fields from its allowlist.
 *
 * Writes that include any of the doc-confirm bools are routed
 * through the `2GcBXyoA` API group (via
 * `xano.students.updateOnAdminGroup`) because those columns were
 * added against that group's query — the default group's CRUD
 * doesn't expose them yet. NWEA-only writes still use the default
 * `update()` since those columns predate the group split.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { admin } = await requireAdmin();
    const { id: idParam } = await params;
    const id = Number(idParam);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json(
        { error: "Invalid student id" },
        { status: 400 }
      );
    }

    const body = await req.json();

    // Admin-only allowlist — we deliberately don't accept the
    // student bio fields (first_name, dob, etc.) here; those belong
    // on the parent flow's `/api/students/[id]`. Editing bio data
    // through admin is a separate workflow and would need its own
    // route.
    const ALLOWED: Array<keyof XanoStudent> = [
      // Bio fields — admin can correct a typo or a misentered DOB
      // directly from the student affordances on the family
      // detail / enrolled detail surfaces. Parents can also write
      // these via /api/students/[id], but admin needs the same
      // power to fix records on their behalf (paper apps
      // transcribed by staff, mid-cycle corrections, etc.).
      "first_name",
      "last_name",
      "date_of_birth",
      "gender",
      "ethnicity",
      "initial_screening_nwea_math",
      "initial_screening_nwea_reading",
      "initial_screening_nwea_math_date",
      "initial_screening_nwea_reading_date",
      "immunization_admin_confirm",
      "birth_certificate_admin_confirm",
      "school_health_form_admin_confirm",
      "transcripts_admin_confirm",
      // Evergreen document arrays — live on the student row (not
      // the per-year packet) so they follow the student across
      // re-enrollment. Admin uploads files on the enrolled student
      // detail page; each value is a Xano file metadata array
      // (`[{ path, url, mime, size, name, ... }, ...]`). The route
      // doesn't validate the inner shape — Xano's `/upload/attachment`
      // returns the canonical blob and we just pass it through. An
      // explicit upload step still owns the actual bytes; this
      // allowlist just lets admin persist the metadata array back
      // onto the row after an upload (or after removing a file).
      "birth_certificate",
      "school_health_form",
      "transcripts",
      "immunization_forms",
      "iep",
      "ssn_card",
      "passport",
      "student_state_id",
      // Unenrollment audit — flipped by the Unenroll affordance
      // on the enrolled student detail page. Captures the
      // archive flag, free-text reason, effective date, and any
      // additional notes in one atomic PATCH. Lives on the
      // student row (not the per-year packet) so the audit
      // follows the student across re-enrollment attempts.
      "isArchived",
      "unenrollment_reason",
      "unenrollment_date",
      "unenrollment_notes",
      // Enrollment gate for the Enrolled Students list. Cascaded
      // true from the registration-progress route when admin
      // confirms the family's registration; cleared back to false
      // by the Unenroll modal alongside `isArchived=true`. Admin
      // can also flip this directly from this route for one-off
      // corrections.
      "isEnrolled",
    ];
    const patch: Record<string, unknown> = {};
    for (const key of ALLOWED) {
      if (key in body) patch[key] = body[key];
    }

    // Auto-stamp the audit pair for every doc-confirm bool in the
    // patch. Confirm → time = now, admin = display name; un-confirm
    // → time = null, admin = "". Matches the audit pattern on
    // family-progress / registration-progress.
    const now = Date.now();
    const adminName = admin?.name ?? "";
    let touchesAdminGroupFields = false;
    for (const pair of DOC_CONFIRM_PAIRS) {
      if (pair.confirmKey in patch) {
        touchesAdminGroupFields = true;
        const next = patch[pair.confirmKey] === true;
        patch[pair.timeKey] = next ? now : null;
        patch[pair.adminKey] = next ? adminName : "";
      }
    }
    // Unenrollment + enrollment-gate columns also live on the
    // `2GcBXyoA` admin query — same group as the doc-confirms —
    // so any patch that touches them needs to route through that
    // endpoint too.
    if (
      "isArchived" in patch ||
      "unenrollment_reason" in patch ||
      "unenrollment_date" in patch ||
      "unenrollment_notes" in patch ||
      "isEnrolled" in patch
    ) {
      touchesAdminGroupFields = true;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json(
        { error: "No editable fields in body" },
        { status: 400 }
      );
    }

    // Bump `last_edited_time` on every write so the enrolled
    // detail page's "Student edited 4d ago" caption stays
    // current and the Registration Packet card's last-edited
    // sub-text reflects what just changed. Added after the
    // empty-patch check so a no-op body still 400s rather than
    // logging a meaningless timestamp bump.
    (patch as Record<string, unknown>).last_edited_time = now;

    // Snapshot prior `isArchived` so we can detect a false → true
    // transition AFTER the write lands and trigger the Stripe-item
    // cleanup cascade below. Best-effort lookup — if the prior read
    // fails we skip the cascade rather than guess; admin can repeat
    // the archive action to retry.
    let priorIsArchived: boolean | undefined;
    if ("isArchived" in patch) {
      try {
        const prior = await xano.students.getById(id);
        priorIsArchived = prior.isArchived === true;
      } catch (err) {
        console.warn(
          `[/api/admin/students/${id}] couldn't read prior isArchived — skipping Stripe cascade guard:`,
          err
        );
      }
    }

    // Route through the admin API group when any admin-only
    // column is in the patch — those columns were added against
    // the `2GcBXyoA` query and aren't on the default group's CRUD
    // surface. Pure NWEA patches stay on the default group.
    const updated = touchesAdminGroupFields
      ? await xano.students.updateOnAdminGroup(id, patch)
      : await xano.students.update(id, patch);

    // On `isArchived` false → true: pull every active Stripe
    // SubscriptionItem the student is on. Walks every packet for
    // the student (across all years) and removes any items with a
    // live `stripe_subscription_item_id`. If a removal empties the
    // parent subscription, Stripe cancels it at period end via the
    // helper. Best-effort — failures log but don't fail the admin's
    // archive (the student row already flipped).
    if (patch.isArchived === true && priorIsArchived !== true) {
      removeStripeItemsForArchivedStudent(id).catch((err) => {
        console.error(
          `[/api/admin/students/${id}] Stripe item cleanup failed:`,
          err
        );
      });
    }

    return NextResponse.json(updated);
  } catch (err) {
    return handleAdminError(err);
  }
}

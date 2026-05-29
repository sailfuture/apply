import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import { sendNotAcceptedEmail } from "@/lib/emails/triggers";

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
    const { admin } = await requireAdmin();
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
      "sufs_award_amount",
      "confirmed_scholarship",
      "is_bus_transportation",
      "bus_stop",
      "transportation_cost",
      "test_scores",
      "nwea_testing_complete",
      "nwea_testing_scheduled",
      // NWEA admin RIT scores + dates moved off the application row
      // onto `registration_students` — they're per-student permanent
      // data, not per-year. Use `/api/admin/students/[id]` to PATCH
      // those instead.
      "last_grade_completed",
      "current_grade",
      "isSubmitted",
      "isOffered",
      "isAccepted",
      "isDenied",
      "isActive",
      "opportunity_scholarship_award_amount",
      // Per-student billing columns mirroring the packet's six
      // derived values. Pre-acceptance edits land here directly
      // (the `/by-student` route auto-routes to whichever row
      // exists); the acceptance cascade copies these onto the
      // packet at flip time.
      "tuition_total",
      "opportunity_award_amount",
      "annual_fee",
      "sufs_amount",
      "tuition_sub_total",
      "monthly_amount",
      "remaining_opportunity_amount",
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

    // Auto-stamp the per-student SUFS confirm audit pair whenever
    // `confirmed_scholarship` is in the patch. Confirming → time =
    // Date.now(), admin = display name; un-confirming → time = null,
    // admin = "". Mirrors the audit pattern on the family-progress
    // section confirms — clients can't hand-write `confirmed_scholarship_time`
    // or `confirmed_scholarship_admin`, the route owns them.
    if ("confirmed_scholarship" in patch) {
      const next = patch.confirmed_scholarship === true;
      patch.confirmed_scholarship_time = next ? Date.now() : null;
      patch.confirmed_scholarship_admin = next ? admin?.name ?? "" : "";
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json(
        { error: "No editable fields in body" },
        { status: 400 }
      );
    }

    // Snapshot pre-patch state for the denial-email transition guard
    // below AND the acceptance cascade. Loaded when the patch touches
    // either `isDenied` or `isAccepted`. Best-effort: if the read
    // fails the guards are skipped — better to silently miss one
    // notification than fail the admin's PATCH.
    let priorIsDenied: boolean | undefined;
    let priorIsAccepted: boolean | undefined;
    if ("isDenied" in patch || "isAccepted" in patch) {
      try {
        const prior = await xano.applications.getById(id);
        priorIsDenied = prior.isDenied;
        priorIsAccepted = prior.isAccepted;
      } catch (err) {
        console.warn(
          `[/api/admin/applications/${id}] couldn't read prior state — skipping transition guards:`,
          err
        );
      }
    }

    const updated = await xano.applications.update(id, patch);

    // On acceptance (isAccepted false → true): ensure a
    // `registration_student_registration` packet exists for this
    // (student, year) so the parent's post-acceptance registration
    // paperwork has a home to write to. Billing math lives on the
    // application row (single source of truth), so the packet
    // doesn't need any column copies — just needs to exist.
    // Best-effort — log and continue if anything fails (admin's
    // accept already succeeded).
    if (patch.isAccepted === true && priorIsAccepted !== true) {
      try {
        const studentId = Number(updated.registration_students_id);
        const yearId = Number(updated.registration_school_years_id);
        if (
          Number.isFinite(studentId) &&
          studentId > 0 &&
          Number.isFinite(yearId) &&
          yearId > 0
        ) {
          await xano.studentRegistration.resolve(studentId, yearId);
        }
      } catch (err) {
        console.error(
          `[/api/admin/applications/${id}] failed to ensure packet on acceptance:`,
          err
        );
      }
    }

    // Email 8: admin denied this application. Per-application
    // rather than family-level — the family might have other
    // students still in flight, and the message should reference
    // the specific denied student by name. Transition guard prevents
    // re-saves (admin clicks Deny twice, or PATCHes another field
    // while already denied) from re-firing the email. Best-effort
    // send.
    if (patch.isDenied === true && priorIsDenied !== true) {
      sendNotAcceptedEmail(id).catch((err) => {
        console.error(
          `[/api/admin/applications/${id}] sendNotAcceptedEmail failed:`,
          err
        );
      });
    }

    return NextResponse.json(updated);
  } catch (err) {
    return handleAdminError(err);
  }
}

/**
 * Admin-only DELETE for one `registration_application` row. Hard-removes
 * the application — used by the residential-family flow to delete a
 * specific student's mid-year registration from the application card.
 * The student record + any registration packet are left intact (the
 * registration detail page only surfaces packets for active apps, so a
 * deleted app's packet drops out of view).
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const { id: idParam } = await params;
    const id = Number(idParam);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    await xano.applications.delete(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleAdminError(err);
  }
}

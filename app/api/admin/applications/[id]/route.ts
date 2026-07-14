import { NextRequest, NextResponse, after } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import { sendNotAcceptedEmail } from "@/lib/emails/triggers";
import {
  findPacketForApplication,
  removeStripeItemForApplication,
  syncStripeForApplication,
} from "@/lib/per-student-billing";
import { reconcileFamilySubscriptionItems } from "@/lib/billing";
import { sendBillingAlert } from "@/lib/billing-alerts";

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

    // Billing-column sanity: `monthly_amount` feeds Stripe directly
    // (cents = round(×100)), so a negative or non-finite value must
    // never land on the row.
    if ("monthly_amount" in patch) {
      const m = patch.monthly_amount;
      const valid =
        m === null || (typeof m === "number" && Number.isFinite(m) && m >= 0);
      if (!valid) {
        return NextResponse.json(
          { error: "monthly_amount must be a non-negative number" },
          { status: 400 }
        );
      }
    }

    // Snapshot pre-patch state for the denial-email transition guard
    // below, the acceptance cascade, AND the isActive billing
    // cascades. Best-effort: if the read fails the guards are skipped
    // — better to silently miss one notification than fail the
    // admin's PATCH.
    let priorIsDenied: boolean | undefined;
    let priorIsAccepted: boolean | undefined;
    let priorIsActive: boolean | undefined;
    if ("isDenied" in patch || "isAccepted" in patch || "isActive" in patch) {
      try {
        const prior = await xano.applications.getById(id);
        priorIsDenied = prior.isDenied;
        priorIsAccepted = prior.isAccepted;
        priorIsActive = prior.isActive !== false;
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

    // Billing cascades — keep Stripe in lockstep with the row the
    // admin just edited. Each is alert-on-failure rather than
    // fail-the-PATCH (the Xano write already landed); the alert is
    // what keeps a Stripe hiccup from becoming silent drift between
    // what admin sees and what the family is billed.
    const familyIdNum = Number(updated.registration_families_id);
    const yearIdNum = Number(updated.registration_school_years_id);

    // Deactivated (isActive true → false): take the student's item off
    // the live subscription — every in-app total drops them, so Stripe
    // must too or the family gets over-billed invisibly.
    if (patch.isActive === false && priorIsActive === true) {
      try {
        await removeStripeItemForApplication(updated);
      } catch (err) {
        console.error(
          `[/api/admin/applications/${id}] Stripe item removal after deactivate failed:`,
          err
        );
        await sendBillingAlert(
          `Stripe item NOT removed after application deactivate (family #${familyIdNum})`,
          [
            `Application #${id} (student #${updated.registration_students_id}, family #${familyIdNum}, year #${yearIdNum}) was deactivated, but removing the student's Stripe subscription item failed.`,
            `Stripe is still billing this student. Remove the item from the family's subscription in the Stripe Dashboard, or re-toggle the application to retry.`,
            `Error: ${err instanceof Error ? err.message : String(err)}`,
          ]
        );
      }
    }

    // Reactivated (false → true): put them back on the subscription.
    // Runs via `after()` so the response stays fast but serverless
    // can't freeze the instance before the reconcile finishes.
    if (patch.isActive === true && priorIsActive === false) {
      after(async () => {
        try {
          await reconcileFamilySubscriptionItems(familyIdNum, yearIdNum);
        } catch (err) {
          console.error(
            `[/api/admin/applications/${id}] reconcile after reactivate failed:`,
            err
          );
          await sendBillingAlert(
            `Student NOT re-added to billing after reactivate (family #${familyIdNum})`,
            [
              `Application #${id} was reactivated but the billing reconcile failed — the student may not be billed.`,
              `Open the family's admin billing card and click "Start Monthly Billing" to reconcile.`,
              `Error: ${err instanceof Error ? err.message : String(err)}`,
            ]
          );
        }
      });
    }

    // Re-price: a raw `monthly_amount` edit through this allowlist
    // must reach the live Stripe item, or every view shows the new
    // number while Stripe keeps invoicing the old one.
    if ("monthly_amount" in patch && updated.isActive !== false) {
      try {
        const packet = await findPacketForApplication(updated);
        await syncStripeForApplication(updated, packet);
      } catch (err) {
        console.error(
          `[/api/admin/applications/${id}] Stripe re-price after monthly_amount edit failed:`,
          err
        );
        await sendBillingAlert(
          `Stripe re-price failed for family #${familyIdNum}`,
          [
            `Application #${id} (student #${updated.registration_students_id}) had monthly_amount changed to ${String(updated.monthly_amount)}, but the Stripe re-price failed — the family is still being invoiced at the OLD amount.`,
            `Retry by re-saving the amount, or update the subscription item in the Stripe Dashboard.`,
            `Error: ${err instanceof Error ? err.message : String(err)}`,
          ]
        );
      }
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

    // Billing cleanup BEFORE the row is destroyed, and BLOCKING: the
    // application row is what ties the student to their live Stripe
    // item — delete it first and a failed cleanup becomes permanent
    // silent over-billing with no local handle left to fix it. If the
    // student is on a live subscription and Stripe can't drop the
    // item right now, refuse the delete so admin can retry.
    let app;
    try {
      app = await xano.applications.getById(id);
    } catch {
      app = null; // row already gone → nothing to clean up
    }
    if (app) {
      try {
        await removeStripeItemForApplication(app);
      } catch (err) {
        console.error(
          `[/api/admin/applications/${id}] refusing delete — Stripe item cleanup failed:`,
          err
        );
        return NextResponse.json(
          {
            error:
              "This student is on the family's live billing subscription and removing their Stripe line failed. Nothing was deleted — try again, or remove the item in the Stripe Dashboard first.",
          },
          { status: 502 }
        );
      }
    }

    await xano.applications.delete(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleAdminError(err);
  }
}

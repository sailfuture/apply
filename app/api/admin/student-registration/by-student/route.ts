import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import { sendBillingAlert } from "@/lib/billing-alerts";
import {
  derivePacketBillingValues,
  syncStripeForApplication,
} from "@/lib/per-student-billing";

/**
 * Per-student billing PATCH keyed on `(studentId, yearId)` rather
 * than the application's primary key. The Scholarship Determination
 * card doesn't have the application id in scope — it iterates over
 * students + per-year applications — so this endpoint takes the
 * lookup keys the card already knows and does the application
 * resolve server-side.
 *
 *   POST /api/admin/student-registration/by-student
 *   Body: {
 *     studentId: number,
 *     yearId: number,
 *     sufsAwardAmount?: number,
 *     remainingOpportunityAmount?: number,
 *   }
 *
 * The route reads the application row's existing values for any
 * input the caller didn't send, then runs the math through
 * `derivePacketBillingValues` so the seven billing columns always
 * land in a consistent state — no partial updates that leave the
 * derived columns out of sync with the inputs.
 *
 * Source of truth is the application row. The packet only carries
 * `stripe_subscription_item_id` (the Stripe-side link) so when
 * billing is live we still re-price the Stripe item to match the
 * new amount.
 *
 * Returns the updated application row. 404 when no application
 * exists for the (student, year) pair.
 */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = await req.json();

    const studentId = Number(body?.studentId);
    const yearId = Number(body?.yearId);
    if (!Number.isFinite(studentId) || studentId <= 0) {
      return NextResponse.json(
        { error: "studentId is required" },
        { status: 400 }
      );
    }
    if (!Number.isFinite(yearId) || yearId <= 0) {
      return NextResponse.json(
        { error: "yearId is required" },
        { status: 400 }
      );
    }

    // Optional numeric inputs. We distinguish "explicitly null"
    // (clear the column / treat as 0 in the math) from "undefined"
    // (don't change — fall back to the application row's existing
    // value).
    const hasSufs = Object.prototype.hasOwnProperty.call(
      body,
      "sufsAwardAmount"
    );
    const hasRemaining = Object.prototype.hasOwnProperty.call(
      body,
      "remainingOpportunityAmount"
    );
    const sufsInput: number | null | undefined = hasSufs
      ? body.sufsAwardAmount === null
        ? null
        : Number(body.sufsAwardAmount)
      : undefined;
    const remainingInput: number | null | undefined = hasRemaining
      ? body.remainingOpportunityAmount === null
        ? null
        : Number(body.remainingOpportunityAmount)
      : undefined;
    if (
      hasSufs &&
      sufsInput !== null &&
      !Number.isFinite(sufsInput as number)
    ) {
      return NextResponse.json(
        { error: "sufsAwardAmount must be a number or null" },
        { status: 400 }
      );
    }
    if (
      hasRemaining &&
      remainingInput !== null &&
      !Number.isFinite(remainingInput as number)
    ) {
      return NextResponse.json(
        {
          error:
            "remainingOpportunityAmount must be a number or null",
        },
        { status: 400 }
      );
    }

    // Resolve the application row and the school year in parallel.
    // The packet is only needed when billing is live (for the
    // Stripe item id), so we fetch it inside the stripe-sync block
    // below rather than always.
    const [app, schoolYear] = await Promise.all([
      xano.applications.getByStudentAndYear(studentId, yearId),
      xano.schoolYears.getById(yearId),
    ]);
    if (!app) {
      return NextResponse.json(
        {
          error: `No application found for student ${studentId} in year ${yearId}.`,
        },
        { status: 404 }
      );
    }

    const sufsAwardAmount =
      sufsInput === undefined ? (app.sufs_amount ?? 0) : (sufsInput ?? 0);
    // "Remaining Amount Family Pays" reads/writes the dedicated
    // `remaining_opportunity_amount` column. When the caller doesn't
    // override, fall back to the stored value so partial updates
    // don't blow away the persisted input.
    const remainingOpportunityAmount =
      remainingInput === undefined
        ? app.remaining_opportunity_amount ?? 0
        : (remainingInput ?? 0);

    const billingValues = derivePacketBillingValues({
      schoolYearTuition: schoolYear?.tuition ?? 0,
      schoolYearAnnualFees: schoolYear?.annual_fees ?? null,
      sufsAwardAmount,
      remainingOpportunityAmount,
      // Don't pass the existing per-row annual_fee as an override
      // — that would lock the row to its prior value and ignore
      // year-level policy updates. Falls through to school year's
      // `annual_fees` inside `derivePacketBillingValues`.
      annualFee: null,
    });

    const updatedApp = await xano.applications.update(app.id, billingValues);

    // Re-price the Stripe SubscriptionItem when billing is live.
    // The packet carries `stripe_subscription_item_id`; we fetch it
    // and pair with the just-updated application's
    // `monthly_amount`. The Xano write above already landed, so a
    // Stripe failure doesn't fail the request — but it CANNOT pass
    // silently either: until the re-price lands, every admin/parent
    // surface shows the new amount while Stripe keeps invoicing the
    // old one. Alert staff so the drift gets fixed.
    try {
      const yearPackets = await xano.studentRegistration.getByYear(yearId);
      const packet =
        yearPackets.find(
          (p) => Number(p.registration_students_id) === studentId
        ) ?? null;
      await syncStripeForApplication(updatedApp, packet);
    } catch (err) {
      console.error(
        "[/api/admin/student-registration/by-student] Stripe re-price failed:",
        err
      );
      await sendBillingAlert(
        `Stripe re-price failed for student #${studentId}`,
        [
          `Tuition for student #${studentId} (year #${yearId}) was updated to $${billingValues.monthly_amount}/mo in the app, but the Stripe re-price failed — the family is still being invoiced at the OLD amount.`,
          `Re-save the amount on the Scholarship Determination card to retry, or update the subscription item in the Stripe Dashboard.`,
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        ]
      );
    }

    return NextResponse.json(updatedApp);
  } catch (err) {
    return handleAdminError(err);
  }
}

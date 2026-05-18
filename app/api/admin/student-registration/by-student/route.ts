import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import {
  derivePacketBillingValues,
  syncStripeForPacket,
} from "@/lib/per-student-billing";

/**
 * Per-student billing PATCH keyed on `(studentId, yearId)` rather
 * than the packet's primary key. The Scholarship Determination card
 * doesn't have the packet id in scope — it iterates over students
 * + per-year applications — so this endpoint takes the lookup keys
 * the card already knows and does the packet resolve server-side.
 *
 *   POST /api/admin/student-registration/by-student
 *   Body: {
 *     studentId: number,
 *     yearId: number,
 *     sufsAwardAmount?: number,
 *     opportunityScholarshipRemaining?: number,
 *   }
 *
 * The route reads the existing packet's stored values for any input
 * the caller didn't send, then runs the math through
 * `derivePacketBillingValues` so the six billing columns always
 * land in a consistent state — no partial updates that leave the
 * derived columns out of sync with the inputs.
 *
 * Side effects:
 *   1. PATCHes the matching packet with the six derived columns
 *      (`sufs_amount`, `opportunity_award_amount`, `tuition_total`,
 *      `annual_fee`, `tuition_sub_total`, `monthly_amount`).
 *   2. If the packet has a `stripe_subscription_item_id` (billing
 *      is live), re-prices the Stripe item via
 *      `syncStripeForPacket`. No-ops otherwise.
 *
 * Returns the updated packet. 404 when no packet exists yet for
 * the (student, year) pair — admin should kick off registration
 * first so a packet row exists.
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
    // (don't change — fall back to the packet's existing value).
    const hasSufs = Object.prototype.hasOwnProperty.call(
      body,
      "sufsAwardAmount"
    );
    const hasRemaining = Object.prototype.hasOwnProperty.call(
      body,
      "opportunityScholarshipRemaining"
    );
    const sufsInput: number | null | undefined = hasSufs
      ? body.sufsAwardAmount === null
        ? null
        : Number(body.sufsAwardAmount)
      : undefined;
    const remainingInput: number | null | undefined = hasRemaining
      ? body.opportunityScholarshipRemaining === null
        ? null
        : Number(body.opportunityScholarshipRemaining)
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
            "opportunityScholarshipRemaining must be a number or null",
        },
        { status: 400 }
      );
    }

    // Find the packet for (student, year). We list the year's
    // packets (a small set per year) and filter to this student
    // rather than calling a dedicated lookup endpoint — the
    // existing Xano client already has `getByYear` so reuse it.
    const yearPackets = await xano.studentRegistration.getByYear(yearId);
    const packet = yearPackets.find(
      (p) => Number(p.registration_students_id) === studentId
    );
    if (!packet) {
      return NextResponse.json(
        {
          error: `No registration packet found for student ${studentId} in year ${yearId}.`,
        },
        { status: 404 }
      );
    }

    const schoolYear = await xano.schoolYears.getById(yearId);

    // Resolve the math inputs. For each field the caller didn't
    // send, fall back to the packet's existing stored value so
    // partial updates don't blow away unrelated columns. Then run
    // the canonical deriver so all six columns land consistent.
    const sufsAwardAmount =
      sufsInput === undefined ? (packet.sufs_amount ?? 0) : (sufsInput ?? 0);
    // The "family-paid portion" input maps to the existing per-
    // packet derived value: `tuition_sub_total - annual_fee`.
    // When the caller doesn't override, re-derive from the packet's
    // current `tuition_sub_total` and `annual_fee` so the math
    // round-trips without drift.
    const existingAnnualFee =
      typeof packet.annual_fee === "number" ? packet.annual_fee : null;
    const existingSubTotal =
      typeof packet.tuition_sub_total === "number"
        ? packet.tuition_sub_total
        : null;
    const existingRemaining =
      existingSubTotal !== null && existingAnnualFee !== null
        ? existingSubTotal - existingAnnualFee
        : 0;
    const opportunityScholarshipRemaining =
      remainingInput === undefined
        ? existingRemaining
        : (remainingInput ?? 0);

    const billingValues = derivePacketBillingValues({
      schoolYearTuition: schoolYear?.tuition ?? 0,
      schoolYearAnnualFees: schoolYear?.annual_fees ?? null,
      sufsAwardAmount,
      opportunityScholarshipRemaining,
      // Don't pass the existing per-packet annual_fee as an override
      // — that would lock the packet to its prior value and ignore
      // year-level policy updates. Falls through to school year's
      // `annual_fees` inside `derivePacketBillingValues`.
      annualFee: null,
    });

    const updatedPacket = await xano.studentRegistration.update(
      packet.id,
      billingValues
    );

    // Re-price the Stripe SubscriptionItem when billing is live.
    // No-ops when no item id on the packet. Best-effort — Stripe
    // failure logs but doesn't fail the Xano write.
    try {
      await syncStripeForPacket(updatedPacket);
    } catch (err) {
      console.error(
        "[/api/admin/student-registration/by-student] Stripe re-price failed:",
        err
      );
    }

    return NextResponse.json(updatedPacket);
  } catch (err) {
    return handleAdminError(err);
  }
}

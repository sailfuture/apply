import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";

/**
 * Admin upsert for `registration_families_payment` — one row per
 * (family, year). Used by the Scholarship Determination card to
 * snapshot the final payment amounts at family-approval time, so
 * downstream surfaces (tuition review, billing) can read a single
 * authoritative row instead of recomputing across per-student
 * rows.
 *
 * Distinct from the parent-side `/api/family-payment` route, which
 * is scoped to the authenticated parent's own family. Admin needs
 * to write on behalf of any family, hence the dedicated admin
 * endpoint with `requireAdmin` + an explicit `familyId` in the
 * body.
 *
 * Body:
 *   - `familyId` (required)
 *   - `yearId` (required)
 *   - `monthly_tuition_payment` (required) — the family's monthly
 *     total for the year. Equals `(annual_fee_total + sum of
 *     per-student opportunity_scholarship_award_amount + transport
 *     where applicable) / 12`. SNAP-confirmed families collapse to
 *     `annual_fee_total / 12` since their tuition + transport are
 *     auto-rebated by the Opportunity Scholarship.
 *   - `annual_fee_total` (optional) — total admin/annual fees for
 *     the year, typically `$500 × N students`. Snapshotted alongside
 *     the monthly figure so downstream callers can break the
 *     receipt back into its line items without re-deriving from per
 *     student rows.
 *   - `transportation_total` (optional) — total transportation the
 *     family owes for the year. Pass `null` (explicit) for SNAP
 *     families to indicate transport is waived; pass a number for
 *     non-SNAP families (sum of per-student transport for students
 *     whose `is_bus_transportation=true`). Pass `0` (or omit) when
 *     no students elected bus transport but the family is not SNAP.
 *   - `isFamilyAccepted` (optional, defaults to true) — usually
 *     called from the Approve flow so this is `true`; left
 *     pluggable for future surfaces that snapshot before approval.
 *
 * Strategy:
 *   - If a row already exists for (family, year), PATCH the
 *     amount fields + `isFamilyAccepted`.
 *   - Otherwise CREATE a row with the captured amounts.
 *
 * Other columns on the row (signature, enrollment_agreement_*,
 * tuition_reviewed, etc.) are owned by downstream surfaces and
 * stay at their defaults on first write.
 */
export async function POST(req: NextRequest) {
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

    const monthly = Number(body?.monthly_tuition_payment);
    if (!Number.isFinite(monthly)) {
      return NextResponse.json(
        { error: "monthly_tuition_payment is required" },
        { status: 400 }
      );
    }

    // Optional snapshots — null means "explicitly null" (e.g.
    // SNAP transport waiver), undefined means "don't change". We
    // distinguish the two so passing `transportation_total: null`
    // from the client clears the column rather than being silently
    // dropped.
    const hasAnnualFeeTotal =
      body && Object.prototype.hasOwnProperty.call(body, "annual_fee_total");
    const annualFeeTotal: number | null | undefined = hasAnnualFeeTotal
      ? body.annual_fee_total === null
        ? null
        : Number(body.annual_fee_total)
      : undefined;
    if (
      hasAnnualFeeTotal &&
      annualFeeTotal !== null &&
      !Number.isFinite(annualFeeTotal as number)
    ) {
      return NextResponse.json(
        { error: "annual_fee_total must be a number or null" },
        { status: 400 }
      );
    }

    const hasTransportTotal =
      body &&
      Object.prototype.hasOwnProperty.call(body, "transportation_total");
    const transportationTotal: number | null | undefined = hasTransportTotal
      ? body.transportation_total === null
        ? null
        : Number(body.transportation_total)
      : undefined;
    if (
      hasTransportTotal &&
      transportationTotal !== null &&
      !Number.isFinite(transportationTotal as number)
    ) {
      return NextResponse.json(
        { error: "transportation_total must be a number or null" },
        { status: 400 }
      );
    }

    const isFamilyAccepted =
      typeof body?.isFamilyAccepted === "boolean"
        ? body.isFamilyAccepted
        : true;

    const existing = await xano.familyPayments.getByFamilyAndYear(
      familyId,
      yearId
    );
    if (existing) {
      const patch: Record<string, unknown> = {
        monthly_tuition_payment: monthly,
        isFamilyAccepted,
      };
      if (annualFeeTotal !== undefined) {
        patch.annual_fee_total = annualFeeTotal;
      }
      if (transportationTotal !== undefined) {
        patch.transportation_total = transportationTotal;
      }
      const updated = await xano.familyPayments.update(existing.id, patch);
      return NextResponse.json(updated);
    }

    const created = await xano.familyPayments.create({
      registration_families_id: familyId,
      registration_school_years_id: yearId,
      isFamilyAccepted,
      signature: {},
      name: "",
      signature_data: null,
      registration_fee_waiver_id: null,
      monthly_tuition_payment: monthly,
      annual_fee_total:
        annualFeeTotal === undefined ? null : annualFeeTotal,
      transportation_total:
        transportationTotal === undefined ? null : transportationTotal,
      tuition_reviewed: false,
      tuition_reviewed_at: null,
      tuition_reviewed_by: "",
      enrollment_agreement_pandadoc_id: "",
      enrollment_agreement_status: "",
      enrollment_agreement_sent_at: null,
      enrollment_agreement_pdf_url: "",
      is_enrollment_agreement_signed: false,
    });
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    return handleAdminError(err);
  }
}

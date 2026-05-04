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
 *     total for the year, divided by 12 across all student
 *     applications. Includes tuition + transport + admin fee on
 *     the matrix path; SNAP path uses (tuition + admin fee − SUFS)
 *     with transport waived.
 *   - `isFamilyAccepted` (optional, defaults to true) — usually
 *     called from the Approve flow so this is `true`; left
 *     pluggable for future surfaces that snapshot before approval.
 *
 * Strategy:
 *   - If a row already exists for (family, year), PATCH the
 *     monthly amount + `isFamilyAccepted`.
 *   - Otherwise CREATE a row with the captured amount.
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

    const isFamilyAccepted =
      typeof body?.isFamilyAccepted === "boolean"
        ? body.isFamilyAccepted
        : true;

    const existing = await xano.familyPayments.getByFamilyAndYear(
      familyId,
      yearId
    );
    if (existing) {
      const updated = await xano.familyPayments.update(existing.id, {
        monthly_tuition_payment: monthly,
        isFamilyAccepted,
      });
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

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
 *     families to indicate transport is waived. **Omit otherwise**
 *     — the route derives the total server-side by summing
 *     `transportation_cost` across every active application for
 *     the (family, year). Passing a number override is still
 *     accepted for backwards-compat but discouraged; the
 *     server-derived sum is authoritative because it can't drift
 *     from a stale client cache.
 *   - `sufs_total` (optional) — total SUFS scholarship dollars
 *     awarded across every active student in the family for the
 *     year. Sum of each application's `sufs_award_amount` (admin
 *     captures these per-student during the Scholarship
 *     Determination flow). Pass `null` when the family has no
 *     SUFS scholarship on file; pass a number for the total.
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
/**
 * Admin GET — read-only fetch of the family-payment snapshot for a
 * given (family, year). Returns `null` when no row has been
 * snapshotted yet (e.g. pre-acceptance families). Used by the
 * print/export view to render the final receipt page without
 * triggering the upsert side effect.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const familyId = Number(req.nextUrl.searchParams.get("familyId"));
    const yearId = Number(req.nextUrl.searchParams.get("yearId"));
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
    const row = await xano.familyPayments.getByFamilyAndYear(
      familyId,
      yearId
    );
    return NextResponse.json(row);
  } catch (err) {
    return handleAdminError(err);
  }
}

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

    // Transportation total resolution. Order of precedence:
    //   1. If body explicitly passes `null` → write null (SNAP families
    //      have transport waived; route preserves the explicit null so
    //      downstream surfaces render "N/A" rather than "$0").
    //   2. If body passes a number → use it (legacy client path; kept
    //      so existing callers don't break).
    //   3. Otherwise → server-derives the total by summing
    //      `transportation_cost` across every active application on
    //      this (family, year). The server is the source of truth so
    //      admin can't snapshot a stale page-computed total — if the
    //      Accept click happens with a stale SWR cache, the row still
    //      lands with the current per-student amounts.
    const hasTransportTotal =
      body &&
      Object.prototype.hasOwnProperty.call(body, "transportation_total");
    let transportationTotal: number | null | undefined = hasTransportTotal
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
    if (transportationTotal === undefined) {
      // Server-side derivation. Pull every application for this
      // family, narrow to (yearId, isActive!==false, is_bus_transportation),
      // then sum each app's `transportation_cost`. Apps without a
      // `transportation_cost` value contribute 0 — the per-student
      // edit form is what populates that column, so a missing value
      // means admin hasn't priced the transport for that student
      // yet and we don't want to silently assume a default.
      const apps = await xano.applications.getByFamilyId(familyId);
      const activeApps = apps.filter(
        (a) =>
          a.registration_school_years_id === yearId &&
          (a as { isActive?: boolean }).isActive !== false
      );
      transportationTotal = activeApps.reduce((acc, a) => {
        if (a.is_bus_transportation !== true) return acc;
        const cost =
          typeof a.transportation_cost === "number" ? a.transportation_cost : 0;
        return acc + cost;
      }, 0);
    }

    // `sufs_total` follows the same null-aware pattern as the other
    // optional totals — the Approve flow snapshots the sum of every
    // active student's `sufs_award_amount` onto this column so the
    // billing surfaces don't have to re-sum per-student rows. Treat
    // explicit `null` as "unknown" rather than coercing to 0; that
    // way a SNAP family (no SUFS) reads as N/A instead of "no
    // scholarship awarded."
    const hasSufsTotal =
      body && Object.prototype.hasOwnProperty.call(body, "sufs_total");
    const sufsTotal: number | null | undefined = hasSufsTotal
      ? body.sufs_total === null
        ? null
        : Number(body.sufs_total)
      : undefined;
    if (
      hasSufsTotal &&
      sufsTotal !== null &&
      !Number.isFinite(sufsTotal as number)
    ) {
      return NextResponse.json(
        { error: "sufs_total must be a number or null" },
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
      if (sufsTotal !== undefined) {
        patch.sufs_total = sufsTotal;
      }
      const updated = await xano.familyPayments.update(existing.id, patch);
      return NextResponse.json(updated);
    }

    // Create payload only carries columns that still exist on the
    // live Xano schema. The retired `registration_fee_waiver_id`
    // and `tuition_reviewed` triplet (`tuition_reviewed`,
    // `tuition_reviewed_at`, `tuition_reviewed_by`) used to be
    // here but were dropped from the table — sending them would
    // cause Xano to reject the whole create on unknown columns,
    // which is why first-time approves were silently failing to
    // land a row.
    const created = await xano.familyPayments.create({
      registration_families_id: familyId,
      registration_school_years_id: yearId,
      isFamilyAccepted,
      signature: {},
      name: "",
      signature_data: null,
      monthly_tuition_payment: monthly,
      annual_fee_total:
        annualFeeTotal === undefined ? null : annualFeeTotal,
      transportation_total:
        transportationTotal === undefined ? null : transportationTotal,
      sufs_total: sufsTotal === undefined ? null : sufsTotal,
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

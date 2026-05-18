import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";

/**
 * Admin upsert for `registration_families_payment` — one row per
 * (family, year). Used by the Approve flow to flip the family-level
 * acceptance latch and snapshot family-scoped transportation_total.
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
 *   - `transportation_total` (optional) — total transportation the
 *     family owes for the year. Pass `null` (explicit) for SNAP
 *     families to indicate transport is waived. **Omit otherwise**
 *     — the route derives the total server-side by summing
 *     `transportation_cost` across every active application for
 *     the (family, year). Server-derived sum is authoritative
 *     because it can't drift from a stale client cache.
 *   - `isFamilyAccepted` (optional, defaults to true) — usually
 *     called from the Approve flow so this is `true`.
 *
 * Per-student tuition amounts moved to
 * `registration_student_registration` (one packet per student) and
 * the family-level rollups (`monthly_tuition_payment` /
 * `annual_fee_total` / `sufs_total`) were retired. The Approve flow
 * now writes per-student values onto each packet row directly and
 * leaves this route to handle only the family-scoped fields
 * (acceptance latch + transport).
 *
 * Strategy:
 *   - If a row already exists for (family, year), PATCH.
 *   - Otherwise CREATE.
 *
 * Other columns on the row (signature, enrollment_agreement_*,
 * etc.) are owned by downstream surfaces and stay at their defaults
 * on first write.
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

    const isFamilyAccepted =
      typeof body?.isFamilyAccepted === "boolean"
        ? body.isFamilyAccepted
        : true;

    const existing = await xano.familyPayments.getByFamilyAndYear(
      familyId,
      yearId
    );
    if (existing) {
      const patch: Record<string, unknown> = { isFamilyAccepted };
      if (transportationTotal !== undefined) {
        patch.transportation_total = transportationTotal;
      }
      const updated = await xano.familyPayments.update(existing.id, patch);
      return NextResponse.json(updated);
    }

    // Create payload only carries columns that still exist on the
    // live Xano schema. Per-student tuition amounts live on
    // `registration_student_registration` and are written by the
    // Approve flow directly, not through this route.
    const created = await xano.familyPayments.create({
      registration_families_id: familyId,
      registration_school_years_id: yearId,
      isFamilyAccepted,
      signature: {},
      name: "",
      signature_data: null,
      transportation_total:
        transportationTotal === undefined ? null : transportationTotal,
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

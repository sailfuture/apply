import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import type { XanoFamilyPayment } from "@/lib/xano";

/**
 * Admin-only PATCH for one `registration_families_payment` row.
 *
 * Used by the inline editor on the Tuition card (registration
 * detail page) so admin can amend the four amount fields after
 * acceptance without re-running the whole Approve flow. The
 * Approve flow itself still uses the `POST` upsert in the
 * sibling route — that one derives totals server-side from
 * per-student rows. This route is the manual-override path: admin
 * enters the numbers, we trust the input.
 *
 * Allowlist intentionally narrow:
 *   - `monthly_tuition_payment` — what the family pays per month
 *   - `annual_fee_total` — annual admin fee snapshot
 *   - `transportation_total` — transportation portion (null = SNAP
 *     waived)
 *   - `sufs_total` — total SUFS scholarship dollars (null = no
 *     SUFS on file)
 *   - `isFamilyAccepted` — let admin flip the latch if the row
 *     was created out of band
 *
 * Foreign keys (`registration_families_id`,
 * `registration_school_years_id`), signature data, enrollment-
 * agreement state, and `id`/`created_at` are deliberately excluded.
 * Signature + PandaDoc state flow through their own dedicated
 * surfaces; the FKs orphan the row if changed.
 *
 * Null vs undefined semantics on the numeric columns: passing
 * `null` clears the column (SNAP families set transport to null
 * to mark it waived); passing `undefined` (i.e. omitting the
 * key) leaves it alone.
 *
 * URL: `/api/admin/family-payment/[id]` where `[id]` is the
 *   family-payment row's primary key.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const { id: idParam } = await params;
    const id = Number(idParam);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json(
        { error: "Invalid family-payment id" },
        { status: 400 }
      );
    }

    const body = await req.json();
    const patch: Partial<XanoFamilyPayment> = {};

    // Numeric columns — accept either a number or explicit null
    // (clears the column). Reject anything else so a bad client
    // doesn't write garbage into the billing snapshot.
    // Per-student tuition columns moved to `registration_student_registration`
    // (one row per student); the family-level rollups
    // (`monthly_tuition_payment` / `annual_fee_total` / `sufs_total`)
    // were retired and only `transportation_total` remains as a
    // family-scoped numeric.
    const NUMERIC_OR_NULL: Array<
      keyof Pick<XanoFamilyPayment, "transportation_total">
    > = ["transportation_total"];
    for (const key of NUMERIC_OR_NULL) {
      if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
      const raw = body[key];
      if (raw === null) {
        (patch as Record<string, unknown>)[key] = null;
        continue;
      }
      const n = Number(raw);
      if (!Number.isFinite(n)) {
        return NextResponse.json(
          { error: `${key} must be a number or null` },
          { status: 400 }
        );
      }
      (patch as Record<string, unknown>)[key] = n;
    }

    if (typeof body?.isFamilyAccepted === "boolean") {
      patch.isFamilyAccepted = body.isFamilyAccepted;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json(
        { error: "No editable fields in body" },
        { status: 400 }
      );
    }

    const updated = await xano.familyPayments.update(id, patch);
    return NextResponse.json(updated);
  } catch (err) {
    return handleAdminError(err);
  }
}

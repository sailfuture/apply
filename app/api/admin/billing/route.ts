import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";

/**
 * Admin Billing list — one row per family with a Stripe subscription
 * on file for the selected school year. Drives the `/admin/billing`
 * table.
 *
 * Pivot: `registration_families_payment` rows for the year where
 * `stripe_subscription_id` is set. We DON'T hit Stripe API per-row
 * here — that would be N+1 Stripe calls on every page load. Instead
 * we surface the Xano-side state (monthly amount, `isStripeSetup`
 * flag, the existence of the subscription id) and link each row to
 * the family registration detail page, where the Billing card hits
 * Stripe live for the per-family deep dive.
 *
 * Joins:
 *   - `xano.familyPayments.getAllByYear(yearId)` → primary pivot
 *   - `xano.families.getAll()` → display label for the family
 *   - `xano.parents.getAll()` → primary parent name + email
 *
 * Each lookup is wrapped in `Promise.allSettled` so a single Xano
 * hiccup degrades gracefully (empty list rather than 500 on the
 * whole page).
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const yearIdParam = req.nextUrl.searchParams.get("yearId");
    if (!yearIdParam) {
      return NextResponse.json(
        { error: "yearId is required" },
        { status: 400 }
      );
    }
    const yearId = Number(yearIdParam);
    if (!Number.isFinite(yearId) || yearId <= 0) {
      return NextResponse.json(
        { error: "yearId must be a positive number" },
        { status: 400 }
      );
    }

    const [paymentsResult, familiesResult, parentsResult] =
      await Promise.allSettled([
        xano.familyPayments.getAllByYear(yearId),
        xano.families.getAll(),
        xano.parents.getAll(),
      ]);

    if (paymentsResult.status === "rejected") {
      console.error(
        "[/api/admin/billing] failed to load family payments:",
        paymentsResult.reason
      );
    }
    if (familiesResult.status === "rejected") {
      console.error(
        "[/api/admin/billing] failed to load families:",
        familiesResult.reason
      );
    }
    if (parentsResult.status === "rejected") {
      console.error(
        "[/api/admin/billing] failed to load parents:",
        parentsResult.reason
      );
    }

    const payments =
      paymentsResult.status === "fulfilled" ? paymentsResult.value : [];
    const families =
      familiesResult.status === "fulfilled" ? familiesResult.value : [];
    const parents =
      parentsResult.status === "fulfilled" ? parentsResult.value : [];

    const familyById = new Map(families.map((f) => [f.id, f]));
    // Primary parent per family — lowest id wins, matching the
    // convention used by /admin/enrolled and /admin/registrations.
    const primaryByFamily = new Map<number, (typeof parents)[number] | null>();
    for (const f of families) {
      const ids = xano.families.getParentIds(f);
      const matched = parents
        .filter((p) => ids.includes(p.id))
        .sort((a, b) => a.id - b.id);
      primaryByFamily.set(f.id, matched[0] ?? null);
    }

    const rows: BillingRow[] = payments
      .filter((p) => !!p.stripe_subscription_id)
      .map((p) => {
        const familyId = Number(p.registration_families_id);
        const family = familyById.get(familyId) ?? null;
        const primary = primaryByFamily.get(familyId) ?? null;
        return {
          id: p.id,
          family_id: familyId,
          year_id: yearId,
          family_name:
            family?.family_name?.trim() || `Family #${familyId}`,
          primary_name: primary
            ? `${primary.first_name ?? ""} ${primary.last_name ?? ""}`.trim()
            : "",
          primary_email: primary?.email ?? "",
          monthly_tuition: p.monthly_tuition_payment ?? null,
          stripe_subscription_id: p.stripe_subscription_id ?? null,
          is_stripe_setup: p.isStripeSetup === true,
        };
      });

    rows.sort((a, b) => a.family_name.localeCompare(b.family_name));
    return NextResponse.json(rows);
  } catch (err) {
    return handleAdminError(err);
  }
}

export interface BillingRow {
  id: number;
  family_id: number;
  year_id: number;
  family_name: string;
  primary_name: string;
  primary_email: string;
  monthly_tuition: number | null;
  stripe_subscription_id: string | null;
  is_stripe_setup: boolean;
}

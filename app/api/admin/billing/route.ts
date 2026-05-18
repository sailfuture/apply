import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";

/**
 * Admin Billing list — one row per family with a Stripe subscription
 * on file for the selected school year. Drives the `/admin/billing`
 * table.
 *
 * Pivot: `registration_families_payment` rows for the year where
 * `stripe_subscription_id` is set. We join the
 * `registration_payment_transactions` mirror to compute
 * paid/outstanding totals per family — single Xano fetch for the
 * mirror, then in-memory reduce by family. No Stripe API calls per
 * row (which would N+1 on every page load).
 *
 * Joins:
 *   - `xano.familyPayments.getAllByYear(yearId)` → primary pivot
 *   - `xano.families.getAll()` → display label for the family
 *   - `xano.parents.getAll()` → primary parent name + email
 *   - `xano.paymentTransactions.getAllByYear(yearId)` → mirror
 *     for paid/outstanding aggregation
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

    const [
      paymentsResult,
      familiesResult,
      parentsResult,
      transactionsResult,
      yearPacketsResult,
    ] = await Promise.allSettled([
      xano.familyPayments.getAllByYear(yearId),
      xano.families.getAll(),
      xano.parents.getAll(),
      xano.paymentTransactions.getAllByYear(yearId),
      // Per-student `monthly_amount` is the source of truth for the
      // family monthly total now — fetch the year's packets so we
      // can sum per-family below.
      xano.studentRegistration.getByYear(yearId),
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
    if (transactionsResult.status === "rejected") {
      console.error(
        "[/api/admin/billing] failed to load payment transactions:",
        transactionsResult.reason
      );
    }
    if (yearPacketsResult.status === "rejected") {
      console.error(
        "[/api/admin/billing] failed to load year packets:",
        yearPacketsResult.reason
      );
    }

    const payments =
      paymentsResult.status === "fulfilled" ? paymentsResult.value : [];
    const families =
      familiesResult.status === "fulfilled" ? familiesResult.value : [];
    const parents =
      parentsResult.status === "fulfilled" ? parentsResult.value : [];
    const transactions =
      transactionsResult.status === "fulfilled"
        ? transactionsResult.value
        : [];
    const yearPackets =
      yearPacketsResult.status === "fulfilled"
        ? yearPacketsResult.value
        : [];

    // Per-family monthly total derived from per-student
    // `monthly_amount` sums. Build a `familyId → monthlyDollars`
    // map once so the per-row reduce below stays O(1) per family.
    // Map student id → family id via the students roster so we can
    // attribute each packet to its family without per-row lookup.
    const studentToFamily = new Map<number, number>();
    for (const f of families) {
      for (const sid of xano.families.getStudentIds(f)) {
        studentToFamily.set(sid, f.id);
      }
    }
    const monthlyByFamily = new Map<number, number>();
    for (const packet of yearPackets) {
      const sid = Number(packet.registration_students_id);
      const fid = studentToFamily.get(sid);
      if (!fid) continue;
      const amount =
        typeof packet.monthly_amount === "number" ? packet.monthly_amount : 0;
      if (amount <= 0) continue;
      monthlyByFamily.set(fid, (monthlyByFamily.get(fid) ?? 0) + amount);
    }

    // Aggregate transactions by family id once so the per-row
    // reduce below is O(1) per family. `paid` = sum of amount_paid
    // across all transactions (covers both paid invoices and
    // partial payments on void/uncollectible if Stripe ever
    // surfaces those). `outstanding` = sum of (due - paid) on
    // open/uncollectible only — past-due and future-generated
    // invoices count, but voided invoices don't because Stripe
    // never collects on them.
    const aggByFamily = new Map<
      number,
      { paidCents: number; outstandingCents: number; invoicesIssued: number }
    >();
    for (const t of transactions) {
      const fid = Number(t.registration_families_id);
      const bucket = aggByFamily.get(fid) ?? {
        paidCents: 0,
        outstandingCents: 0,
        invoicesIssued: 0,
      };
      bucket.paidCents += t.amount_paid_cents ?? 0;
      if (t.status === "open" || t.status === "uncollectible") {
        bucket.outstandingCents += Math.max(
          (t.amount_due_cents ?? 0) - (t.amount_paid_cents ?? 0),
          0
        );
      }
      bucket.invoicesIssued += 1;
      aggByFamily.set(fid, bucket);
    }

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
        const derived = monthlyByFamily.get(familyId);
        const monthly = derived && derived > 0 ? derived : null;
        const yearTotal = monthly != null ? monthly * 12 : null;
        const agg = aggByFamily.get(familyId) ?? {
          paidCents: 0,
          outstandingCents: 0,
          invoicesIssued: 0,
        };
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
          monthly_tuition: monthly,
          year_total: yearTotal,
          paid_cents: agg.paidCents,
          outstanding_cents: agg.outstandingCents,
          invoices_issued: agg.invoicesIssued,
          stripe_subscription_id: p.stripe_subscription_id ?? null,
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
  /** monthly_tuition × 12, or null when monthly isn't set yet. */
  year_total: number | null;
  /** Sum of `amount_paid_cents` across every invoice this family
   *  has for the year. Updates each time the webhook upserts a
   *  paid invoice. */
  paid_cents: number;
  /** Sum of remaining due on open/uncollectible invoices. Doesn't
   *  include future invoices that haven't been generated yet. */
  outstanding_cents: number;
  /** How many invoices Stripe has issued for the family so far this
   *  year. Drives the "X of 12 invoices issued" microcopy in the
   *  list UI when admin scans for who's behind on invoicing. */
  invoices_issued: number;
  stripe_subscription_id: string | null;
}

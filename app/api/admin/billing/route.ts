import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano, activeStripeSubscriptionId } from "@/lib/xano";
import { parseAnchorDate, buildMonthSlots } from "@/lib/billing-schedule";
import { getStripeClient } from "@/lib/stripe";

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
 * Residential/foster families (`is_residential` on the family row)
 * are excluded from BOTH the paying list and the not-started queue —
 * the program covers their students, so they're never tuition-billed.
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
      appsResult,
      studentsResult,
      progressResult,
      yearResult,
    ] = await Promise.allSettled([
      xano.familyPayments.getAllByYear(yearId),
      xano.families.getAll(),
      xano.parents.getAll(),
      xano.paymentTransactions.getAllByYear(yearId),
      // Per-student `monthly_amount` lives on the application row
      // now — fetch every application so we can sum per-family
      // below. Source of truth for billing math.
      xano.applications.getAll(),
      // Students, for the archived filter: an archived (unenrolled)
      // student's application must not count toward the family's
      // monthly/year totals — Stripe stopped billing them at archive
      // time, and this list (plus its XLSX export) must agree with
      // what Stripe actually invoices.
      xano.students.getAll(),
      // Registration progress, for the "billing not started" section:
      // a confirmed family with no live subscription is billing work
      // waiting to happen — previously invisible on this page.
      xano.studentRegistrationProgress.getByYear(yearId),
      // Year row for the billing anchor — drives the derived status
      // pill (scheduled vs no-invoices) and the next-invoice
      // projection.
      xano.schoolYears.getById(yearId),
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
    if (appsResult.status === "rejected") {
      console.error(
        "[/api/admin/billing] failed to load applications:",
        appsResult.reason
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
    const yearApps = (
      appsResult.status === "fulfilled" ? appsResult.value : []
    ).filter((a) => Number(a.registration_school_years_id) === yearId);
    const archivedStudentIds = new Set(
      (studentsResult.status === "fulfilled" ? studentsResult.value : [])
        .filter((s) => s.isArchived === true)
        .map((s) => s.id)
    );
    const progresses =
      progressResult.status === "fulfilled" ? progressResult.value : [];
    const year = yearResult.status === "fulfilled" ? yearResult.value : null;
    if (progressResult.status === "rejected") {
      console.error(
        "[/api/admin/billing] failed to load registration progress:",
        progressResult.reason
      );
    }
    if (yearResult.status === "rejected") {
      console.error(
        "[/api/admin/billing] failed to load school year:",
        yearResult.reason
      );
    }

    // Per-family monthly total derived from per-student
    // `monthly_amount` sums (now on the application row). Only
    // active applications for non-archived students contribute —
    // soft-deleted apps and unenrolled students shouldn't bill, and
    // the archive cascade already removed their Stripe items, so
    // counting them here would overstate every total on this list
    // and the XLSX export.
    const monthlyByFamily = new Map<number, number>();
    for (const app of yearApps) {
      if (app.isActive === false) continue;
      if (archivedStudentIds.has(Number(app.registration_students_id))) {
        continue;
      }
      const fid = Number(app.registration_families_id);
      if (!fid) continue;
      const amount =
        typeof app.monthly_amount === "number" ? app.monthly_amount : 0;
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
    const now = Date.now();
    const aggByFamily = new Map<
      number,
      {
        paidCents: number;
        outstandingCents: number;
        invoicesIssued: number;
        hasPastDue: boolean;
      }
    >();
    for (const t of transactions) {
      const fid = Number(t.registration_families_id);
      const bucket = aggByFamily.get(fid) ?? {
        paidCents: 0,
        outstandingCents: 0,
        invoicesIssued: 0,
        hasPastDue: false,
      };
      bucket.paidCents += t.amount_paid_cents ?? 0;
      if (t.status === "open" || t.status === "uncollectible") {
        const balance = Math.max(
          (t.amount_due_cents ?? 0) - (t.amount_paid_cents ?? 0),
          0
        );
        bucket.outstandingCents += balance;
        // Past due = an unpaid balance whose due date has passed —
        // drives the red status pill on the list.
        if (balance > 0 && t.due_date != null && t.due_date < now) {
          bucket.hasPastDue = true;
        }
      }
      bucket.invoicesIssued += 1;
      aggByFamily.set(fid, bucket);
    }

    // Billing-anchor projections. `nextInvoiceAt` = the next cycle
    // boundary after today within the year's 12-month window — an
    // ESTIMATE derived from the anchor (Stripe owns the real dates),
    // shown so admin can see when the next invoice will land and,
    // for "Scheduled" subscriptions, when billing kicks in.
    const billingStartDate = year?.billing_start_date ?? null;
    const billingStartMs = billingStartDate
      ? Date.parse(`${billingStartDate}T00:00:00Z`)
      : NaN;
    const slots = billingStartDate
      ? buildMonthSlots(parseAnchorDate(billingStartDate))
      : [];
    const nextInvoiceAt =
      slots.find((s) => s.periodStart > now)?.periodStart ?? null;

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

    // Residential/foster families are never tuition-billed — the
    // program covers their students — so they stay off every part of
    // this page (paying list AND the not-started queue). A stray
    // subscription on one is handled from the family detail page, not
    // here. Missing flag (legacy rows) counts as not residential.
    const isResidentialFamily = (familyId: number): boolean =>
      familyById.get(familyId)?.is_residential === true;

    const rows: BillingRow[] = payments
      // Sentinel-aware: a `canceled:<id>` marker is NOT a live
      // subscription — those families belong off the paying list.
      .filter((p) => !!activeStripeSubscriptionId(p.stripe_subscription_id))
      .filter(
        (p) => !isResidentialFamily(Number(p.registration_families_id))
      )
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
          hasPastDue: false,
        };
        // Derived subscription state, mirror-only (no per-family
        // Stripe call):
        //   past_due    — unpaid invoice past its due date
        //   active      — invoices flowing normally
        //   scheduled   — live subscription, no invoices yet, and
        //                 we're before (or within a week after) the
        //                 billing anchor: first invoice is upcoming
        //   no_invoices — live subscription, zero invoices, well past
        //                 the anchor. Something's wrong (webhook dead
        //                 or the subscription isn't generating) — the
        //                 daily cron alert fires on the same signal.
        const status: BillingRowStatus = agg.hasPastDue
          ? "past_due"
          : agg.invoicesIssued > 0
            ? "active"
            : !Number.isFinite(billingStartMs) ||
                now < billingStartMs + 7 * 24 * 60 * 60 * 1000
              ? "scheduled"
              : "no_invoices";
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
          stripe_subscription_id: activeStripeSubscriptionId(
            p.stripe_subscription_id
          ),
          status,
          next_invoice_at: nextInvoiceAt,
        };
      });

    rows.sort((a, b) => a.family_name.localeCompare(b.family_name));

    // "Billing not started" — families whose registration is
    // confirmed (the precondition `startMonthlyBilling` enforces) but
    // who have NO live subscription for the year. These are the
    // pending setups that were previously invisible on every billing
    // surface: the list above only shows subscriptions that exist.
    const liveSubFamilies = new Set(rows.map((r) => r.family_id));
    const notStarted: NotStartedRow[] = progresses
      .filter(
        (p) =>
          p.isRegistrationConfirmed === true &&
          p.isArchived !== true &&
          !liveSubFamilies.has(Number(p.registration_families_id)) &&
          !isResidentialFamily(Number(p.registration_families_id))
      )
      .map((p) => {
        const fid = Number(p.registration_families_id);
        const family = familyById.get(fid) ?? null;
        const primary = primaryByFamily.get(fid) ?? null;
        const monthly = monthlyByFamily.get(fid);
        return {
          family_id: fid,
          year_id: yearId,
          family_name: family?.family_name?.trim() || `Family #${fid}`,
          primary_name: primary
            ? `${primary.first_name ?? ""} ${primary.last_name ?? ""}`.trim()
            : "",
          primary_email: primary?.email ?? "",
          monthly_tuition: monthly && monthly > 0 ? monthly : null,
        };
      })
      // De-dupe defensively (progress rows should be unique per
      // family, but duplicates exist in the wild — see the reconcile
      // work in lib/billing.ts).
      .filter(
        (row, i, arr) =>
          arr.findIndex((r) => r.family_id === row.family_id) === i
      )
      .sort((a, b) => a.family_name.localeCompare(b.family_name));

    // Future-dated Stripe billing sitting in "Not started" (user
    // request): a family can already have billing set up in Stripe —
    // a trialing (future-anchored) subscription the webhook missed,
    // or a dashboard-created SubscriptionSchedule that hasn't started
    // — while the mirror holds no live id. Those are indistinguishable
    // from "never started" above, so check Stripe per candidate (the
    // pending-setup set is small) and lift matches into the main
    // table with the Scheduled pill.
    const lifted = new Set<number>();
    try {
      const stripe = getStripeClient();
      await Promise.all(
        notStarted.map(async (n) => {
          const customerId =
            familyById.get(n.family_id)?.stripe_customer_id ?? null;
          if (!customerId) return;
          try {
            const [subs, schedules] = await Promise.all([
              stripe.subscriptions.list({
                customer: customerId,
                status: "trialing",
                limit: 1,
              }),
              stripe.subscriptionSchedules.list({
                customer: customerId,
                limit: 5,
              }),
            ]);
            const trialing = subs.data[0] ?? null;
            const pending =
              schedules.data.find((s) => s.status === "not_started") ??
              null;
            if (!trialing && !pending) return;
            lifted.add(n.family_id);
            const startsAt = trialing?.trial_end
              ? trialing.trial_end * 1000
              : pending?.phases?.[0]?.start_date
                ? pending.phases[0].start_date * 1000
                : null;
            rows.push({
              // Synthetic row id — there's no payment-row id to use,
              // and negatives can't collide with real Xano ids.
              id: -n.family_id,
              family_id: n.family_id,
              year_id: yearId,
              family_name: n.family_name,
              primary_name: n.primary_name,
              primary_email: n.primary_email,
              monthly_tuition: n.monthly_tuition,
              year_total:
                n.monthly_tuition != null ? n.monthly_tuition * 12 : null,
              paid_cents: 0,
              outstanding_cents: 0,
              invoices_issued: 0,
              stripe_subscription_id: trialing?.id ?? pending?.id ?? null,
              status: "scheduled",
              next_invoice_at: startsAt,
            });
          } catch {
            // Per-family Stripe hiccup — leave them in Not started.
          }
        })
      );
    } catch {
      // Stripe not configured — mirror-only behavior, as before.
    }
    const notStartedFinal = notStarted.filter(
      (n) => !lifted.has(n.family_id)
    );
    rows.sort((a, b) => a.family_name.localeCompare(b.family_name));

    return NextResponse.json({
      rows,
      notStarted: notStartedFinal,
      billingStartDate,
      nextInvoiceAt,
    } satisfies BillingListResponse);
  } catch (err) {
    return handleAdminError(err);
  }
}

/** Derived, mirror-only subscription state for the list pill. */
export type BillingRowStatus =
  | "scheduled"
  | "active"
  | "past_due"
  | "no_invoices";

/** A confirmed family with no live subscription — billing work
 *  waiting for the "Start Monthly Billing" click. */
export interface NotStartedRow {
  family_id: number;
  year_id: number;
  family_name: string;
  primary_name: string;
  primary_email: string;
  /** Σ active students' monthly_amount, or null when tuition isn't
   *  set yet (family isn't startable until it is). */
  monthly_tuition: number | null;
}

export interface BillingListResponse {
  rows: BillingRow[];
  notStarted: NotStartedRow[];
  /** The year's billing anchor (YYYY-MM-DD), null when unset. */
  billingStartDate: string | null;
  /** Next projected cycle boundary after today (unix ms), null when
   *  the anchor is unset or the 12-month window has ended. */
  nextInvoiceAt: number | null;
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
  /** Derived, mirror-only state — see `BillingRowStatus`. */
  status: BillingRowStatus;
  /** Next projected invoice date (unix ms) from the year's billing
   *  anchor; an estimate (Stripe owns the real cycle), null when the
   *  anchor is unset or the year's window has ended. */
  next_invoice_at: number | null;
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import { CheckCircle2, CreditCard, Loader2 } from "lucide-react";
import { useApplicationFlow } from "@/contexts/application-flow-context";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

interface FamilyPayment {
  id: number;
  monthly_tuition_payment: number | null;
  stripe_subscription_id?: string | null;
  isStripeSetup?: boolean;
}

interface SchoolYear {
  id: number;
  year_name: string;
  billing_start_date?: string | null;
}

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
  return res.json();
};

/**
 * Payment Setup step. Parent enters the monthly tuition card on Stripe
 * Checkout — the actual card-entry UI is Stripe-hosted, not embedded.
 *
 * Flow:
 *   1. Page loads, shows the family's monthly amount + billing start
 *      date pulled from `/api/family-payment` + `/api/admin/school-years`
 *      (the year endpoint is admin-gated for writes but the GET is
 *      open — actually we pull from the parent-side year list).
 *   2. Parent clicks "Set Up Payment" → POST `/api/payment-setup` →
 *      Stripe returns a Checkout URL → `window.location.href = url`.
 *   3. Stripe Checkout collects the card.
 *   4. On completion, Stripe redirects to `?status=success`. The webhook
 *      handler (running in parallel) flips `isStripeSetup=true` and stamps
 *      the subscription id on the family-payment row. The page polls SWR
 *      to pick up the latched state.
 *   5. On cancel, Stripe redirects to `?status=cancel`. Parent can retry.
 *
 * Once `isStripeSetup` is true, the page shows a confirmation state
 * instead of the setup CTA. Admin actions (pause / cancel / refund /
 * update amount) happen from the admin registration detail page.
 */
export default function PaymentSetupPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const yearId = Number(params.yearId);
  const { setPageTitle, setHideBottomBar } = useApplicationFlow();

  useEffect(() => {
    setPageTitle("Payment Setup");
  }, [setPageTitle]);

  // Hide the bottom save-bar — this step has no draft-save concept;
  // the only action is the Stripe Checkout redirect button below.
  useEffect(() => {
    setHideBottomBar(true);
    return () => setHideBottomBar(false);
  }, [setHideBottomBar]);

  // Re-validate on focus so the page picks up the webhook latch when
  // Stripe redirects back to `?status=success`. SWR's
  // `revalidateOnFocus` is the cheap version of polling.
  const { data: familyPayment, mutate: refreshFamilyPayment } =
    useSWR<FamilyPayment | null>(
      yearId ? `/api/family-payment?yearId=${yearId}` : null,
      fetcher
    );
  const { data: schoolYears } = useSWR<SchoolYear[]>(
    "/api/school-years",
    fetcher
  );

  const year = useMemo(() => {
    if (!schoolYears) return null;
    return schoolYears.find((y) => y.id === yearId) ?? null;
  }, [schoolYears, yearId]);

  const isComplete = familyPayment?.isStripeSetup === true;
  const monthlyTuition = familyPayment?.monthly_tuition_payment ?? null;

  // Pretty billing start (e.g. "August 1, 2025"). Falls back to "—"
  // when admin hasn't set the date for this year yet.
  const billingStartLabel = useMemo(() => {
    if (!year?.billing_start_date) return "—";
    const ms = Date.parse(`${year.billing_start_date}T00:00:00Z`);
    if (!Number.isFinite(ms)) return year.billing_start_date;
    return new Date(ms).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
  }, [year]);

  // Surface Stripe's redirect status back to the parent. We don't
  // verify the session id here — the webhook handler is the source of
  // truth for whether setup actually succeeded.
  const status = searchParams.get("status");
  useEffect(() => {
    if (status === "success") {
      toast.success(
        "Payment setup complete. We'll process the first charge on your billing start date."
      );
      // Strip the query params so a refresh doesn't re-fire the toast.
      router.replace(`/apply/year/${yearId}/payment-setup`);
      void refreshFamilyPayment();
    } else if (status === "cancel") {
      toast.info("Payment setup canceled. You can retry whenever you're ready.");
      router.replace(`/apply/year/${yearId}/payment-setup`);
    }
  }, [status, router, yearId, refreshFamilyPayment]);

  const [submitting, setSubmitting] = useState(false);
  async function startSetup() {
    if (submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/payment-setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ yearId }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.url) {
        throw new Error(body?.error ?? `Setup failed (${res.status})`);
      }
      // Hard navigation — Stripe Checkout is a different origin.
      window.location.href = body.url;
    } catch (err) {
      console.error("Payment setup failed:", err);
      toast.error(
        err instanceof Error
          ? err.message
          : "Couldn't open Stripe Checkout. Please try again."
      );
      setSubmitting(false);
    }
  }

  const loading = familyPayment === undefined || schoolYears === undefined;

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-2xl p-6 space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full rounded-lg" />
      </div>
    );
  }

  if (!familyPayment) {
    return (
      <div className="mx-auto w-full max-w-2xl p-6">
        <div className="rounded-lg border bg-white p-6 space-y-2">
          <h1 className="text-xl font-semibold">Payment Setup</h1>
          <p className="text-sm text-muted-foreground">
            We don&rsquo;t have your tuition amount on file yet. Reach out
            to admissions so they can finish approving your enrollment.
          </p>
        </div>
      </div>
    );
  }

  // Confirmation state — card on file, subscription created.
  if (isComplete) {
    return (
      <div className="mx-auto w-full max-w-2xl p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Payment Setup
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Your monthly tuition billing is set up for the {year?.year_name ?? "current"} school year.
          </p>
        </div>
        <div className="rounded-xl border bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900 p-6 flex items-start gap-4">
          <CheckCircle2 className="size-6 text-emerald-600 shrink-0 mt-0.5" aria-hidden="true" />
          <div className="space-y-2 min-w-0 flex-1">
            <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-100">
              Card on file with Stripe
            </p>
            <p className="text-sm text-emerald-800/80 dark:text-emerald-200/80">
              You&rsquo;ll be charged{" "}
              <span className="font-semibold">
                ${(monthlyTuition ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>{" "}
              on the {billingStartLabel === "—" ? "billing start date" : billingStartLabel} and then on the same day each
              following month.
            </p>
            <p className="text-xs text-emerald-800/70 dark:text-emerald-200/70 pt-1">
              Need to update your card, change the amount, or cancel? Reach out
              to admissions and we&rsquo;ll get it sorted.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Setup state — show monthly amount + start date + CTA.
  return (
    <div className="mx-auto w-full max-w-2xl p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Payment Setup</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Set up your card so monthly tuition charges run automatically each
          month.
        </p>
      </div>

      <div className="rounded-xl border bg-white p-6 space-y-6">
        <div className="flex items-start gap-4">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted/50">
            <CreditCard className="size-5 text-muted-foreground" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1 space-y-4">
            <div>
              <p className="text-sm font-semibold">
                {year?.year_name ?? "Annual"} tuition billing
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Card collected by Stripe — we never see or store your card
                number directly.
              </p>
            </div>

            <dl className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Monthly amount
                </dt>
                <dd className="text-lg font-semibold mt-1">
                  {monthlyTuition != null
                    ? `$${monthlyTuition.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                    : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  First charge
                </dt>
                <dd className="text-lg font-semibold mt-1">
                  {billingStartLabel}
                </dd>
              </div>
            </dl>

            <p className="text-xs text-muted-foreground">
              You won&rsquo;t be charged until the first-charge date — the next
              screen captures your card details and authorizes future
              billing on that date.
            </p>
          </div>
        </div>

        <div className="flex justify-end pt-2 border-t -mx-6 px-6 -mb-6 pb-6">
          <Button
            disabled={submitting || monthlyTuition == null || monthlyTuition <= 0}
            onClick={startSetup}
            size="lg"
          >
            {submitting ? (
              <>
                <Loader2 className="size-4 mr-1.5 animate-spin" />
                Opening Stripe…
              </>
            ) : (
              "Set Up Payment"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

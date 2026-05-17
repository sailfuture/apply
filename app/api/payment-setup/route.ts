import { auth, currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { xano } from "@/lib/xano";
import {
  createCheckoutSession,
  getAppBaseUrl,
  getOrCreateCustomer,
} from "@/lib/stripe";

/**
 * Build a Stripe Checkout Session for the parent to set up monthly
 * tuition billing for a given school year. Returns the Checkout URL —
 * the client side then redirects (`window.location.href = url`).
 *
 * Flow:
 *   1. Authenticate the parent via Clerk + resolve their family id
 *      from `publicMetadata.registration_families_id` (same pattern
 *      every other parent-side route uses).
 *   2. Load the family + parents (for email/name) + the per-year
 *      `family_payment` row (for `monthly_tuition_payment`) + the
 *      school year (for `billing_start_date`).
 *   3. Fetch-or-create the Stripe Customer. The Customer is shared
 *      across academic years — one per family, persisted on
 *      `registration_families.stripe_customer_id`. When we create a
 *      new one we write it back to Xano immediately so a retry
 *      doesn't make a second Customer.
 *   4. Build the Checkout Session with inline `price_data` carrying
 *      the family's scholarship-adjusted monthly amount in cents.
 *      `subscription_data.trial_end` defers the first charge to the
 *      year's `billing_start_date` if it's in the future.
 *   5. Return `{ url }` for client-side redirect.
 *
 * Errors surface as 4xx for caller-fixable issues (missing year id,
 * missing monthly amount on the family-payment row) and 5xx for
 * Stripe/Xano transport failures. The body is always JSON.
 */
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const familyId = user.publicMetadata.registration_families_id as
    | number
    | undefined;
  if (!familyId) {
    return NextResponse.json({ error: "No family on file" }, { status: 400 });
  }

  const body = (await req.json().catch(() => null)) as { yearId?: number } | null;
  const yearId = Number(body?.yearId);
  if (!Number.isFinite(yearId) || yearId <= 0) {
    return NextResponse.json(
      { error: "yearId is required" },
      { status: 400 }
    );
  }

  // Load everything we need in parallel — keeps the route fast and
  // each fetch's failure surfaces cleanly. The Xano helpers throw
  // on transport errors, so we let those bubble to the catch below.
  let family: Awaited<ReturnType<typeof xano.families.getById>>;
  let familyPayment: Awaited<
    ReturnType<typeof xano.familyPayments.getByFamilyAndYear>
  >;
  let year: Awaited<ReturnType<typeof xano.schoolYears.getById>>;
  let parents: Awaited<ReturnType<typeof xano.parents.getAll>>;
  try {
    [family, familyPayment, year, parents] = await Promise.all([
      xano.families.getById(familyId),
      xano.familyPayments.getByFamilyAndYear(familyId, yearId),
      xano.schoolYears.getById(yearId),
      xano.parents.getAll(),
    ]);
  } catch (err) {
    console.error("[/api/payment-setup] failed to load context:", err);
    return NextResponse.json(
      { error: "Couldn't load your family or year info. Please try again." },
      { status: 502 }
    );
  }

  if (!family) {
    return NextResponse.json(
      { error: "Family record not found" },
      { status: 404 }
    );
  }
  if (!year) {
    return NextResponse.json(
      { error: "School year not found" },
      { status: 404 }
    );
  }
  if (!familyPayment) {
    return NextResponse.json(
      {
        error:
          "We don't have your tuition amount on file yet. Reach out to admissions so they can finish approving your enrollment.",
      },
      { status: 409 }
    );
  }
  const monthlyTuition = familyPayment.monthly_tuition_payment;
  if (monthlyTuition == null || monthlyTuition <= 0) {
    return NextResponse.json(
      {
        error:
          "Your monthly tuition amount hasn't been set yet. Reach out to admissions to finalize it.",
      },
      { status: 409 }
    );
  }

  // Primary parent — the family's first parent record by id. Same
  // ordering convention every other surface uses (admin tables,
  // dashboard contacts card, etc.) so the receipt goes to the
  // expected mailbox even when a secondary parent kicks off the flow.
  const familyParentIds = xano.families.getParentIds(family);
  const familyParents = parents
    .filter((p) => familyParentIds.includes(p.id))
    .sort((a, b) => a.id - b.id);
  const primaryParent = familyParents[0] ?? null;
  if (!primaryParent?.email) {
    return NextResponse.json(
      {
        error:
          "No primary parent email on file. Add a primary parent on your dashboard before setting up payment.",
      },
      { status: 409 }
    );
  }
  const primaryParentName =
    `${primaryParent.first_name ?? ""} ${primaryParent.last_name ?? ""}`.trim() ||
    family.family_name;

  // Get-or-create the Stripe Customer. When new, persist back to Xano
  // immediately so a refresh-and-retry doesn't double-create.
  let customerId: string;
  try {
    const { customer, created } = await getOrCreateCustomer({
      customerId: family.stripe_customer_id ?? null,
      familyName: family.family_name,
      primaryParentEmail: primaryParent.email,
      primaryParentName,
      familyId,
    });
    customerId = customer.id;
    if (created) {
      try {
        await xano.families.update(familyId, {
          stripe_customer_id: customer.id,
        });
      } catch (err) {
        // Persisting the customer id is best-effort here — if Xano
        // hiccups we still want Checkout to launch. The webhook
        // handler also persists from the completed session, so this
        // ends up consistent either way.
        console.error(
          `[/api/payment-setup] failed to persist stripe_customer_id on family ${familyId}:`,
          err
        );
      }
    }
  } catch (err) {
    console.error("[/api/payment-setup] getOrCreateCustomer failed:", err);
    return NextResponse.json(
      { error: "Couldn't initialize Stripe billing. Please try again." },
      { status: 502 }
    );
  }

  // Resolve the success/cancel URLs from the request origin so we
  // work in dev (`http://localhost:3000`) and prod without env-var
  // fiddling. Always come back to the apply flow's year landing so
  // the parent sees their next step.
  const origin = req.nextUrl.origin;
  const appBase = getAppBaseUrl(origin);
  const successUrl = `${appBase}/apply/year/${yearId}/payment-setup?status=success&session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${appBase}/apply/year/${yearId}/payment-setup?status=cancel`;

  let session: Awaited<ReturnType<typeof createCheckoutSession>>;
  try {
    session = await createCheckoutSession({
      customerId,
      monthlyTuitionCents: Math.round(monthlyTuition * 100),
      billingStartDate: year.billing_start_date ?? null,
      familyId,
      yearId,
      successUrl,
      cancelUrl,
    });
  } catch (err) {
    console.error("[/api/payment-setup] createCheckoutSession failed:", err);
    return NextResponse.json(
      { error: "Couldn't open Stripe Checkout. Please try again." },
      { status: 502 }
    );
  }

  if (!session.url) {
    return NextResponse.json(
      { error: "Stripe didn't return a Checkout URL." },
      { status: 502 }
    );
  }

  return NextResponse.json({ url: session.url, sessionId: session.id });
}

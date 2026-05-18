import { auth, currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { xano } from "@/lib/xano";
import { getStripeClient, getAppBaseUrl } from "@/lib/stripe";

/**
 * Stripe Customer Portal session for the authenticated parent. The
 * portal is Stripe-hosted — parents land on a Stripe page where they
 * can:
 *   - Save a payment method (card or bank account)
 *   - Opt into autopay (Stripe will auto-charge open invoices using
 *     the saved default payment method instead of waiting for the
 *     parent to click pay on each hosted invoice)
 *   - Download past invoices
 *   - Update billing email / address
 *
 *   POST /api/billing/portal
 *
 * Returns `{ url }` — the client redirects with
 * `window.location.href = url`. After the parent finishes in the
 * portal, Stripe redirects back to `return_url` (the dashboard
 * tuition page).
 *
 * Requires the family to have a Stripe Customer on file
 * (`registration_families.stripe_customer_id`) — if billing hasn't
 * started yet (no subscription), there's no customer to manage and
 * we return 409 so the UI can hide the button.
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
    return NextResponse.json(
      { error: "No family on file" },
      { status: 400 }
    );
  }

  const family = await xano.families.getById(familyId).catch(() => null);
  if (!family) {
    return NextResponse.json(
      { error: "Family record not found" },
      { status: 404 }
    );
  }

  const customerId = family.stripe_customer_id ?? null;
  if (!customerId) {
    return NextResponse.json(
      {
        error:
          "No Stripe customer on file yet. Billing hasn't been set up for your family — contact admissions.",
      },
      { status: 409 }
    );
  }

  // Resolve `return_url` from the request origin so dev + prod both
  // work without env-var fiddling. Sends the parent back to the
  // dashboard tuition page so they land where they started.
  const origin = req.nextUrl.origin;
  const appBase = getAppBaseUrl(origin);
  const yearIdParam = req.nextUrl.searchParams.get("yearId");
  const returnUrl = yearIdParam
    ? `${appBase}/dashboard/tuition?yearId=${encodeURIComponent(yearIdParam)}`
    : `${appBase}/dashboard/tuition`;

  try {
    const stripe = getStripeClient();
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("[/api/billing/portal] failed:", err);
    return NextResponse.json(
      {
        error:
          "Couldn't open the billing portal. If this is the first time you're using it, an admin may need to enable the Customer Portal in the Stripe Dashboard (Settings → Billing → Customer portal → Activate test/live link).",
      },
      { status: 502 }
    );
  }
}

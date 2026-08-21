import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import { getStripeClient, getAppBaseUrl } from "@/lib/stripe";

/**
 * Stripe Customer Portal session for a family, opened BY AN ADMIN.
 *
 *   POST /api/admin/families/:id/billing/portal?yearId=Y
 *   → `{ url }` — the caller hard-navigates to it.
 *
 * Same Stripe-hosted portal the parent reaches from
 * `/api/billing/portal`, so admin sees exactly what the family sees:
 * saved payment methods, autopay opt-in, past invoices, billing
 * email/address. The admin use case is the phone call — a parent
 * reading out a card, or asking why autopay didn't fire — where
 * "look at the same screen they're looking at" beats reconstructing
 * it from the Stripe Dashboard.
 *
 * Authorization note: this is not an escalation. Admin already has
 * full Stripe Dashboard access via the card's "View in Stripe" deep
 * link, plus cancel/refund actions on this very route's sibling. The
 * portal is a strictly smaller surface, scoped to one customer.
 *
 * `return_url` points back at the admin family billing page (not the
 * parent dashboard) so admin lands where they started. The yearId
 * rides along to preserve the selected year.
 *
 * 409 when the family has no `stripe_customer_id` yet — billing was
 * never started, so there's no customer to manage and the UI hides
 * the button.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const { id } = await params;
    const familyId = Number(id);
    if (!Number.isFinite(familyId) || familyId <= 0) {
      return NextResponse.json(
        { error: "Invalid family id" },
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
            "No Stripe customer on file for this family yet — start monthly billing first.",
        },
        { status: 409 }
      );
    }

    const appBase = getAppBaseUrl(req.nextUrl.origin);
    const yearIdParam = req.nextUrl.searchParams.get("yearId");
    const returnUrl = yearIdParam
      ? `${appBase}/admin/families/${familyId}/billing?yearId=${encodeURIComponent(yearIdParam)}`
      : `${appBase}/admin/families/${familyId}/billing`;

    const stripe = getStripeClient();
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
    return NextResponse.json({ url: session.url });
  } catch (err) {
    // Portal-not-configured is the common first-run failure and it's
    // fixable in the Stripe Dashboard, so name it rather than letting
    // the generic admin handler render an opaque 500.
    const message = err instanceof Error ? err.message : "";
    if (/portal|configuration/i.test(message)) {
      console.error(
        "[/api/admin/families/:id/billing/portal] portal not configured:",
        err
      );
      return NextResponse.json(
        {
          error:
            "Stripe's Customer Portal isn't activated on this account yet (Stripe Dashboard → Settings → Billing → Customer portal → Activate).",
        },
        { status: 502 }
      );
    }
    return handleAdminError(err);
  }
}

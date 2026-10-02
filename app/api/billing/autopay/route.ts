import { NextRequest, NextResponse } from "next/server";
import { getFamilyAuth } from "@/lib/family-auth";
import { xano } from "@/lib/xano";
import { getAppBaseUrl, getStripeClient } from "@/lib/stripe";
import {
  disableAutopay,
  enableAutopay,
  getAutopayStatus,
} from "@/lib/autopay";

/**
 * Autopay controls for the signed-in parent's own family. No family id
 * in the path: it comes from the session, so a parent can only act on
 * their own subscription.
 *
 *   GET  /api/billing/autopay?yearId=Y        → AutopayStatus
 *   POST /api/billing/autopay?yearId=Y  { action }
 *     "setup" → `{ url }`: a Stripe portal deep link that only adds a
 *               payment method (Stripe makes it the customer's
 *               default), then returns to the Tuition page with
 *               `?autopay=saved`, which posts "on".
 *     "on"    → switch to autopay with the saved payment method. This
 *               charges any open invoices: the page tells the parent
 *               the amount before they get here.
 *     "off"   → back to emailed invoices, remembered so the
 *               on-by-default sweep leaves the family alone.
 */

async function resolveRequest(
  req: NextRequest
): Promise<
  | { familyId: number; yearId: number }
  | { error: NextResponse }
> {
  const session = await getFamilyAuth();
  if (!session) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (!session.familyId) {
    return { error: NextResponse.json({ error: "No family on file" }, { status: 400 }) };
  }
  const yearId = Number(req.nextUrl.searchParams.get("yearId"));
  if (!Number.isFinite(yearId) || yearId <= 0) {
    return { error: NextResponse.json({ error: "yearId is required" }, { status: 400 }) };
  }
  return { familyId: session.familyId, yearId };
}

export async function GET(req: NextRequest) {
  const resolved = await resolveRequest(req);
  if ("error" in resolved) return resolved.error;
  try {
    return NextResponse.json(
      await getAutopayStatus(resolved.familyId, resolved.yearId)
    );
  } catch (err) {
    console.error("[/api/billing/autopay] status failed:", err);
    return NextResponse.json(
      { error: "Couldn't load your autopay settings." },
      { status: 502 }
    );
  }
}

export async function POST(req: NextRequest) {
  const resolved = await resolveRequest(req);
  if ("error" in resolved) return resolved.error;
  const { familyId, yearId } = resolved;
  const body = (await req.json().catch(() => null)) as {
    action?: unknown;
  } | null;
  const action = body?.action;

  try {
    if (action === "setup") {
      const family = await xano.families.getById(familyId).catch(() => null);
      const customerId = family?.stripe_customer_id ?? null;
      if (!customerId) {
        return NextResponse.json(
          {
            error:
              "Billing hasn't been set up for your family yet. Contact admissions.",
          },
          { status: 409 }
        );
      }
      const tuitionUrl = `${getAppBaseUrl(req.nextUrl.origin)}/dashboard/tuition?yearId=${yearId}`;
      const portal = await getStripeClient().billingPortal.sessions.create({
        customer: customerId,
        return_url: tuitionUrl,
        flow_data: {
          type: "payment_method_update",
          after_completion: {
            type: "redirect",
            redirect: { return_url: `${tuitionUrl}&autopay=saved` },
          },
        },
      });
      return NextResponse.json({ url: portal.url });
    }

    if (action === "on") {
      const result = await enableAutopay({ familyId, yearId, source: "parent" });
      if (!result.ok) {
        const message =
          result.reason === "no-payment-method"
            ? "Add a card or bank account first."
            : "Monthly billing isn't running for this school year yet.";
        return NextResponse.json({ error: message, reason: result.reason }, { status: 409 });
      }
      return NextResponse.json({
        ...result,
        status: await getAutopayStatus(familyId, yearId),
      });
    }

    if (action === "off") {
      const result = await disableAutopay({ familyId, yearId, source: "parent" });
      if (!result.ok) {
        return NextResponse.json(
          { error: "Monthly billing isn't running for this school year yet." },
          { status: 409 }
        );
      }
      return NextResponse.json({
        ...result,
        status: await getAutopayStatus(familyId, yearId),
      });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    console.error(`[/api/billing/autopay] ${String(action)} failed:`, err);
    return NextResponse.json(
      { error: "Something went wrong with Stripe. Please try again." },
      { status: 502 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { xano } from "@/lib/xano";

/**
 * Short, branded pay link for SMS:
 *
 *   GET /pay/in_XXXX  →  302 to the invoice's Stripe hosted page
 *
 * Exists because the raw `invoice.stripe.com` URL is ~140 characters
 * of token soup in a text message; `apply.sailfutureacademy.org/pay/…`
 * is under half that, reads as us rather than a random link, and
 * phones auto-link it the same way. (SMS can't do anchor text at all,
 * and public shorteners like bit.ly get filtered by carriers on A2P
 * traffic — a branded redirect is the deliverable version of "short".)
 *
 * Public route (exempted in proxy.ts): the destination is Stripe's
 * hosted invoice page, which is unauthenticated by design — anyone
 * holding the link can view and pay that one invoice — and the key is
 * the Stripe invoice id, an unguessable random token, so this reveals
 * nothing a holder of the SMS didn't already have.
 *
 * Unknown/legacy/failed lookups fall through to the parent tuition
 * page (sign-in gated), which lists every invoice with its own pay
 * link — a dead end for strangers, a soft landing for parents whose
 * link outlived the mirror row.
 */

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ invoiceId: string }> }
) {
  const { invoiceId } = await params;

  // Stripe invoice ids only — anything else skips the Xano probe.
  if (/^in_[A-Za-z0-9]+$/.test(invoiceId)) {
    // Lenient lookup: on a transient Xano failure the parent still
    // lands somewhere useful (the tuition page) instead of a 500.
    const row = await xano.paymentTransactions.findByStripeId(invoiceId);
    if (row?.hosted_invoice_url) {
      return NextResponse.redirect(row.hosted_invoice_url, 302);
    }
  }

  return NextResponse.redirect(new URL("/dashboard/tuition", req.url), 302);
}

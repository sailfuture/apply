import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import { getStripeClient } from "@/lib/stripe";
import { sendBillingAlert } from "@/lib/billing-alerts";

/**
 * Record an outside payment (check / cash) against one monthly
 * tuition invoice.
 *
 *   POST /api/admin/families/:id/billing/mark-paid
 *   body: { invoiceId: string, method: "check"|"cash"|"other", note?: string }
 *
 * What it does, in order:
 *   1. Marks the Stripe invoice paid OUT OF BAND
 *      (`invoices.pay({ paid_out_of_band: true })`) — Stripe closes
 *      the invoice without charging anyone; dunning/reminders stop.
 *   2. Stamps the method + note onto the invoice's metadata so the
 *      Stripe Dashboard shows how the money actually arrived.
 *      Best-effort — a metadata failure doesn't undo the payment.
 *   3. Updates the payment-transactions mirror row immediately
 *      (status/amounts/paid_at/payment_method) so the schedule page
 *      reflects the payment without waiting for the `invoice.paid`
 *      webhook. The webhook still lands afterwards and upserts the
 *      same state (it counts out-of-band invoices' amount_due as
 *      collected, and its payload omits `payment_method` so the
 *      method stamped here survives the re-sync).
 *
 * Safety: the invoice must already exist in the mirror AND belong to
 * the family in the URL — this route can't touch another family's
 * invoice, or an invoice we've never seen. Only `open` /
 * `uncollectible` invoices qualify (paid/void have nothing to
 * collect; Stripe rejects paying drafts).
 *
 * Reversal is deliberately not offered here: undoing a mark-paid is
 * a Stripe Dashboard operation (void the payment record), rare
 * enough that a one-click undo would be more dangerous than useful.
 */

const METHOD_LABELS: Record<string, string> = {
  check: "Check",
  cash: "Cash",
  other: "Other",
};

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

    const body = await req.json().catch(() => null);
    const invoiceId =
      typeof body?.invoiceId === "string" ? body.invoiceId.trim() : "";
    // Own-key lookup only — a bare bracket access walks the prototype
    // chain, so method: "toString" would pass the truthiness check
    // with a function as the label.
    const methodKey = String(body?.method ?? "");
    const methodLabel = Object.hasOwn(METHOD_LABELS, methodKey)
      ? METHOD_LABELS[methodKey]
      : undefined;
    const note = typeof body?.note === "string" ? body.note.trim() : "";
    if (!invoiceId || !methodLabel) {
      return NextResponse.json(
        { error: "invoiceId and a valid method (check/cash/other) are required" },
        { status: 400 }
      );
    }

    // Strict variant: a transient Xano failure must surface as a 500
    // ("try again"), not coerce to null — the null branch below reads
    // as "this invoice belongs to another family", which would be a
    // false accusation on a blip. Matches every other reliability-
    // gating consumer of this lookup (webhook, backfill, refund).
    const row = await xano.paymentTransactions.findByStripeIdStrict(invoiceId);
    if (!row || Number(row.registration_families_id) !== familyId) {
      return NextResponse.json(
        { error: "That invoice doesn't belong to this family" },
        { status: 404 }
      );
    }
    if (row.status !== "open" && row.status !== "uncollectible") {
      return NextResponse.json(
        { error: `Invoice is ${row.status} — only open invoices can be marked paid` },
        { status: 400 }
      );
    }

    const paymentMethod = note ? `${methodLabel} — ${note}` : methodLabel;

    const stripe = getStripeClient();
    try {
      await stripe.invoices.pay(invoiceId, { paid_out_of_band: true });
    } catch (err) {
      // Stripe rejected the payment record (already paid via a race,
      // voided in the Dashboard, …) — surface its message so admin
      // sees the real reason instead of a generic failure.
      const message =
        err instanceof Error
          ? err.message
          : "Stripe rejected the out-of-band payment";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    // Dashboard paper trail — best-effort, the payment already stuck.
    try {
      await stripe.invoices.update(invoiceId, {
        metadata: { paid_via: paymentMethod },
      });
    } catch (err) {
      console.error(
        `[mark-paid] failed to stamp metadata on ${invoiceId}:`,
        err
      );
    }

    // Immediate mirror write — the webhook will re-upsert the same
    // lifecycle state shortly; this makes the UI honest right away.
    // CAUGHT, not propagated: the money operation already succeeded
    // in Stripe, and a 500 here would tell the admin the payment
    // failed while retrying is a dead end (the invoice is paid — both
    // gates above reject a second attempt, permanently losing the
    // method label). Report success with an alert instead, because
    // nothing else ever writes this row's amount/method: the healing
    // webhook counts an out-of-band invoice's Stripe-collected amount
    // (possibly $0) and deliberately omits payment_method.
    const now = Date.now();
    try {
      await xano.paymentTransactions.update(row.id, {
        status: "paid",
        amount_paid_cents: row.amount_due_cents,
        paid_at: now,
        last_synced_at: now,
        payment_method: paymentMethod,
      });
    } catch (err) {
      console.error(
        `[mark-paid] invoice ${invoiceId} paid in Stripe but mirror update failed:`,
        err
      );
      await sendBillingAlert(
        `Check/cash payment not mirrored (family #${familyId})`,
        [
          `Invoice ${invoiceId} was marked paid out-of-band in Stripe (${paymentMethod}), but the local payment-transactions update failed.`,
          `The webhook will flip the row to paid, but the collected amount may mirror as $0 and the payment-method label is lost.`,
          `Fix the transaction row in Xano: amount_paid_cents = ${row.amount_due_cents}, payment_method = "${paymentMethod}".`,
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        ]
      );
      return NextResponse.json({
        ok: true,
        payment_method: paymentMethod,
        mirrorSynced: false,
      });
    }

    return NextResponse.json({ ok: true, payment_method: paymentMethod });
  } catch (err) {
    return handleAdminError(err);
  }
}

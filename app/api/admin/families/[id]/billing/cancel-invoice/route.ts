import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import {
  xano,
  activeStripeSubscriptionId,
  collapseDuplicateInvoiceRows,
  STRIPE_SUB_CANCELED_PREFIX,
} from "@/lib/xano";
import type { XanoPaymentTransaction } from "@/lib/xano";
import {
  cancelInvoice,
  InvoiceCancelError,
  retrieveInvoiceOrNull,
  extractInvoiceSubscriptionId,
} from "@/lib/stripe";
import { sendBillingAlert } from "@/lib/billing-alerts";

/**
 * Cancel one monthly tuition invoice.
 *
 *   POST /api/admin/families/:id/billing/cancel-invoice
 *   body: { invoiceId: string, yearId: number, reason?: string }
 *
 * What it does, in order:
 *   1. Voids the invoice in Stripe. `cancelInvoice` (lib/stripe.ts)
 *      picks the call from the LIVE status: void an open or
 *      uncollectible invoice; finalize a draft with automatic
 *      advancement off (no email) and then void it. The family is not
 *      billed for that month. The subscription keeps running and the
 *      next cycle invoices normally. Stripe's own reminders and
 *      autopay retries stop because the invoice is no longer open.
 *   2. Marks EVERY mirror row carrying the invoice id `void` — the
 *      mirror holds duplicate rows per invoice (see
 *      `collapseDuplicateInvoiceRows`), and a twin left `open` would
 *      keep drawing past-due notices. A draft the mirror had never
 *      seen (the Scheduled month) gets a row created so the month
 *      reads Cancelled on both the admin and parent schedules. `void`
 *      is the value the `invoice.voided` webhook writes too, so its
 *      later delivery is a no-op, and it is non-empty, which Xano's
 *      PATCH needs. Everything downstream keys off the raw status:
 *      the parent's amount due and pay link, the past-due emails and
 *      texts, the billing list's past-due pill and the activity
 *      stream all treat a `void` row as settled; the autopay sweep
 *      reads Stripe's open list, which no longer has it.
 *   3. Writes a billing note on the family (who, which month, how
 *      much, the reason) so the cancellation shows in the activity
 *      stream next to the mirrored "Invoice cancelled" marker.
 *
 * Safety: an invoice the mirror knows must belong to the family in
 * the URL. One it doesn't know (a draft) must belong to the family's
 * subscription for the year, checked against the live Stripe invoice,
 * never the request body. Paid invoices are refused: that's a refund,
 * and refunds are a Stripe Dashboard operation.
 *
 * There is no undo: Stripe can't reopen a voided invoice. The confirm
 * dialog says so.
 */

const STRIPE_INVOICE_ID = /^in_[A-Za-z0-9]+$/;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { admin } = await requireAdmin();
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
    const bodyYearId = Number(body?.yearId);
    // Stripe caps a metadata value at 500 characters; the note has no
    // cap but one screen of reason is plenty.
    const reason =
      typeof body?.reason === "string"
        ? body.reason.trim().slice(0, 500)
        : "";
    if (
      !STRIPE_INVOICE_ID.test(invoiceId) ||
      !Number.isFinite(bodyYearId) ||
      bodyYearId <= 0
    ) {
      return NextResponse.json(
        { error: "invoiceId (in_…) and yearId are required" },
        { status: 400 }
      );
    }

    // Strict lookup: a transient Xano failure must surface as a 500
    // ("try again"), not coerce to "never seen" — that branch is the
    // draft path, which would then insist the invoice isn't on the
    // family's subscription. Same reasoning as the mark-paid route.
    const knownRows =
      await xano.paymentTransactions.findAllByStripeIdStrict(invoiceId);
    const existing = collapseDuplicateInvoiceRows(knownRows)[0] ?? null;
    if (existing && Number(existing.registration_families_id) !== familyId) {
      return NextResponse.json(
        { error: "That invoice doesn't belong to this family" },
        { status: 404 }
      );
    }
    if (
      existing &&
      (existing.status === "paid" || existing.status === "refunded")
    ) {
      return NextResponse.json(
        {
          error: `Invoice is ${existing.status} — only unpaid invoices can be cancelled`,
        },
        { status: 400 }
      );
    }
    // A mirrored invoice pins its own year; the body's yearId only
    // matters for a draft the mirror hasn't seen.
    const yearId = existing
      ? Number(existing.registration_school_years_id)
      : bodyYearId;

    // The family's billing row for the year: ownership check for an
    // unmirrored draft, and the FK a created mirror row needs.
    const payment = await xano.familyPayments.getByFamilyAndYearStrict(
      familyId,
      yearId
    );
    const storedSub = payment?.stripe_subscription_id ?? null;
    const familySubIds = new Set<string>();
    const liveSub = activeStripeSubscriptionId(storedSub);
    if (liveSub) familySubIds.add(liveSub);
    // A subscription cancelled at period end can still carry an open
    // final invoice worth cancelling.
    if (storedSub?.startsWith(STRIPE_SUB_CANCELED_PREFIX)) {
      familySubIds.add(storedSub.slice(STRIPE_SUB_CANCELED_PREFIX.length));
    }

    const before = await retrieveInvoiceOrNull(invoiceId);
    if (!before) {
      return NextResponse.json(
        {
          error:
            "Stripe has no invoice with that id — it may have been deleted in the Dashboard. Re-sync from Stripe to refresh this page.",
        },
        { status: 404 }
      );
    }
    const invoiceSub = extractInvoiceSubscriptionId(before);
    if (!existing) {
      if (!payment || !invoiceSub || !familySubIds.has(invoiceSub)) {
        return NextResponse.json(
          {
            error:
              "That invoice isn't on this family's tuition subscription for the selected year",
          },
          { status: 404 }
        );
      }
    }

    let result: Awaited<ReturnType<typeof cancelInvoice>>;
    try {
      result = await cancelInvoice(before, {
        cancelled_via: "Apply admin",
        cancelled_by: admin.email,
        cancelled_at: new Date().toISOString(),
        ...(reason ? { cancel_reason: reason } : {}),
      });
    } catch (err) {
      if (err instanceof InvoiceCancelError) {
        const status =
          err.code === "paid" ? 409 : err.code === "missing" ? 404 : 400;
        return NextResponse.json({ error: err.message }, { status });
      }
      // Stripe rejected the void (a race with a payment, a Dashboard
      // change, …) — its message says why; a generic 500 wouldn't.
      const message =
        err instanceof Error ? err.message : "Stripe rejected the cancel";
      console.error(`[cancel-invoice] Stripe refused ${invoiceId}:`, err);
      return NextResponse.json({ error: message }, { status: 400 });
    }
    const { after, path } = result;

    // Mirror write. The pre-cancel figures are kept so the month still
    // shows what it would have cost next to its Cancelled pill (void
    // may zero the amounts); the hosted URL is read from the voided
    // invoice, which a silently finalized draft only has now.
    const now = Date.now();
    const periodStart = (before.period_start ?? 0) * 1000;
    const periodEnd = (before.period_end ?? 0) * 1000;
    const amountDueCents = before.amount_due ?? 0;
    const hostedUrl =
      after.hosted_invoice_url ?? before.hosted_invoice_url ?? null;
    const pdfUrl = after.invoice_pdf ?? before.invoice_pdf ?? null;
    const dueDate = before.due_date ? before.due_date * 1000 : null;
    const finalizedAt =
      path === "finalized_then_voided"
        ? now
        : before.status_transitions?.finalized_at
          ? before.status_transitions.finalized_at * 1000
          : null;

    let mirrorSynced = true;
    try {
      // Re-read right before writing: finalizing a draft fires
      // `invoice.finalized`, and the webhook may have inserted the row
      // in the meantime. Updating every row that exists now (rather
      // than creating beside it) keeps the duplicate count down; a
      // twin that still slips in is healed by `invoice.voided`.
      const rows =
        await xano.paymentTransactions.findAllByStripeIdStrict(invoiceId);
      if (rows.length > 0) {
        for (const row of rows) {
          // Blanks are filled, never overwritten — PATCH drops empties
          // anyway, so only truthy values are sent.
          await xano.paymentTransactions.update(row.id, {
            status: "void",
            last_synced_at: now,
            ...(!row.finalized_at && finalizedAt
              ? { finalized_at: finalizedAt }
              : {}),
            ...(!row.hosted_invoice_url && hostedUrl
              ? { hosted_invoice_url: hostedUrl }
              : {}),
            ...(!row.invoice_pdf_url && pdfUrl
              ? { invoice_pdf_url: pdfUrl }
              : {}),
          });
        }
      } else if (payment && invoiceSub) {
        const row: Omit<XanoPaymentTransaction, "id" | "created_at"> = {
          registration_families_id: familyId,
          registration_school_years_id: yearId,
          registration_families_payment_id: payment.id,
          stripe_invoice_id: invoiceId,
          stripe_subscription_id: invoiceSub,
          period_start: periodStart,
          period_end: periodEnd,
          amount_due_cents: amountDueCents,
          amount_paid_cents: 0,
          status: "void",
          hosted_invoice_url: hostedUrl,
          invoice_pdf_url: pdfUrl,
          due_date: dueDate,
          paid_at: null,
          finalized_at: finalizedAt,
          last_synced_at: now,
        };
        await xano.paymentTransactions.create(row);
      }
    } catch (err) {
      // CAUGHT, not propagated: the invoice is already void in Stripe,
      // and a 500 would tell admin the cancel failed while a retry is
      // a dead end (Stripe reports it already void). Report success
      // with an alert; the `invoice.voided` webhook or a Re-sync from
      // Stripe brings the row in line.
      mirrorSynced = false;
      console.error(
        `[cancel-invoice] invoice ${invoiceId} voided in Stripe but mirror update failed:`,
        err
      );
      await sendBillingAlert(
        "Cancelled invoice not mirrored",
        [
          `This family's invoice was voided in Stripe, but the local payment-transactions update failed, so the schedule still shows it unpaid.`,
          `The invoice.voided webhook will flip the row if the endpoint is subscribed to it; otherwise click "Re-sync from Stripe" on the family's billing page.`,
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        ],
        {
          familyId,
          yearId,
          subscriptionId: invoiceSub ?? undefined,
          invoice: {
            id: invoiceId,
            status: "void",
            amountDueCents,
            periodStart,
            periodEnd,
            dueDate,
            hostedUrl,
          },
          extra: {
            "Cancelled by": admin.email,
            ...(reason ? { Reason: reason } : {}),
          },
        }
      );
    }

    // Activity-stream note — best-effort; the cancel already stuck.
    // Month named the way the schedule names it: the billing-cycle
    // date's month, in UTC.
    const monthLabel = new Date(
      periodEnd || periodStart || now
    ).toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
    const money = `$${(amountDueCents / 100).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
    const summary =
      path === "finalized_then_voided"
        ? `Cancelled the ${monthLabel} tuition invoice (${money}) before it was sent — voided in Stripe without emailing the family. Later months continue as scheduled.`
        : path === "already_void"
          ? `Recorded the ${monthLabel} tuition invoice (${money}) as cancelled — it had already been voided in Stripe.`
          : `Cancelled the ${monthLabel} tuition invoice (${money}) — voided in Stripe. The family will not be billed for this month; later months continue as scheduled.`;
    let noteWritten = true;
    try {
      await xano.adminNotes.create({
        registration_families_id: familyId,
        registration_students_id: null,
        registration_school_years_id: yearId,
        registration_student_registration_progress_id: null,
        registration_family_application_progress_id: null,
        author_email: admin.email,
        author_name: admin.name,
        body: reason ? `${summary}\nReason: ${reason}` : summary,
        category: "other",
        is_pinned: false,
        section: "billing",
        is_shared_with_parent: false,
      });
    } catch (err) {
      noteWritten = false;
      console.error(
        `[cancel-invoice] note failed for family ${familyId} / ${invoiceId}:`,
        err
      );
    }

    return NextResponse.json({
      ok: true,
      path,
      status: "void",
      amountDueCents,
      mirrorSynced,
      noteWritten,
    });
  } catch (err) {
    return handleAdminError(err);
  }
}

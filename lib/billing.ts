import type Stripe from "stripe";
import { xano } from "@/lib/xano";
import {
  createSubscriptionWithStudentItems,
  getOrCreateCustomer,
} from "@/lib/stripe";

/**
 * Server-side billing orchestration. Called from two places:
 *
 *   1. Admin family billing route — when admin clicks "Start Monthly
 *      Billing" on the Billing card (manual override path).
 *   2. Admin registration-progress route — auto-cascade on
 *      `isRegistrationConfirmed=true`. Confirming a family's
 *      registration also kicks off billing without an extra click.
 *
 * Builds one Stripe Subscription per family with one
 * SubscriptionItem per active student — each student's
 * `monthly_amount` becomes its own line on the family's monthly
 * invoice. Removing a student later (via unenroll) deletes just
 * their item; if it was the last item, the subscription cancels
 * at period end.
 *
 * Idempotent: returns the existing Subscription if one already lives
 * on the family-payment row. Repeated cascade firings don't
 * double-bill.
 *
 * Throws `BillingPreconditionError` for fixable caller-side issues
 * (missing per-student monthly amount, no primary parent email,
 * no active students). The route / cascade catches and surfaces
 * these to admin.
 */

export class BillingPreconditionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BillingPreconditionError";
  }
}

export interface StartBillingResult {
  subscription: Stripe.Subscription;
  /** True if we created a new subscription on this call. False if a
   *  subscription already existed on the family-payment row and we
   *  returned it unchanged. */
  created: boolean;
}

export async function startMonthlyBilling({
  familyId,
  yearId,
}: {
  familyId: number;
  yearId: number;
}): Promise<StartBillingResult> {
  // Parallel fetch — family + per-year payment row + school year +
  // all parents + the registration-progress latch + students for
  // archive-state + applications for active filter + packets for
  // per-student monthly amounts. All independent reads, no shape
  // dependencies between them, so one Promise.all keeps the round-
  // trip latency flat.
  const [
    family,
    payment,
    year,
    parents,
    regProgress,
    students,
    apps,
    yearPackets,
  ] = await Promise.all([
    xano.families.getById(familyId),
    xano.familyPayments.getByFamilyAndYear(familyId, yearId),
    xano.schoolYears.getById(yearId),
    xano.parents.getAll(),
    xano.studentRegistrationProgress.getByFamilyAndYear(familyId, yearId),
    xano.students.getByFamilyId(familyId),
    xano.applications.getByFamilyId(familyId),
    xano.studentRegistration.getByYear(yearId),
  ]);

  if (!family) {
    throw new BillingPreconditionError(`Family ${familyId} not found.`);
  }
  if (!year) {
    throw new BillingPreconditionError(`School year ${yearId} not found.`);
  }
  // Registration must be confirmed before billing starts — billing
  // commits the family to a recurring Stripe charge, and we don't
  // want that side-effect firing on a family who hasn't completed
  // the registration packet + been admin-confirmed yet. UI gates
  // the button too (BillingCard receives the same flag), but
  // enforcing it server-side closes the manual-API loophole.
  if (regProgress?.isRegistrationConfirmed !== true) {
    throw new BillingPreconditionError(
      "Family registration isn't confirmed yet — confirm registration before starting monthly billing."
    );
  }

  // Active-student gating. A student counts as billable if they're
  // not archived on the evergreen `registration_students` row AND
  // their per-year `registration_application` row is `isActive`
  // (the soft-delete flag parents flip when they remove a student
  // from a year). Cross-referenced both ways so an archived student
  // with a dangling app row doesn't sneak in, and an un-archived
  // student without an app row for this year doesn't either.
  const familyStudentById = new Map(
    students.filter((s) => !s.isArchived).map((s) => [s.id, s])
  );
  const activeStudentIds = new Set<number>();
  for (const app of apps) {
    if (Number(app.registration_school_years_id) !== yearId) continue;
    if (app.isActive === false) continue;
    const sid = Number(app.registration_students_id);
    if (familyStudentById.has(sid)) activeStudentIds.add(sid);
  }

  // Packet rows scoped to this family's active students for this
  // year — one packet per student. Sort by student id for
  // deterministic Stripe Price creation order so dashboard scans
  // line up across families with the same student order.
  const activePackets = yearPackets
    .filter((p) => activeStudentIds.has(Number(p.registration_students_id)))
    .sort(
      (a, b) =>
        Number(a.registration_students_id) -
        Number(b.registration_students_id)
    );

  if (activePackets.length === 0) {
    throw new BillingPreconditionError(
      "No active students with registration packets for this year."
    );
  }

  // Per-student amount validation. Every packet must carry a
  // `monthly_amount` written by the Scholarship Determination card
  // (or admin's manual entry on the per-student tuition flow).
  // Rather than billing a wrong amount silently, refuse to create
  // the subscription until the column is populated.
  const missing: string[] = [];
  for (const packet of activePackets) {
    const sid = Number(packet.registration_students_id);
    const monthly = packet.monthly_amount;
    if (typeof monthly !== "number" || monthly <= 0) {
      const student = familyStudentById.get(sid);
      const name = student
        ? `${student.first_name ?? ""} ${student.last_name ?? ""}`.trim() ||
          `Student #${sid}`
        : `Student #${sid}`;
      missing.push(name);
    }
  }
  if (missing.length > 0) {
    throw new BillingPreconditionError(
      `Per-student monthly amount not set for: ${missing.join(", ")}. ` +
        `Set the tuition on the Scholarship Determination card before starting billing.`
    );
  }

  // Idempotency: if a subscription id already lives on the family-
  // payment row, return it. Catches admin double-clicks and the
  // reconfirm-after-unconfirm cascade — neither should create a
  // parallel subscription.
  if (payment?.stripe_subscription_id) {
    const { getBillingSnapshot } = await import("@/lib/stripe");
    const snapshot = await getBillingSnapshot(payment.stripe_subscription_id);
    return { subscription: snapshot.subscription, created: false };
  }

  // Primary parent — lowest id wins, matching how every other admin
  // surface picks a primary for display + invoice email routing.
  const familyParentIds = xano.families.getParentIds(family);
  const familyParents = parents
    .filter((p) => familyParentIds.includes(p.id))
    .sort((a, b) => a.id - b.id);
  const primaryParent = familyParents[0] ?? null;
  if (!primaryParent?.email) {
    throw new BillingPreconditionError(
      "No primary parent email on file. Stripe needs an address to email the invoice."
    );
  }
  const primaryParentName =
    `${primaryParent.first_name ?? ""} ${primaryParent.last_name ?? ""}`.trim() ||
    family.family_name;

  // Get-or-create Customer (one per family, shared across years).
  // Persist new ids back to Xano immediately so a retry-after-failure
  // path doesn't double-create.
  const { customer, created: customerCreated } = await getOrCreateCustomer({
    customerId: family.stripe_customer_id ?? null,
    familyName: family.family_name,
    primaryParentEmail: primaryParent.email,
    primaryParentName,
    familyId,
  });
  if (customerCreated) {
    try {
      await xano.families.update(familyId, {
        stripe_customer_id: customer.id,
      });
    } catch (err) {
      // Best-effort — webhook handler also persists this on
      // subscription.created. Log + continue.
      console.error(
        `[startMonthlyBilling] failed to persist stripe_customer_id on family ${familyId}:`,
        err
      );
    }
  }

  // Build per-student item input for the Stripe helper. Each item
  // becomes one SubscriptionItem with a one-off Price nicknamed
  // `<Family> — <Student> — <Year>` for Dashboard scanability and
  // a `description` of `<Student> — Monthly tuition` for the
  // parent's invoice line.
  const studentItems = activePackets.map((packet) => {
    const sid = Number(packet.registration_students_id);
    const student = familyStudentById.get(sid);
    const studentName = student
      ? `${student.first_name ?? ""} ${student.last_name ?? ""}`.trim() ||
        `Student #${sid}`
      : `Student #${sid}`;
    const monthlyCents = Math.round((packet.monthly_amount ?? 0) * 100);
    return { studentId: sid, studentName, monthlyCents };
  });

  const result = await createSubscriptionWithStudentItems({
    customerId: customer.id,
    familyName: family.family_name,
    yearName: year.year_name,
    students: studentItems,
    billingStartDate: year.billing_start_date ?? null,
    familyId,
    yearId,
  });

  // Persist the family-level subscription id onto the family-payment
  // row. Create the row first if it doesn't exist (rare — the
  // Approve flow normally creates it earlier — but fail-safe so the
  // subscription id always has a home).
  const paymentRowId = await ensureFamilyPaymentRow(payment, familyId, yearId);
  try {
    await xano.familyPayments.update(paymentRowId, {
      stripe_subscription_id: result.subscription.id,
    });
  } catch (err) {
    // Subscription was created in Stripe — if the Xano write fails
    // we'd be in an inconsistent state. Log loudly so admin sees
    // it; the webhook will retry the persist on its end.
    console.error(
      `[startMonthlyBilling] failed to persist stripe_subscription_id ${result.subscription.id} on payment row ${paymentRowId}:`,
      err
    );
  }

  // Persist each student's SubscriptionItem id onto its packet row.
  // Best-effort per packet — if one write fails the others should
  // still land; the failed packet's bill is still LIVE in Stripe,
  // we just don't have the local handle to remove it later. Logged
  // loudly so admin can reconcile from the Stripe Dashboard.
  await Promise.allSettled(
    result.items.map(async (item) => {
      const packet = activePackets.find(
        (p) => Number(p.registration_students_id) === item.studentId
      );
      if (!packet) return;
      try {
        await xano.studentRegistration.update(packet.id, {
          stripe_subscription_item_id: item.subscriptionItemId,
        });
      } catch (err) {
        console.error(
          `[startMonthlyBilling] failed to persist stripe_subscription_item_id ${item.subscriptionItemId} on packet ${packet.id} (student ${item.studentId}):`,
          err
        );
      }
    })
  );

  return { subscription: result.subscription, created: true };
}

/**
 * Ensure a `registration_families_payment` row exists for this
 * (family, year) and return its id. If one already exists, returns
 * that id unchanged. Otherwise creates a minimal row carrying just
 * the family/year pointers + acceptance flag — the per-student
 * tuition columns moved to `registration_student_registration` so
 * this row no longer needs them.
 */
async function ensureFamilyPaymentRow(
  existing: Awaited<
    ReturnType<typeof xano.familyPayments.getByFamilyAndYear>
  >,
  familyId: number,
  yearId: number
): Promise<number> {
  if (existing) return existing.id;
  const created = await xano.familyPayments.create({
    registration_families_id: familyId,
    registration_school_years_id: yearId,
    isFamilyAccepted: true,
    signature: {},
    name: "",
    signature_data: null,
    enrollment_agreement_pandadoc_id: "",
    enrollment_agreement_status: "",
    enrollment_agreement_sent_at: null,
    enrollment_agreement_pdf_url: "",
    is_enrollment_agreement_signed: false,
  });
  return created.id;
}

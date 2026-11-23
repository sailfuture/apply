import type Stripe from "stripe";
import {
  xano,
  activeStripeSubscriptionId,
  liveStripeSubscriptionItemId,
  type XanoApplication,
} from "@/lib/xano";
import {
  addStudentItemToSubscription,
  createSubscriptionWithStudentItems,
  getBillingSnapshot,
  getOrCreateCustomer,
  uncancelSubscription,
  yearRuleFirstInvoiceMs,
} from "@/lib/stripe";
import { sendBillingAlert } from "@/lib/billing-alerts";
import { enableAutopay } from "@/lib/autopay";
import { isPendingMidYearAddition } from "@/lib/midyear-additions";
import {
  FULL_YEAR_PAYMENTS,
  billingSlotAt,
  monthlyForPlan,
  paymentsFrom,
  planFirstMonthLabel,
  planFirstSlotStartMs,
  planIsDue,
  planRangeLabel,
  storedPaymentCount,
} from "@/lib/payment-plan";
import { resolveStudentReceiptAmounts } from "@/lib/student-receipt";

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
  /** Students whose monthly amount moved because their payment plan
   *  was set (or shortened) as billing started. Empty when every
   *  student was billed the amount already on file. */
  planChanges: PaymentPlanChange[];
  /** Students left off the invoice for now: their first payment month
   *  hasn't come. The daily job adds each one when it opens
   *  (`addStudentsDueForBilling`). Empty when everyone is billed. */
  scheduled: ScheduledStudent[];
}

/**
 * A student whose payments start in a later month than the invoice the
 * family is on. Siblings share one invoice, not a start month: a
 * student starting in January is not billed in November because a
 * sibling is (`lib/payment-plan.ts`, "One invoice, each student from
 * their own month").
 */
export interface ScheduledStudent {
  studentId: number;
  studentName: string;
  /** Payments on their plan. */
  count: number;
  monthlyAmount: number;
  /** "January 2027": the month of their first payment. Null when the
   *  year has no billing calendar to name it from. */
  firstMonthLabel: string | null;
}

/** A student put on a subscription that was already running. */
export interface AddedStudent {
  studentId: number;
  studentName: string;
  /** Payments their yearly amount is spread over, from the next invoice. */
  count: number;
  monthlyAmount: number;
}

/** A student's payment plan as (re)set when their billing started. */
export interface PaymentPlanChange {
  studentId: number;
  studentName: string;
  /** Payments the amount on file was spread over. */
  fromCount: number;
  toCount: number;
  fromMonthly: number;
  toMonthly: number;
}

const usd = (value: number) =>
  value.toLocaleString("en-US", { style: "currency", currency: "USD" });

/** The yearly amount a student's plan divides: the stored subtotal,
 *  or the stored remaining amount + fee for a row without one. */
function annualFamilyPaid(app: XanoApplication): number {
  return typeof app.tuition_sub_total === "number" &&
    Number.isFinite(app.tuition_sub_total)
    ? app.tuition_sub_total
    : resolveStudentReceiptAmounts(app).subtotal;
}

/**
 * Put a student who has never been billed on a `count`-payment plan,
 * so the yearly amount they owe is collected by the last month of the
 * billing year. Returns the row as it now stands and, when the monthly
 * amount moved, what changed.
 *
 * Runs BEFORE anything is sent to Stripe: a save that doesn't land
 * throws, so a family is never invoiced an amount the app doesn't
 * show. Never called for a student with billing history: their plan
 * is already in motion and re-dividing the full yearly amount would
 * charge them for months they have paid.
 */
async function stampPaymentPlan(
  app: XanoApplication,
  count: number,
  studentName: string
): Promise<{ app: XanoApplication; change: PaymentPlanChange | null }> {
  const stored = storedPaymentCount(app.payment_count);
  if (stored === count) return { app, change: null };

  const divisor = stored ?? FULL_YEAR_PAYMENTS;
  if (count === divisor) {
    // A row saved before plans existed, already priced over 12 and
    // starting on a 12-payment plan: record the plan, leave the amount
    // alone. Not worth failing a billing start over.
    try {
      await xano.applications.update(app.id, { payment_count: count });
    } catch (err) {
      console.error(
        `[stampPaymentPlan] couldn't record payment_count ${count} on application ${app.id}:`,
        err
      );
    }
    return { app: { ...app, payment_count: count }, change: null };
  }

  const annual = annualFamilyPaid(app);
  const fromMonthly = app.monthly_amount ?? 0;
  // The new monthly is the yearly amount over the new count. If the
  // amount on file isn't the yearly amount over the OLD count, someone
  // set it by hand and re-dividing would silently discard that.
  if (Math.abs(fromMonthly - monthlyForPlan(annual, divisor)) > 0.011) {
    throw new BillingPreconditionError(
      `${studentName}'s monthly amount (${usd(fromMonthly)}) isn't their yearly amount (${usd(annual)}) spread over ${divisor} payments, so their payment plan can't be set automatically. Re-save their amounts on the Scholarship Determination card, then start billing.`
    );
  }
  const toMonthly = monthlyForPlan(annual, count);
  const updated = await xano.applications.update(app.id, {
    payment_count: count,
    monthly_amount: toMonthly,
  });
  // Xano drops inputs it treats as empty instead of erroring; billing
  // an amount the row doesn't hold is worse than not billing.
  if (
    storedPaymentCount(updated.payment_count) !== count ||
    Math.abs(Number(updated.monthly_amount ?? Number.NaN) - toMonthly) > 0.005
  ) {
    throw new Error(
      `The payment plan for ${studentName} (application ${app.id}) didn't save, so billing wasn't started. Try again.`
    );
  }
  return {
    app: { ...app, payment_count: count, monthly_amount: toMonthly },
    change: {
      studentId: Number(app.registration_students_id),
      studentName,
      fromCount: divisor,
      toCount: count,
      fromMonthly,
      toMonthly,
    },
  };
}

/** What staff are told about a student left off the invoice for now. */
function scheduledStudentOf(
  app: XanoApplication,
  studentName: string,
  billingStartDate: string | null
): ScheduledStudent {
  const count = storedPaymentCount(app.payment_count) ?? FULL_YEAR_PAYMENTS;
  return {
    studentId: Number(app.registration_students_id),
    studentName,
    count,
    monthlyAmount: app.monthly_amount ?? 0,
    firstMonthLabel: planFirstMonthLabel(billingStartDate, count),
  };
}

/** When (unix ms) a live subscription sends its next invoice, read off
 *  the subscription itself. Null when Stripe's object doesn't say. */
function nextInvoiceMsOf(subscription: Stripe.Subscription): number | null {
  const nowUnix = Math.floor(Date.now() / 1000);
  if (subscription.status === "trialing" && subscription.trial_end) {
    return subscription.trial_end * 1000;
  }
  if (subscription.billing_cycle_anchor > nowUnix) {
    return subscription.billing_cycle_anchor * 1000;
  }
  // Billing periods live on the items (flexible billing mode has no
  // subscription-level current_period_end).
  const cycleEnd = subscription.items.data[0]?.current_period_end;
  return cycleEnd && cycleEnd > nowUnix ? cycleEnd * 1000 : null;
}

/**
 * Leave a line on the family's timeline when billing started on a
 * different monthly amount than the one on file. Best-effort: the
 * plan is saved and billing is going ahead either way.
 */
async function notePaymentPlanChanges(args: {
  familyId: number;
  yearId: number;
  yearName: string;
  billingStartDate: string | null;
  changes: PaymentPlanChange[];
}): Promise<void> {
  if (args.changes.length === 0) return;
  try {
    const lines = args.changes.map((c) => {
      const range = planRangeLabel(args.billingStartDate, c.toCount);
      return `${c.studentName}: ${c.toCount} monthly payment${c.toCount === 1 ? "" : "s"} of ${usd(c.toMonthly)}${range ? ` (${range})` : ""}. Was ${usd(c.fromMonthly)} over ${c.fromCount}.`;
    });
    await xano.adminNotes.create({
      registration_families_id: args.familyId,
      registration_students_id:
        args.changes.length === 1 ? args.changes[0].studentId : null,
      registration_school_years_id: args.yearId,
      registration_student_registration_progress_id: null,
      registration_family_application_progress_id: null,
      author_email: "",
      author_name: "Apply (automatic)",
      body: [
        `Payment plan set as monthly billing started (${args.yearName}). The yearly amount is unchanged; it is spread over the payments left in the billing year.`,
        ...lines,
      ].join("\n"),
      category: "other",
      is_pinned: false,
      section: "billing",
      is_shared_with_parent: false,
    });
  } catch (err) {
    console.error(
      `[notePaymentPlanChanges] timeline note failed (family ${args.familyId}, year ${args.yearId}):`,
      err
    );
  }
}

/**
 * Record on the family's timeline that a student was left off the
 * invoice until their own first payment month. Written once, when the
 * family's billing is created: it is the only trace, until that month,
 * of why a confirmed student isn't on the subscription. Best-effort.
 */
async function noteScheduledStudents(args: {
  familyId: number;
  yearId: number;
  yearName: string;
  scheduled: ScheduledStudent[];
}): Promise<void> {
  if (args.scheduled.length === 0) return;
  try {
    const lines = args.scheduled.map(
      (s) =>
        `${s.studentName}: ${s.count} monthly payment${s.count === 1 ? "" : "s"} of ${usd(s.monthlyAmount)}, starting ${s.firstMonthLabel ?? "later this year"}.`
    );
    await xano.adminNotes.create({
      registration_families_id: args.familyId,
      registration_students_id:
        args.scheduled.length === 1 ? args.scheduled[0].studentId : null,
      registration_school_years_id: args.yearId,
      registration_student_registration_progress_id: null,
      registration_family_application_progress_id: null,
      author_email: "",
      author_name: "Apply (automatic)",
      body: [
        `Monthly billing started (${args.yearName}) without the student${args.scheduled.length === 1 ? "" : "s"} below, whose first payment is a later month. Each is added to the family's invoice automatically when that month opens.`,
        ...lines,
      ].join("\n"),
      category: "other",
      is_pinned: false,
      section: "billing",
      is_shared_with_parent: false,
    });
  } catch (err) {
    console.error(
      `[noteScheduledStudents] timeline note failed (family ${args.familyId}, year ${args.yearId}):`,
      err
    );
  }
}

/**
 * In-process guard against concurrent starts for the same
 * (family, year) — an admin double-click or two admins racing get the
 * SAME in-flight promise instead of two subscription creations. The
 * Stripe idempotency keys below cover the cross-instance case; this
 * map covers the (far more likely) same-instance one.
 */
const inFlightStarts = new Map<string, Promise<StartBillingResult>>();

export function startMonthlyBilling(args: {
  familyId: number;
  yearId: number;
}): Promise<StartBillingResult> {
  const key = `${args.familyId}:${args.yearId}`;
  const existing = inFlightStarts.get(key);
  if (existing) return existing;
  const run = startMonthlyBillingInner(args).finally(() => {
    inFlightStarts.delete(key);
  });
  inFlightStarts.set(key, run);
  return run;
}

async function startMonthlyBillingInner({
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
    // STRICT lookup — a transient Xano failure must THROW here, not
    // coerce to null: null means "no subscription yet" and sends us
    // down the create path, so a swallowed error would mint a second
    // live subscription (double billing) plus a duplicate payment row.
    xano.familyPayments.getByFamilyAndYearStrict(familyId, yearId),
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
  // Active applications for this family + year. Application row is
  // the source of truth for per-student billing math (monthly_amount,
  // etc.) — the packet only carries the Stripe-side
  // `stripe_subscription_item_id` link after billing starts. Sort by
  // student id for deterministic Stripe Price creation order so
  // Dashboard scans line up across families with the same student
  // order.
  //
  // A pending mid-year addition (student added after the family
  // enrolled, packet not yet admin-confirmed) isn't billable yet —
  // admin may have saved their tuition while reviewing them, and
  // billing must wait for the packet confirm.
  const confirmedStudentIds = new Set(
    yearPackets
      .filter((p) => p.registrationConfirmed === true)
      .map((p) => Number(p.registration_students_id))
  );
  const activeApps = apps
    .filter(
      (app) =>
        Number(app.registration_school_years_id) === yearId &&
        app.isActive !== false &&
        familyStudentById.has(Number(app.registration_students_id)) &&
        !isPendingMidYearAddition(
          app,
          confirmedStudentIds.has(Number(app.registration_students_id))
        )
    )
    .sort(
      (a, b) =>
        Number(a.registration_students_id) -
        Number(b.registration_students_id)
    );

  if (activeApps.length === 0) {
    throw new BillingPreconditionError(
      "No active students with applications for this year."
    );
  }

  // Per-student amount validation. Every application must carry a
  // `monthly_amount` written by the Scholarship Determination card
  // (or admin's manual entry on the per-student tuition flow).
  // Rather than billing a wrong amount silently, refuse to create
  // the subscription until the column is populated.
  const missing: string[] = [];
  for (const app of activeApps) {
    const sid = Number(app.registration_students_id);
    const monthly = app.monthly_amount;
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

  // Packets keyed by student id. Each active student should have a
  // packet (created by the acceptance cascade); we look these up to
  // store the Stripe SubscriptionItem id on each. Missing packet
  // here is a defensive case — we'll skip the persist with a loud
  // log rather than fail the entire billing start.
  const packetByStudent = new Map(
    yearPackets.map((p) => [Number(p.registration_students_id), p])
  );

  // Idempotency: if a LIVE subscription already exists on the family-
  // payment row, reconcile its items against the current active
  // students and return it — never create a parallel subscription.
  //
  // Three sub-cases:
  //   - id resolves to a live subscription → reconcile (a student
  //     accepted after billing started gets their item added here —
  //     previously they were silently never billed) and return it.
  //   - id resolves to a CANCELED subscription, or Stripe says the id
  //     no longer exists → the stored id is stale. Fall through and
  //     create a fresh subscription (the "restart after cancel" path
  //     that a stale id used to permanently block).
  //   - `canceled:` sentinel / empty → no subscription; create.
  const existingSubId = activeStripeSubscriptionId(
    payment?.stripe_subscription_id
  );
  if (existingSubId) {
    let snapshot: Awaited<ReturnType<typeof getBillingSnapshot>> | null =
      null;
    try {
      snapshot = await getBillingSnapshot(existingSubId);
    } catch (err) {
      const code = (err as { code?: string; statusCode?: number }) ?? {};
      const missing =
        code.code === "resource_missing" || code.statusCode === 404;
      if (!missing) throw err; // transient Stripe failure — surface it
      console.warn(
        `[startMonthlyBilling] stored subscription ${existingSubId} no longer exists in Stripe (family=${familyId}, year=${yearId}) — creating a fresh one.`
      );
    }
    if (snapshot && snapshot.subscription.status !== "canceled") {
      // A pending cancel_at_period_end with active billable students
      // means admin is (re)starting billing for a family that was on
      // the way out — clear the pending cancel or the items we add
      // below die with the subscription at period end.
      if (snapshot.subscription.cancel_at_period_end) {
        await uncancelSubscription(existingSubId);
      }
      const reconciled = await reconcileSubscriptionItems({
        subscription: snapshot.subscription,
        familyId,
        yearId,
        familyName: family.family_name,
        yearName: year.year_name,
        billingStartDate: year.billing_start_date ?? null,
        activeApps,
        familyStudentById,
        packetByStudent,
      });
      // Re-read so the returned subscription reflects any items the
      // reconcile just added.
      const refreshed = await getBillingSnapshot(existingSubId);
      return {
        subscription: refreshed.subscription,
        created: false,
        planChanges: reconciled.planChanges,
        scheduled: reconciled.scheduled,
      };
    }
  }

  // ─── Payment plan ─── What each student owes for the year is spread
  // over the payments from their first payment month through the end
  // of the billing year (`lib/payment-plan.ts`). Settled here, before
  // anything reaches Stripe, so the amounts invoiced are the amounts on
  // file.
  //
  // Siblings share the invoice, not the start month. The subscription
  // is created for the students whose first payment comes first; one
  // whose month is later is left off (`scheduled`) and added when it
  // opens, so a January starter isn't billed in November because a
  // sibling is.
  const billingStartDate = year.billing_start_date ?? null;
  const nameOf = (app: XanoApplication) => {
    const sid = Number(app.registration_students_id);
    const student = familyStudentById.get(sid);
    return (
      (student
        ? `${student.first_name ?? ""} ${student.last_name ?? ""}`.trim()
        : "") || `Student #${sid}`
    );
  };
  // Never billed = no Stripe item handle on the packet, live or since
  // removed. A family with ANY billing history (a restart after a
  // cancel) keeps the year-level timing: "invoice now" could charge a
  // month they have already paid.
  const neverBilled = (app: XanoApplication) =>
    !packetByStudent.get(Number(app.registration_students_id))
      ?.stripe_subscription_item_id;
  const firstTimeFamily = activeApps.every(neverBilled);

  let firstInvoice: "now" | number | undefined;
  /** Payments on the subscription being created: the plan of the
   *  never-billed students whose first payment comes first. */
  let planCount: number;
  if (firstTimeFamily) {
    const nowMs = Date.now();
    const slotNow = billingSlotAt(billingStartDate, nowMs);
    // The longest plan still possible: first payment this month.
    const openCount = paymentsFrom(billingStartDate, nowMs);
    if (openCount < FULL_YEAR_PAYMENTS) {
      // Starting partway through the year on amounts saved before
      // plans existed: those were priced over 12, and whether the
      // typed amount was meant to be re-spread is the school's call,
      // not a guess to make while creating a subscription.
      const unplanned = activeApps.filter(
        (app) => storedPaymentCount(app.payment_count) == null
      );
      if (unplanned.length > 0) {
        throw new BillingPreconditionError(
          `No payment plan is set for: ${unplanned.map(nameOf).join(", ")}. ` +
            `This family is starting partway through the billing year, so choose each student's first payment month on the Scholarship Determination card, then start billing.`
        );
      }
    }
    // A plan whose first month has passed moves to the longest one
    // left; a plan that starts later than this month is kept.
    const plans = activeApps.map((app) => ({
      app,
      count: Math.min(
        storedPaymentCount(app.payment_count) ?? openCount,
        openCount
      ),
    }));
    // The longest of them is the earliest first payment: that is when
    // the family's invoices begin. Students on a shorter plan start
    // later and are held back below.
    planCount = Math.max(...plans.map((p) => p.count));
    const planStartMs = planFirstSlotStartMs(billingStartDate, planCount);
    if (slotNow == null || (slotNow < 0 && planCount === FULL_YEAR_PAYMENTS)) {
      // No billing calendar, or a full-year plan set up before the
      // year opens: the year-level rule (first invoice on the billing
      // start date), exactly as before plans existed.
      firstInvoice = undefined;
    } else if (planCount === openCount || planStartMs == null) {
      // The enrollment month is the first payment.
      firstInvoice = "now";
    } else {
      // First payment is a later month: hold the first invoice until
      // it opens (05:00 UTC, about midnight Eastern, so it is dated
      // the 1st on the school's calendar).
      firstInvoice = Math.floor(planStartMs / 1000) + 5 * 60 * 60;
    }
  } else {
    firstInvoice = undefined;
    planCount = paymentsFrom(
      billingStartDate,
      yearRuleFirstInvoiceMs(billingStartDate, year.start_date ?? null)
    );
  }

  const planChanges: PaymentPlanChange[] = [];
  const scheduled: ScheduledStudent[] = [];
  const billableApps: XanoApplication[] = [];
  for (const app of activeApps) {
    if (!neverBilled(app)) {
      billableApps.push(app);
      continue;
    }
    // First payment is a later month than this subscription's first
    // invoice: not on it yet. Their row is left exactly as saved.
    if (!planIsDue(app.payment_count, planCount)) {
      scheduled.push(scheduledStudentOf(app, nameOf(app), billingStartDate));
      continue;
    }
    const stamped = await stampPaymentPlan(app, planCount, nameOf(app));
    billableApps.push(stamped.app);
    if (stamped.change) planChanges.push(stamped.change);
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
  // `<Family> — <Student> — <Year>` for Dashboard scanability; the
  // Price's product is named `<Student> — Monthly Tuition & Fees`
  // so the parent's invoice line shows the student. Monthly amount
  // sourced from the application row.
  const studentItems = billableApps.map((app) => {
    const monthlyCents = Math.round((app.monthly_amount ?? 0) * 100);
    return {
      studentId: Number(app.registration_students_id),
      studentName: nameOf(app),
      monthlyCents,
    };
  });

  const result = await createSubscriptionWithStudentItems({
    customerId: customer.id,
    familyName: family.family_name,
    yearName: year.year_name,
    students: studentItems,
    billingStartDate,
    // First day of school — the pivot of the year-level rule, which
    // only times the first invoice when `firstInvoice` is left out (a
    // family with billing history, or a full-year plan set up before
    // the year opens).
    yearStartDate: year.start_date ?? null,
    firstInvoice,
    familyId,
    yearId,
    // Deterministic per (family, year, prior-subscription-state, item
    // composition, first-invoice timing): concurrent/retried starts
    // collapse onto the same Stripe objects instead of
    // double-subscribing, while a legitimate restart after a cancel
    // (different prior state) or a changed roster/amount (different
    // item signature) gets fresh keys — reusing a key with DIFFERENT
    // params would make Stripe reject the call with an idempotency
    // conflict.
    idempotencyKeyBase: `tuition:f${familyId}:y${yearId}:prev-${payment?.stripe_subscription_id ?? "none"}:i${itemsSignature(studentItems)}${firstInvoice === undefined ? "" : `:fi-${firstInvoice}`}`,
  });

  await notePaymentPlanChanges({
    familyId,
    yearId,
    yearName: year.year_name,
    billingStartDate,
    changes: planChanges,
  });
  await noteScheduledStudents({
    familyId,
    yearId,
    yearName: year.year_name,
    scheduled,
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
      const packet = packetByStudent.get(item.studentId);
      if (!packet) {
        // Packet should exist (created by the acceptance cascade) —
        // log so we can reconcile from the Dashboard if the cascade
        // ever missed a student.
        console.error(
          `[startMonthlyBilling] no packet found for student ${item.studentId}; can't persist stripe_subscription_item_id ${item.subscriptionItemId}. Reconcile from Stripe Dashboard.`
        );
        return;
      }
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

  // Autopay is on by default: a returning family whose card is already
  // on the customer starts on it (lib/autopay.ts; a no-op without a
  // saved payment method or after the family turned it off). Never
  // fails the billing start. The daily sweep retries.
  try {
    await enableAutopay({ familyId, yearId, source: "default" });
  } catch (err) {
    console.error(
      `[startMonthlyBilling] autopay default failed for family ${familyId}, year ${yearId}:`,
      err
    );
  }

  return {
    subscription: result.subscription,
    created: true,
    planChanges,
    scheduled,
  };
}

/**
 * Ensure a `registration_families_payment` row exists for this
 * (family, year) and return its id. If one already exists, returns
 * that id unchanged. Otherwise creates a minimal row carrying just
 * the family/year pointers + acceptance flag — the per-student
 * tuition columns moved to `registration_student_registration` so
 * this row no longer needs them.
 */
interface ReconcileContext {
  subscription: Stripe.Subscription;
  familyId: number;
  yearId: number;
  familyName: string;
  yearName: string;
  /** The year's `billing_start_date`: anchors the month slots a
   *  first-time student's payments are counted on. */
  billingStartDate: string | null;
  activeApps: Awaited<ReturnType<typeof xano.applications.getByFamilyId>>;
  familyStudentById: Map<
    number,
    Awaited<ReturnType<typeof xano.students.getByFamilyId>>[number]
  >;
  packetByStudent: Map<
    number,
    Awaited<ReturnType<typeof xano.studentRegistration.getByYear>>[number]
  >;
  /** When set, only these students may be ADDED. The daily job passes
   *  the students whose month has opened, so its run can't sweep up
   *  anyone else who happens to be off the subscription. */
  onlyStudentIds?: ReadonlySet<number>;
}

/** What a reconcile did to a live subscription. */
interface ReconcileOutcome {
  added: number;
  addedStudents: AddedStudent[];
  planChanges: PaymentPlanChange[];
  /** Left off for now: first payment month hasn't come. */
  scheduled: ScheduledStudent[];
}

/**
 * Bring a live subscription's per-student items in line with the
 * family's CURRENT active applications. For every active app whose
 * packet has no `stripe_subscription_item_id`:
 *
 *   - if Stripe already carries an item stamped with this student's
 *     id (a prior persist failed), heal the local handle;
 *   - otherwise add a fresh SubscriptionItem at the student's
 *     `monthly_amount` and persist the handle.
 *
 * This closes the worst silent under-billing gap: a student accepted
 * (or re-enrolled/reactivated) AFTER billing started previously had
 * no code path that ever added their Stripe item — every admin
 * surface showed the higher intended total while Stripe kept
 * invoicing the stale item set. Returns how many items were added.
 *
 * A student who has NEVER been billed (a sibling added mid-year) is
 * put on a payment plan first: an added item is first charged on the
 * subscription's next invoice, so their yearly amount is spread over
 * the invoices from that one through the end of the billing year. A
 * student with billing history (un-archived, reactivated) is re-added
 * at the amount on file — re-dividing their full yearly amount would
 * charge them again for months they have paid.
 *
 * A never-billed student whose own first payment month is LATER than
 * the next invoice is not added: they come back as `scheduled`, and the
 * daily job adds them once the invoice before their month has gone out
 * (`addStudentsDueForBilling`). Siblings share an invoice, not a start
 * month.
 */
async function reconcileSubscriptionItems(
  ctx: ReconcileContext
): Promise<ReconcileOutcome> {
  const itemByStudent = new Map<number, string>();
  for (const item of ctx.subscription.items.data) {
    const sid = Number(item.metadata?.student_id);
    if (Number.isFinite(sid)) itemByStudent.set(sid, item.id);
  }
  const nextInvoiceMs = nextInvoiceMsOf(ctx.subscription);
  // Invoices this subscription still has to send this year, the next
  // one included. When Stripe doesn't say when that is, count from
  // today: a plan that hasn't opened by the calendar hasn't opened.
  const paymentsLeft = paymentsFrom(
    ctx.billingStartDate,
    nextInvoiceMs ?? Date.now()
  );

  let added = 0;
  const addedStudents: AddedStudent[] = [];
  const scheduled: ScheduledStudent[] = [];
  const planChanges: PaymentPlanChange[] = [];
  for (const listedApp of ctx.activeApps) {
    let app: XanoApplication = listedApp;
    const sid = Number(app.registration_students_id);
    const packet = ctx.packetByStudent.get(sid);
    const liveItemId = itemByStudent.get(sid) ?? null;
    const handle = liveStripeSubscriptionItemId(
      packet?.stripe_subscription_item_id
    );

    if (liveItemId) {
      // Student IS on the subscription. Heal a missing or stale
      // local handle, then move on — never double-add.
      if (packet && handle !== liveItemId) {
        try {
          await xano.studentRegistration.update(packet.id, {
            stripe_subscription_item_id: liveItemId,
          });
        } catch (err) {
          console.error(
            `[reconcileSubscriptionItems] failed to heal item handle ${liveItemId} onto packet ${packet.id} (student ${sid}):`,
            err
          );
        }
      }
      continue;
    }

    // No live item for this student. NOTE: a set-but-dead handle
    // (the item was deleted in the Stripe Dashboard, or a removal
    // raced) is STALE — trusting it here would skip the student and
    // silently never bill them again, so we fall through and re-add,
    // overwriting the stale handle on persist.
    if (typeof app.monthly_amount !== "number" || app.monthly_amount <= 0) {
      continue; // caller validates; defensive
    }

    const student = ctx.familyStudentById.get(sid);
    const studentName = student
      ? `${student.first_name ?? ""} ${student.last_name ?? ""}`.trim() ||
        `Student #${sid}`
      : `Student #${sid}`;

    const everBilled = Boolean(packet?.stripe_subscription_item_id);
    // First-time student whose own first payment month is later than
    // the next invoice: not yet. Adding the item now would bill them
    // a month (or several) before they start.
    if (!everBilled && !planIsDue(app.payment_count, paymentsLeft)) {
      scheduled.push(scheduledStudentOf(app, studentName, ctx.billingStartDate));
      continue;
    }
    if (ctx.onlyStudentIds && !ctx.onlyStudentIds.has(sid)) continue;

    // First-time student: count their payments from the invoice this
    // item first lands on. Throws (nothing added) if the plan can't be
    // saved, so they are never invoiced an amount the app doesn't show.
    if (!everBilled && nextInvoiceMs != null) {
      const stamped = await stampPaymentPlan(app, paymentsLeft, studentName);
      app = stamped.app;
      if (stamped.change) planChanges.push(stamped.change);
    }
    const monthly = app.monthly_amount ?? 0;

    const result = await addStudentItemToSubscription({
      subscriptionId: ctx.subscription.id,
      familyName: ctx.familyName,
      studentName,
      yearName: ctx.yearName,
      monthlyCents: Math.round(monthly * 100),
      studentId: sid,
      familyId: ctx.familyId,
      yearId: ctx.yearId,
    });
    added += 1;
    addedStudents.push({
      studentId: sid,
      studentName,
      count: storedPaymentCount(app.payment_count) ?? FULL_YEAR_PAYMENTS,
      monthlyAmount: monthly,
    });
    console.log(
      `[reconcileSubscriptionItems] added item ${result.subscriptionItemId} for student ${sid} ($${monthly}/mo) on subscription ${ctx.subscription.id}`
    );
    if (packet) {
      try {
        await xano.studentRegistration.update(packet.id, {
          stripe_subscription_item_id: result.subscriptionItemId,
        });
      } catch (err) {
        console.error(
          `[reconcileSubscriptionItems] item ${result.subscriptionItemId} added in Stripe but handle persist failed for packet ${packet.id} (student ${sid}):`,
          err
        );
      }
    } else {
      console.error(
        `[reconcileSubscriptionItems] no packet for student ${sid}; item ${result.subscriptionItemId} added in Stripe without a local handle. Reconcile from the Dashboard if this student is later removed.`
      );
    }
  }
  await notePaymentPlanChanges({
    familyId: ctx.familyId,
    yearId: ctx.yearId,
    yearName: ctx.yearName,
    billingStartDate: ctx.billingStartDate,
    changes: planChanges,
  });
  return { added, addedStudents, planChanges, scheduled };
}

/**
 * In-process guard for the standalone reconcile — same rationale as
 * `inFlightStarts`: two cascades racing (or a cascade racing the
 * Start button's own reconcile) must not both decide a student is
 * missing and double-add their item. The idempotency keys inside
 * `addStudentItemToSubscription` cover the cross-instance case.
 */
const inFlightReconciles = new Map<string, Promise<FamilyReconcileResult>>();

/** What the standalone reconcile did. */
export interface FamilyReconcileResult {
  added: number;
  addedStudents: AddedStudent[];
  /** Left off for now: first payment month hasn't come. */
  scheduled: ScheduledStudent[];
}

const NOTHING_RECONCILED: FamilyReconcileResult = {
  added: 0,
  addedStudents: [],
  scheduled: [],
};

/**
 * Standalone reconcile for callers outside the Start button — the
 * un-archive and application-reactivate cascades, a mid-year
 * addition's confirm, and the daily job that adds a student whose
 * first payment month has opened. Loads its own context, no-ops when
 * the family has no live subscription for the year, and alerts staff
 * when an active student CAN'T be billed because their
 * `monthly_amount` isn't set (otherwise they'd sit silently unbilled
 * until someone noticed).
 *
 * `onlyStudentIds` limits which students may be added (see
 * `ReconcileContext`).
 */
export function reconcileFamilySubscriptionItems(
  familyId: number,
  yearId: number,
  opts: { onlyStudentIds?: number[] } = {}
): Promise<FamilyReconcileResult> {
  const only = opts.onlyStudentIds
    ? [...opts.onlyStudentIds].sort((a, b) => a - b)
    : null;
  // A limited run and a full one are different jobs, so they don't
  // share a promise. Should both decide to add the same student, the
  // idempotency keys in `addStudentItemToSubscription` make it one item.
  const key = `${familyId}:${yearId}:${only ? only.join(",") : "all"}`;
  const existing = inFlightReconciles.get(key);
  if (existing) return existing;
  const run = reconcileFamilySubscriptionItemsInner(
    familyId,
    yearId,
    only ? new Set(only) : undefined
  ).finally(() => {
    inFlightReconciles.delete(key);
  });
  inFlightReconciles.set(key, run);
  return run;
}

async function reconcileFamilySubscriptionItemsInner(
  familyId: number,
  yearId: number,
  onlyStudentIds?: ReadonlySet<number>
): Promise<FamilyReconcileResult> {
  const payment = await xano.familyPayments.getByFamilyAndYearStrict(
    familyId,
    yearId
  );
  const liveSubId = activeStripeSubscriptionId(
    payment?.stripe_subscription_id
  );
  if (!liveSubId) return NOTHING_RECONCILED;

  let snapshot: Awaited<ReturnType<typeof getBillingSnapshot>>;
  try {
    snapshot = await getBillingSnapshot(liveSubId);
  } catch (err) {
    const code = (err as { code?: string; statusCode?: number }) ?? {};
    if (code.code === "resource_missing" || code.statusCode === 404) {
      return NOTHING_RECONCILED;
    }
    throw err;
  }
  if (snapshot.subscription.status === "canceled") return NOTHING_RECONCILED;
  // The daily job never revives a subscription someone set to end: a
  // person asked for that, and re-enrolling the family is their call
  // (the cascades below clear the pending cancel because a person just
  // re-activated a student).
  if (onlyStudentIds && snapshot.subscription.cancel_at_period_end) {
    console.warn(
      `[reconcileFamilySubscriptionItems] subscription ${liveSubId} is set to end, so no student was added (family ${familyId}, year ${yearId}).`
    );
    return NOTHING_RECONCILED;
  }

  const [family, year, students, apps, yearPackets] = await Promise.all([
    xano.families.getById(familyId),
    xano.schoolYears.getById(yearId),
    xano.students.getByFamilyId(familyId),
    xano.applications.getByFamilyId(familyId),
    xano.studentRegistration.getByYear(yearId),
  ]);
  if (!family || !year) return NOTHING_RECONCILED;

  const familyStudentById = new Map(
    students.filter((s) => !s.isArchived).map((s) => [s.id, s])
  );
  const packetByStudent = new Map(
    yearPackets.map((p) => [Number(p.registration_students_id), p])
  );
  // Pending mid-year additions wait for their packet confirm — same
  // rule as `startMonthlyBilling` (and no "missing tuition" alert for
  // a student who isn't accepted yet).
  const activeApps = apps.filter(
    (app) =>
      Number(app.registration_school_years_id) === yearId &&
      app.isActive !== false &&
      familyStudentById.has(Number(app.registration_students_id)) &&
      !isPendingMidYearAddition(
        app,
        packetByStudent.get(Number(app.registration_students_id))
          ?.registrationConfirmed === true
      )
  );

  // A pending cancel with active students means the family is being
  // re-enrolled — clear it so re-added items don't die at period end.
  if (snapshot.subscription.cancel_at_period_end && activeApps.length > 0) {
    await uncancelSubscription(liveSubId);
  }

  // Active students with no LIVE item (per Stripe's own item set —
  // ground truth, not the local handle, which can be stale) AND no
  // billable amount would stay silently unbilled — that needs a human.
  const liveStudentIds = new Set(
    snapshot.subscription.items.data
      .map((i) => Number(i.metadata?.student_id))
      .filter((n) => Number.isFinite(n))
  );
  const unbillable = activeApps.filter((app) => {
    const sid = Number(app.registration_students_id);
    const monthly = app.monthly_amount;
    return (
      !liveStudentIds.has(sid) && !(typeof monthly === "number" && monthly > 0)
    );
  });
  // Not on the daily job's limited run: it is there for the students
  // it names, and would repeat this email every day it ran.
  if (unbillable.length > 0 && !onlyStudentIds) {
    await sendBillingAlert(
      "Active student(s) missing tuition amount",
      [
        `This family has a live subscription, but the ${unbillable.length} student(s) named above are active with no monthly tuition set — they are NOT being billed.`,
        `Set their tuition on the Scholarship Determination card, then click "Start Monthly Billing" to add them to the subscription.`,
      ],
      {
        familyId,
        yearId,
        studentIds: unbillable.map((a) => Number(a.registration_students_id)),
      }
    );
  }

  const { added, addedStudents, scheduled } = await reconcileSubscriptionItems({
    subscription: snapshot.subscription,
    familyId,
    yearId,
    familyName: family.family_name,
    yearName: year.year_name,
    billingStartDate: year.billing_start_date ?? null,
    activeApps,
    familyStudentById,
    packetByStudent,
    onlyStudentIds,
  });
  return { added, addedStudents, scheduled };
}

/** Students who are active and priced but have no line on the family's
 *  subscription, for the Billing card's standing label. */
export interface StudentsOffInvoice {
  /** First payment month hasn't come. The daily job adds each one
   *  when it opens. */
  later: ScheduledStudent[];
  /** Their month has opened (the next invoice is theirs) but they
   *  aren't on the subscription yet: the daily job adds them on its
   *  next run, or staff can from the card. */
  due: ScheduledStudent[];
}

const NOBODY_OFF_INVOICE: StudentsOffInvoice = { later: [], due: [] };

/**
 * Who a live subscription is holding a place for. The read-only twin
 * of the hold in `reconcileSubscriptionItems` and of the daily job's
 * list (`addStudentsDueForBilling`): the same students, by the same
 * tests, so the card can't promise something the job won't do.
 *
 * Without it, between a family's billing start and a later sibling's
 * first month the Billing card shows one student's line and no sign of
 * the other, which reads as a student who was forgotten.
 *
 * One read for the usual family, and nothing more when every active
 * student already has a line. Never throws: the card renders without
 * it.
 */
export async function getStudentsOffInvoice(args: {
  familyId: number;
  yearId: number;
  subscription: Stripe.Subscription;
}): Promise<StudentsOffInvoice> {
  const { familyId, yearId, subscription } = args;
  try {
    if (subscription.status === "canceled") return NOBODY_OFF_INVOICE;
    const onInvoice = new Set(
      subscription.items.data
        .map((i) => Number(i.metadata?.student_id))
        .filter((n) => Number.isFinite(n))
    );
    const apps = await xano.applications.getByFamilyId(familyId);
    const candidates = apps.filter(
      (app) =>
        Number(app.registration_school_years_id) === yearId &&
        app.isActive !== false &&
        !onInvoice.has(Number(app.registration_students_id)) &&
        storedPaymentCount(app.payment_count) != null &&
        typeof app.monthly_amount === "number" &&
        app.monthly_amount > 0
    );
    if (candidates.length === 0) return NOBODY_OFF_INVOICE;

    const [year, students, yearPackets] = await Promise.all([
      xano.schoolYears.getById(yearId),
      xano.students.getByFamilyId(familyId),
      xano.studentRegistration.getByYear(yearId),
    ]);
    const billingStartDate = year?.billing_start_date ?? null;
    const studentById = new Map(
      students.filter((s) => !s.isArchived).map((s) => [s.id, s])
    );
    const packetByStudent = new Map(
      yearPackets.map((p) => [Number(p.registration_students_id), p])
    );
    const paymentsLeft = paymentsFrom(
      billingStartDate,
      nextInvoiceMsOf(subscription) ?? Date.now()
    );
    const off: StudentsOffInvoice = { later: [], due: [] };
    for (const app of candidates) {
      const sid = Number(app.registration_students_id);
      const student = studentById.get(sid);
      if (!student) continue;
      const packet = packetByStudent.get(sid);
      // Billed before (a handle, live or removed): un-enrolled or taken
      // off the subscription by a person, not held by a start month.
      if (!packet || packet.stripe_subscription_item_id) continue;
      if (isPendingMidYearAddition(app, packet.registrationConfirmed === true)) {
        continue;
      }
      const name =
        `${student.first_name ?? ""} ${student.last_name ?? ""}`.trim() ||
        `Student #${sid}`;
      const entry = scheduledStudentOf(app, name, billingStartDate);
      if (planIsDue(app.payment_count, paymentsLeft)) off.due.push(entry);
      else off.later.push(entry);
    }
    return off;
  } catch (err) {
    console.error(
      `[getStudentsOffInvoice] family ${familyId}, year ${yearId}:`,
      err
    );
    return NOBODY_OFF_INVOICE;
  }
}

/** A student the daily job put on their family's invoice. */
export interface DueStudentAdded extends AddedStudent {
  familyId: number;
}

export interface DueStudentsSweepResult {
  added: DueStudentAdded[];
  errors: Array<{ familyId: number; studentIds: number[]; error: string }>;
}

/** How far ahead of a student's first payment month the daily job
 *  starts asking Stripe whether the invoice before it has gone out.
 *  Longer than any month, so the look never starts late. */
const DUE_LOOKAHEAD_MS = 32 * 24 * 60 * 60 * 1000;

/**
 * The daily job's half of "one invoice, each student from their own
 * month" (`lib/payment-plan.ts`). A student whose first payment is a
 * later month than their family's invoices was left off the
 * subscription when billing started; this adds them once the invoice
 * BEFORE their month has gone out, so their line first appears on the
 * invoice for their month and the family is billed for both students
 * from then on.
 *
 * Deliberately narrow. It only ever looks at a student who:
 *   - is active this year, in a family with a live subscription
 *     (`subscriptionByFamily`: the caller's list, residential families
 *     already left out);
 *   - has a payment plan and a monthly amount on file, so a row priced
 *     before plans existed is never picked up by this job;
 *   - has never been billed (no Stripe item handle, live or removed);
 *   - is not a mid-year addition still waiting on its packet confirm.
 * and it adds only those students: anyone else off the subscription
 * stays a person's decision. It does not revive a subscription that
 * is set to end.
 *
 * Whether the month has opened is decided against the subscription's
 * real next invoice, inside the reconcile. Never throws.
 */
export async function addStudentsDueForBilling(args: {
  yearId: number;
  subscriptionByFamily: ReadonlyMap<number, string>;
  nowMs?: number;
}): Promise<DueStudentsSweepResult> {
  const result: DueStudentsSweepResult = { added: [], errors: [] };
  const nowMs = args.nowMs ?? Date.now();
  let dueByFamily: Map<number, number[]>;
  let yearName = `Year #${args.yearId}`;
  try {
    const [year, apps, yearPackets] = await Promise.all([
      xano.schoolYears.getById(args.yearId),
      xano.applications.getByYear(args.yearId),
      xano.studentRegistration.getByYear(args.yearId),
    ]);
    if (!year) return result;
    yearName = year.year_name?.trim() || yearName;
    const packetByStudent = new Map(
      yearPackets.map((p) => [Number(p.registration_students_id), p])
    );
    // Invoices a subscription would still have to send if its next one
    // went out a month from now: a student whose plan is shorter than
    // that isn't close enough to be worth a Stripe lookup yet.
    const paymentsLeftSoon = paymentsFrom(
      year.billing_start_date ?? null,
      nowMs + DUE_LOOKAHEAD_MS
    );
    dueByFamily = new Map();
    for (const app of apps) {
      const familyId = Number(app.registration_families_id);
      const studentId = Number(app.registration_students_id);
      if (!args.subscriptionByFamily.has(familyId)) continue;
      if (Number(app.registration_school_years_id) !== args.yearId) continue;
      if (app.isActive === false) continue;
      if (storedPaymentCount(app.payment_count) == null) continue;
      if (typeof app.monthly_amount !== "number" || app.monthly_amount <= 0) {
        continue;
      }
      const packet = packetByStudent.get(studentId);
      if (!packet || packet.stripe_subscription_item_id) continue;
      if (isPendingMidYearAddition(app, packet.registrationConfirmed === true)) {
        continue;
      }
      if (!planIsDue(app.payment_count, paymentsLeftSoon)) continue;
      dueByFamily.set(familyId, [...(dueByFamily.get(familyId) ?? []), studentId]);
    }
  } catch (err) {
    console.error(
      `[addStudentsDueForBilling] couldn't read year ${args.yearId}:`,
      err
    );
    result.errors.push({
      familyId: 0,
      studentIds: [],
      error: err instanceof Error ? err.message : String(err),
    });
    return result;
  }

  for (const [familyId, studentIds] of dueByFamily) {
    try {
      const outcome = await reconcileFamilySubscriptionItems(
        familyId,
        args.yearId,
        { onlyStudentIds: studentIds }
      );
      const added = outcome.addedStudents.filter((s) =>
        studentIds.includes(s.studentId)
      );
      if (added.length === 0) continue;
      for (const s of added) result.added.push({ ...s, familyId });
      await noteStudentsAddedOnSchedule({
        familyId,
        yearId: args.yearId,
        yearName,
        added,
      });
    } catch (err) {
      console.error(
        `[addStudentsDueForBilling] family ${familyId}, year ${args.yearId}, students ${studentIds.join(", ")}:`,
        err
      );
      result.errors.push({
        familyId,
        studentIds,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return result;
}

/** Timeline line for a student the daily job put on the invoice.
 *  Best-effort: the item is already on the subscription. */
async function noteStudentsAddedOnSchedule(args: {
  familyId: number;
  yearId: number;
  yearName: string;
  added: AddedStudent[];
}): Promise<void> {
  try {
    await xano.adminNotes.create({
      registration_families_id: args.familyId,
      registration_students_id:
        args.added.length === 1 ? args.added[0].studentId : null,
      registration_school_years_id: args.yearId,
      registration_student_registration_progress_id: null,
      registration_family_application_progress_id: null,
      author_email: "",
      author_name: "Apply (automatic)",
      body: [
        `Added to the family's monthly billing (${args.yearName}) now that their first payment month is next. They are on the invoice from the next one.`,
        ...args.added.map(
          (s) =>
            `${s.studentName}: ${s.count} monthly payment${s.count === 1 ? "" : "s"} of ${usd(s.monthlyAmount)}.`
        ),
      ].join("\n"),
      category: "other",
      is_pinned: false,
      section: "billing",
      is_shared_with_parent: false,
    });
  } catch (err) {
    console.error(
      `[noteStudentsAddedOnSchedule] timeline note failed (family ${args.familyId}, year ${args.yearId}):`,
      err
    );
  }
}

/**
 * Compact stable signature of the per-student item set — folded into
 * the subscription idempotency key so a retry with a CHANGED roster
 * or amount gets fresh keys instead of Stripe's idempotency-conflict
 * error (same key + different params is rejected).
 */
function itemsSignature(
  items: Array<{ studentId: number; monthlyCents: number }>
): string {
  const sig = items
    .map((s) => `${s.studentId}.${s.monthlyCents}`)
    .sort()
    .join("_");
  let hash = 0;
  for (let i = 0; i < sig.length; i += 1) {
    hash = (hash * 31 + sig.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

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

/** What confirming a mid-year addition's packet did to the family's
 *  monthly billing. Returned to the admin confirm so the toast can say
 *  whether the new student is now on the subscription. */
export type MidYearBillingOutcome =
  | { status: "added"; monthlyAmount: number }
  | { status: "already_billed"; monthlyAmount: number }
  /** Confirmed, but their first payment is a later month than the
   *  family's next invoice: left off for now, and added by the daily
   *  job when that month opens. */
  | {
      status: "scheduled";
      monthlyAmount: number;
      firstMonthLabel: string | null;
    }
  /** No live subscription for the year (e.g. a fully covered family
   *  that was never billed) — admin starts billing from the Billing
   *  card, which picks up every confirmed student. */
  | { status: "no_subscription" }
  /** No `monthly_amount` on the student's application — the
   *  reconcile has already alerted staff. */
  | { status: "no_amount" }
  | { status: "failed"; error: string };

/**
 * Put a just-confirmed mid-year addition (see `lib/midyear-additions.ts`)
 * on the family's live subscription, next to the students already
 * enrolled. Rides the same reconcile as un-archive / reactivate:
 * `addStudentItemToSubscription` adds the item with no proration, so
 * the next invoice carries every student — the same "starts on the
 * next bill" rule as any late enrollee. An addition whose enrollment
 * start month is still ahead is not added yet (`scheduled`): the daily
 * job puts them on the invoice when that month opens. Never throws.
 */
export async function addMidYearAdditionToBilling(args: {
  familyId: number;
  yearId: number;
  studentId: number;
  monthlyAmount: number | null | undefined;
}): Promise<MidYearBillingOutcome> {
  const { familyId, yearId, studentId } = args;
  const monthly = args.monthlyAmount;
  const studentHasItem = (sub: Stripe.Subscription) =>
    sub.items.data.some((i) => Number(i.metadata?.student_id) === studentId);
  try {
    const payment = await xano.familyPayments.getByFamilyAndYearStrict(
      familyId,
      yearId
    );
    const liveSubId = activeStripeSubscriptionId(
      payment?.stripe_subscription_id
    );
    if (!liveSubId) return { status: "no_subscription" };
    let before: Awaited<ReturnType<typeof getBillingSnapshot>>;
    try {
      before = await getBillingSnapshot(liveSubId);
    } catch (err) {
      const code = (err as { code?: string; statusCode?: number }) ?? {};
      if (code.code === "resource_missing" || code.statusCode === 404) {
        return { status: "no_subscription" };
      }
      throw err;
    }
    if (before.subscription.status === "canceled") {
      return { status: "no_subscription" };
    }
    if (studentHasItem(before.subscription)) {
      return { status: "already_billed", monthlyAmount: monthly ?? 0 };
    }
    if (typeof monthly !== "number" || monthly <= 0) {
      // Still run the reconcile: it emails staff about the unpriced
      // student so they don't sit silently unbilled.
      await reconcileFamilySubscriptionItems(familyId, yearId);
      return { status: "no_amount" };
    }
    const reconciled = await reconcileFamilySubscriptionItems(familyId, yearId);
    const held = reconciled.scheduled.find((s) => s.studentId === studentId);
    if (held) {
      return {
        status: "scheduled",
        monthlyAmount: held.monthlyAmount,
        firstMonthLabel: held.firstMonthLabel,
      };
    }
    const after = await getBillingSnapshot(liveSubId);
    if (!studentHasItem(after.subscription)) {
      throw new Error(
        "The reconcile finished but the student still has no subscription item."
      );
    }
    return { status: "added", monthlyAmount: monthly };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(
      `[addMidYearAdditionToBilling] family ${familyId}, year ${yearId}, student ${studentId}:`,
      err
    );
    await sendBillingAlert(
      "Mid-year student NOT added to billing",
      [
        `Admissions confirmed this mid-year student's registration, but adding them to the family's monthly subscription failed — Stripe is still billing only the students enrolled before them.`,
        `To retry, clear and re-verify the student's packet on the family's Registrations page (it adds only the missing student), or add the item in the Stripe Dashboard.`,
        `Error: ${error}`,
      ],
      { familyId, yearId, studentIds: [studentId] }
    );
    return { status: "failed", error };
  }
}

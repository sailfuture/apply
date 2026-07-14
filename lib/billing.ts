import type Stripe from "stripe";
import {
  xano,
  activeStripeSubscriptionId,
  liveStripeSubscriptionItemId,
} from "@/lib/xano";
import {
  addStudentItemToSubscription,
  createSubscriptionWithStudentItems,
  getBillingSnapshot,
  getOrCreateCustomer,
  uncancelSubscription,
} from "@/lib/stripe";
import { sendBillingAlert } from "@/lib/billing-alerts";

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
  const activeApps = apps
    .filter(
      (app) =>
        Number(app.registration_school_years_id) === yearId &&
        app.isActive !== false &&
        familyStudentById.has(Number(app.registration_students_id))
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
      await reconcileSubscriptionItems({
        subscription: snapshot.subscription,
        familyId,
        yearId,
        familyName: family.family_name,
        yearName: year.year_name,
        activeApps,
        familyStudentById,
        packetByStudent,
      });
      // Re-read so the returned subscription reflects any items the
      // reconcile just added.
      const refreshed = await getBillingSnapshot(existingSubId);
      return { subscription: refreshed.subscription, created: false };
    }
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
  const studentItems = activeApps.map((app) => {
    const sid = Number(app.registration_students_id);
    const student = familyStudentById.get(sid);
    const studentName = student
      ? `${student.first_name ?? ""} ${student.last_name ?? ""}`.trim() ||
        `Student #${sid}`
      : `Student #${sid}`;
    const monthlyCents = Math.round((app.monthly_amount ?? 0) * 100);
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
    // Deterministic per (family, year, prior-subscription-state, item
    // composition): concurrent/retried starts collapse onto the same
    // Stripe objects instead of double-subscribing, while a
    // legitimate restart after a cancel (different prior state) or a
    // changed roster/amount (different item signature) gets fresh
    // keys — reusing a key with DIFFERENT params would make Stripe
    // reject the call with an idempotency conflict.
    idempotencyKeyBase: `tuition:f${familyId}:y${yearId}:prev-${payment?.stripe_subscription_id ?? "none"}:i${itemsSignature(studentItems)}`,
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
interface ReconcileContext {
  subscription: Stripe.Subscription;
  familyId: number;
  yearId: number;
  familyName: string;
  yearName: string;
  activeApps: Awaited<ReturnType<typeof xano.applications.getByFamilyId>>;
  familyStudentById: Map<
    number,
    Awaited<ReturnType<typeof xano.students.getByFamilyId>>[number]
  >;
  packetByStudent: Map<
    number,
    Awaited<ReturnType<typeof xano.studentRegistration.getByYear>>[number]
  >;
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
 */
async function reconcileSubscriptionItems(
  ctx: ReconcileContext
): Promise<number> {
  const itemByStudent = new Map<number, string>();
  for (const item of ctx.subscription.items.data) {
    const sid = Number(item.metadata?.student_id);
    if (Number.isFinite(sid)) itemByStudent.set(sid, item.id);
  }

  let added = 0;
  for (const app of ctx.activeApps) {
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
    const monthly = app.monthly_amount;
    if (typeof monthly !== "number" || monthly <= 0) continue; // caller validates; defensive

    const student = ctx.familyStudentById.get(sid);
    const studentName = student
      ? `${student.first_name ?? ""} ${student.last_name ?? ""}`.trim() ||
        `Student #${sid}`
      : `Student #${sid}`;
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
  return added;
}

/**
 * In-process guard for the standalone reconcile — same rationale as
 * `inFlightStarts`: two cascades racing (or a cascade racing the
 * Start button's own reconcile) must not both decide a student is
 * missing and double-add their item. The idempotency keys inside
 * `addStudentItemToSubscription` cover the cross-instance case.
 */
const inFlightReconciles = new Map<string, Promise<{ added: number }>>();

/**
 * Standalone reconcile for callers outside the Start button — the
 * un-archive and application-reactivate cascades. Loads its own
 * context, no-ops when the family has no live subscription for the
 * year, and alerts staff when an active student CAN'T be billed
 * because their `monthly_amount` isn't set (otherwise they'd sit
 * silently unbilled until someone noticed).
 */
export function reconcileFamilySubscriptionItems(
  familyId: number,
  yearId: number
): Promise<{ added: number }> {
  const key = `${familyId}:${yearId}`;
  const existing = inFlightReconciles.get(key);
  if (existing) return existing;
  const run = reconcileFamilySubscriptionItemsInner(familyId, yearId).finally(
    () => {
      inFlightReconciles.delete(key);
    }
  );
  inFlightReconciles.set(key, run);
  return run;
}

async function reconcileFamilySubscriptionItemsInner(
  familyId: number,
  yearId: number
): Promise<{ added: number }> {
  const payment = await xano.familyPayments.getByFamilyAndYearStrict(
    familyId,
    yearId
  );
  const liveSubId = activeStripeSubscriptionId(
    payment?.stripe_subscription_id
  );
  if (!liveSubId) return { added: 0 };

  let snapshot: Awaited<ReturnType<typeof getBillingSnapshot>>;
  try {
    snapshot = await getBillingSnapshot(liveSubId);
  } catch (err) {
    const code = (err as { code?: string; statusCode?: number }) ?? {};
    if (code.code === "resource_missing" || code.statusCode === 404) {
      return { added: 0 };
    }
    throw err;
  }
  if (snapshot.subscription.status === "canceled") return { added: 0 };

  const [family, year, students, apps, yearPackets] = await Promise.all([
    xano.families.getById(familyId),
    xano.schoolYears.getById(yearId),
    xano.students.getByFamilyId(familyId),
    xano.applications.getByFamilyId(familyId),
    xano.studentRegistration.getByYear(yearId),
  ]);
  if (!family || !year) return { added: 0 };

  const familyStudentById = new Map(
    students.filter((s) => !s.isArchived).map((s) => [s.id, s])
  );
  const activeApps = apps.filter(
    (app) =>
      Number(app.registration_school_years_id) === yearId &&
      app.isActive !== false &&
      familyStudentById.has(Number(app.registration_students_id))
  );
  const packetByStudent = new Map(
    yearPackets.map((p) => [Number(p.registration_students_id), p])
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
  if (unbillable.length > 0) {
    await sendBillingAlert(
      `Active student(s) missing tuition amount for family #${familyId}`,
      [
        `Family #${familyId} (year #${yearId}) has a live subscription, but ${unbillable.length} active student(s) have no monthly_amount set and are NOT being billed:`,
        ...unbillable.map(
          (a) => `  - student #${a.registration_students_id}`
        ),
        `Set their tuition on the Scholarship Determination card, then click "Start Monthly Billing" to add them to the subscription.`,
      ]
    );
  }

  const added = await reconcileSubscriptionItems({
    subscription: snapshot.subscription,
    familyId,
    yearId,
    familyName: family.family_name,
    yearName: year.year_name,
    activeApps,
    familyStudentById,
    packetByStudent,
  });
  return { added };
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

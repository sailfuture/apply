import {
  xano,
  type XanoApplication,
  type XanoStudentRegistration,
} from "@/lib/xano";
import {
  removeStudentItemFromSubscription,
  updateStudentItemAmount,
} from "@/lib/stripe";

/**
 * Last-resort fallback for the per-student annual fee when the
 * school year row is missing or carries a null `annual_fees`
 * value. The real default comes from `school_year.annual_fees` —
 * that's the per-year policy admin sets directly on the year row.
 * This constant only fires when even that lookup fails.
 */
export const FALLBACK_PER_STUDENT_ANNUAL_FEE = 500;

/**
 * Compute the per-student billing columns from the inputs admin
 * actually edits (SUFS award amount + the "Remaining Amount Family
 * Pays" toward tuition via Opportunity Scholarship) plus the school
 * year's gross tuition. Centralizes the math so every callsite that
 * auto-populates the application row (`/by-student` route, SNAP
 * cascade, future migration helpers) produces consistent values.
 *
 * All billing math + the SUFS audit snapshot live on
 * `registration_application` now. `registration_student_registration`
 * (the per-student packet) only carries `stripe_subscription_item_id`
 * — the Stripe-side link — not any of the math columns.
 *
 * Column meanings (on the application row):
 *   - `tuition_total`              — school year's gross tuition.
 *   - `sufs_amount`                — SUFS award (tier amount).
 *   - `remaining_opportunity_amount` — what the family pays toward
 *                                    tuition via the Opportunity
 *                                    Scholarship remainder.
 *   - `opportunity_award_amount`    — what the Opportunity Scholarship
 *                                    actually covers.
 *   - `annual_fee`                  — per-student annual fee for the year.
 *   - `tuition_sub_total`           — family-paid annual total
 *                                    (`remaining_opportunity_amount +
 *                                    annual_fee`).
 *   - `monthly_amount`              — `tuition_sub_total / 12`.
 *
 * Worked example (year tuition = $27,522, SUFS FTC Grade 9 = $7,770,
 * Remaining Amount Family Pays = $0, annual fee = $500):
 *   tuition_total                 = 27,522
 *   sufs_amount                   = 7,770
 *   remaining_opportunity_amount  = 0
 *   opportunity_award_amount      = 27,522 − 7,770 − 0 = 19,752
 *   annual_fee                    = 500
 *   tuition_sub_total             = 0 + 500 = 500
 *   monthly_amount                = 500 / 12 = $41.67
 */
export interface PacketBillingValues {
  sufs_amount: number;
  tuition_total: number;
  remaining_opportunity_amount: number;
  opportunity_award_amount: number;
  annual_fee: number;
  tuition_sub_total: number;
  monthly_amount: number;
}

export function derivePacketBillingValues({
  schoolYearTuition,
  schoolYearAnnualFees,
  sufsAwardAmount,
  remainingOpportunityAmount,
  annualFee,
}: {
  schoolYearTuition: number;
  /** Per-student annual fee for the school year, sourced from
   *  `school_year.annual_fees`. Becomes the row's `annual_fee`
   *  default — admin sets the policy at the year level and every
   *  application derived this year inherits it. */
  schoolYearAnnualFees: number | null | undefined;
  /** Per-student SUFS award (the dollar value of the chosen tier). */
  sufsAwardAmount: number;
  /** Family-paid portion of tuition via the Opportunity Scholarship
   *  remainder — what admin types into "Remaining Amount Family
   *  Pays" on the Determination card. Persists onto the
   *  `remaining_opportunity_amount` column on the application row. */
  remainingOpportunityAmount: number;
  /** Per-student override of the year-level annual fee (e.g. waiver,
   *  scholarship recipient with fee included elsewhere). When set,
   *  takes precedence over `schoolYearAnnualFees`. */
  annualFee?: number | null;
}): PacketBillingValues {
  const sufs = Number.isFinite(sufsAwardAmount) ? sufsAwardAmount : 0;
  const remaining = Number.isFinite(remainingOpportunityAmount)
    ? remainingOpportunityAmount
    : 0;
  // Annual fee resolution order:
  //   1. Per-student override (admin set a one-off on this app)
  //   2. School year's `annual_fees` (the per-year policy)
  //   3. Hard-coded fallback (year row missing/null — last resort)
  // Each step `isFinite` checks because Xano can return null for
  // unset numerics; `null` would otherwise coerce to 0 here.
  const fee =
    typeof annualFee === "number" && Number.isFinite(annualFee)
      ? annualFee
      : typeof schoolYearAnnualFees === "number" &&
          Number.isFinite(schoolYearAnnualFees)
        ? schoolYearAnnualFees
        : FALLBACK_PER_STUDENT_ANNUAL_FEE;
  const tuition = Number.isFinite(schoolYearTuition) ? schoolYearTuition : 0;

  // `tuition_total` is the year's gross tuition. SUFS + Opportunity
  // Scholarship cover the rest; the family pays
  // `remaining_opportunity_amount + annual_fee` per year.
  const tuition_total = tuition;
  const opportunity_award_amount = Math.max(
    tuition - sufs - remaining,
    0
  );
  const tuition_sub_total = remaining + fee;
  // Round monthly to 2 decimal places — Stripe accepts integer
  // cents downstream, this just keeps the stored figure readable
  // for admin surfaces.
  const monthly_amount = Math.round((tuition_sub_total / 12) * 100) / 100;

  return {
    sufs_amount: sufs,
    tuition_total,
    remaining_opportunity_amount: remaining,
    opportunity_award_amount,
    annual_fee: fee,
    tuition_sub_total,
    monthly_amount,
  };
}

/**
 * Re-price an application's per-student Stripe SubscriptionItem to
 * match its current `monthly_amount`. The application row carries
 * the billing math; the matching packet carries the Stripe-side
 * `stripe_subscription_item_id` that identifies which item to re-
 * price. No-op when the packet has no item id (billing hasn't
 * started) or `app.monthly_amount` is missing/<=0.
 *
 * Best-effort — caller wraps in try/catch and continues on Stripe
 * failure (the Xano write succeeded; the next manual edit can
 * re-sync).
 *
 * Resolves student / family / year labels via three Xano reads so
 * the new Stripe Price gets the canonical
 * `<Family> — <Student> — <Year>` nickname that
 * `createSubscriptionWithStudentItems` originally stamped.
 */
export async function syncStripeForApplication(
  app: XanoApplication,
  packet: XanoStudentRegistration | null
): Promise<void> {
  const subscriptionItemId = packet?.stripe_subscription_item_id;
  const monthlyAmount = app.monthly_amount;
  if (
    !subscriptionItemId ||
    typeof monthlyAmount !== "number" ||
    monthlyAmount <= 0
  ) {
    return;
  }
  const studentId = Number(app.registration_students_id);
  const yearId = Number(app.registration_school_years_id);
  const familyId = Number(app.registration_families_id);

  const [student, family, year] = await Promise.all([
    xano.students.getById(studentId),
    xano.families.getById(familyId),
    xano.schoolYears.getById(yearId),
  ]);

  const studentName =
    `${student.first_name ?? ""} ${student.last_name ?? ""}`.trim() ||
    `Student #${studentId}`;
  const familyName = family.family_name?.trim() || `Family #${familyId}`;
  const yearName = year.year_name?.trim() || `Year #${yearId}`;

  await updateStudentItemAmount({
    subscriptionItemId,
    familyName,
    studentName,
    yearName,
    monthlyCents: Math.round(monthlyAmount * 100),
    studentId,
    familyId,
    yearId,
  });
}

/**
 * Take an archived student's per-year tuition lines off every
 * active Stripe subscription they're attached to. Walks every
 * packet for the student (typically one — the current year —
 * but re-enrolling students can have packets across multiple
 * years), and for each packet with a `stripe_subscription_item_id`:
 *
 *   1. Look up the family's `stripe_subscription_id` from the
 *      family-payment row for that packet's year.
 *   2. Call `removeStudentItemFromSubscription` so Stripe drops
 *      the item from the next invoice (and cancels the parent
 *      subscription at period end if this was the last item).
 *   3. Null the packet's `stripe_subscription_item_id` so the
 *      local handle matches Stripe's state.
 *
 * Best-effort throughout — each packet's cleanup is wrapped in
 * try/catch so a single Stripe failure doesn't stop the rest,
 * and the caller (the archive PATCH) doesn't fail if Stripe is
 * unreachable. Errors log loudly so admin can reconcile from the
 * Dashboard.
 *
 * No-op when:
 *   - the student has no packets, or
 *   - none of their packets have a `stripe_subscription_item_id`
 *     (billing hasn't started yet), or
 *   - the matching family-payment row has no `stripe_subscription_id`
 *     (subscription was already cancelled / never created).
 */
export async function removeStripeItemsForArchivedStudent(
  studentId: number
): Promise<void> {
  if (!Number.isInteger(studentId) || studentId <= 0) return;
  const packets = await xano.studentRegistration.getAllByStudentId(studentId);
  const liveItems = packets.filter(
    (p) =>
      typeof p.stripe_subscription_item_id === "string" &&
      p.stripe_subscription_item_id.length > 0
  );
  if (liveItems.length === 0) return;

  await Promise.allSettled(
    liveItems.map(async (packet) => {
      const itemId = packet.stripe_subscription_item_id!;
      const yearId = Number(packet.registration_school_years_id);
      // Find the family for this packet via its embedded student
      // (Xano often pre-joins) or a fallback `students.getById` hop.
      const studentRow =
        packet._registration_students_2 ??
        (await xano.students
          .getById(Number(packet.registration_students_id))
          .catch(() => null));
      const familyId = Number(studentRow?.registration_families_id ?? 0);
      if (!familyId || !yearId) return;

      try {
        const payment = await xano.familyPayments.getByFamilyAndYear(
          familyId,
          yearId
        );
        const subscriptionId = payment?.stripe_subscription_id ?? null;
        if (!subscriptionId) {
          // No active subscription on file. Just clear the stale
          // packet handle and move on.
          await xano.studentRegistration.update(packet.id, {
            stripe_subscription_item_id: null,
          });
          return;
        }
        await removeStudentItemFromSubscription({
          subscriptionId,
          subscriptionItemId: itemId,
        });
        await xano.studentRegistration.update(packet.id, {
          stripe_subscription_item_id: null,
        });
      } catch (err) {
        console.error(
          `[removeStripeItemsForArchivedStudent] failed to remove item ${itemId} for packet ${packet.id} (student ${studentId}, year ${yearId}):`,
          err
        );
      }
    })
  );
}

/**
 * Resolve the matching `registration_student_registration` packet
 * for an application row (one packet per student per year). Returns
 * null if no packet exists yet — caller can decide whether to
 * create one or skip.
 */
export async function findPacketForApplication(
  app: XanoApplication
): Promise<XanoStudentRegistration | null> {
  const studentId = Number(app.registration_students_id);
  const yearId = Number(app.registration_school_years_id);
  if (!studentId || !yearId) return null;
  const yearPackets = await xano.studentRegistration.getByYear(yearId);
  return (
    yearPackets.find(
      (p) => Number(p.registration_students_id) === studentId
    ) ?? null
  );
}

/**
 * Resolve the set of active `registration_application` rows that
 * should bill for a given (family, year). Used by every server-side
 * billing surface that needs to derive a family total from per-
 * student values without duplicating the filtering plumbing.
 *
 * Filter:
 *   - student exists on the family and isn't archived
 *   - app is for the requested year
 *   - app `isActive !== false`
 *
 * Two round-trips (students + applications) run in parallel.
 * Callers that already have either array in scope can call
 * `filterActiveFamilyApplications` directly instead.
 *
 * Returns `[]` when no active applications match — legitimate state
 * for pre-acceptance families, so callers should handle the empty
 * case rather than treating it as an error.
 */
export async function fetchActiveFamilyApplications(
  familyId: number,
  yearId: number
): Promise<XanoApplication[]> {
  const [students, apps] = await Promise.all([
    xano.students.getByFamilyId(familyId),
    xano.applications.getByFamilyId(familyId),
  ]);
  return filterActiveFamilyApplications({
    familyId,
    yearId,
    students,
    apps,
  });
}

/**
 * Pure version of `fetchActiveFamilyApplications` — same active-
 * student filter, but takes the input arrays directly so callers
 * that already fetched them don't pay for a second round trip.
 */
export function filterActiveFamilyApplications({
  familyId,
  yearId,
  students,
  apps,
}: {
  familyId: number;
  yearId: number;
  students: Array<{
    id: number;
    isArchived: boolean;
    registration_families_id: number;
  }>;
  apps: XanoApplication[];
}): XanoApplication[] {
  const familyStudentIds = new Set(
    students
      .filter(
        (s) =>
          !s.isArchived && Number(s.registration_families_id) === familyId
      )
      .map((s) => s.id)
  );
  return apps.filter(
    (app) =>
      Number(app.registration_school_years_id) === yearId &&
      app.isActive !== false &&
      familyStudentIds.has(Number(app.registration_students_id))
  );
}

/**
 * Rolled-up family totals derived from each active student's
 * application row. The application row is the single source of
 * truth for per-student billing math now (the packet only carries
 * `stripe_subscription_item_id`), so we sum across applications
 * rather than packets.
 *
 * All sums tolerate `null` / `undefined` (legacy rows or new rows
 * before admin fills them in) — missing values are treated as 0.
 * Callers that need to distinguish "$0 / mo" from "not yet filled
 * in" should check the underlying application rows directly.
 */
export interface FamilyBillingTotals {
  /** Σ `app.monthly_amount` — what Stripe bills the family each
   *  month, when all per-student items are active. */
  monthlyTotal: number;
  /** Σ `app.annual_fee` — total admin / annual fees the family
   *  owes for the year (`$500 × N` today). */
  annualFeeTotal: number;
  /** Σ `app.sufs_amount` — total SUFS scholarship dollars awarded
   *  to the family across all active students. */
  sufsTotal: number;
  /** Σ `app.tuition_total` — sum of each student's gross tuition. */
  tuitionTotal: number;
  /** Σ `app.opportunity_award_amount` — total Opportunity
   *  Scholarship coverage across active students. */
  oppAwardTotal: number;
  /** Σ `app.tuition_sub_total` — annual family-paid total before
   *  monthly division. Should equal `monthlyTotal * 12` within
   *  rounding. */
  subTotal: number;
  /** Count of applications that contributed to the sums. */
  activeStudentCount: number;
}

/**
 * Sum each per-student column across the supplied applications.
 *
 * Caller is responsible for filtering to only the applications
 * that should bill — usually `filterActiveFamilyApplications` /
 * `fetchActiveFamilyApplications` above. This helper sums whatever
 * is passed; it doesn't know about enrollment state.
 */
export function sumFamilyBillingTotals(
  apps: XanoApplication[]
): FamilyBillingTotals {
  const sumField = (field: keyof XanoApplication): number =>
    apps.reduce((acc, a) => {
      const value = a[field];
      return acc + (typeof value === "number" ? value : 0);
    }, 0);

  return {
    monthlyTotal: sumField("monthly_amount"),
    annualFeeTotal: sumField("annual_fee"),
    sufsTotal: sumField("sufs_amount"),
    tuitionTotal: sumField("tuition_total"),
    oppAwardTotal: sumField("opportunity_award_amount"),
    subTotal: sumField("tuition_sub_total"),
    activeStudentCount: apps.length,
  };
}

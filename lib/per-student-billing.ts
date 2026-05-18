import {
  xano,
  type XanoApplication,
  type XanoStudentRegistration,
} from "@/lib/xano";
import { updateStudentItemAmount } from "@/lib/stripe";

/**
 * Last-resort fallback for the per-student annual fee when the
 * school year row is missing or carries a null `annual_fees`
 * value. The real default comes from `school_year.annual_fees` —
 * that's the per-year policy admin sets directly on the year row.
 * This constant only fires when even that lookup fails.
 */
export const FALLBACK_PER_STUDENT_ANNUAL_FEE = 500;

/**
 * Compute the six per-student billing columns from the inputs that
 * admin actually edits (SUFS award amount + family-paid portion of
 * tuition) plus the school year's gross tuition. Centralizes the
 * math so every callsite that auto-populates packet columns
 * (applications PATCH cascade, future migration helpers, etc.)
 * produces consistent values.
 *
 * Worked example (year tuition = $27,522):
 *   sufs_award_amount                = 7000
 *   opportunity_scholarship_award_amount (what family pays toward
 *     tuition before annual_fee)    = 1000
 *   schoolYearTuition                = 27522
 *
 *   sufs_amount                      = 7000
 *   tuition_total                    = 27522 - 7000 = 20522
 *   opportunity_award_amount         = 27522 - 7000 - 1000 = 19522
 *   annual_fee                       = 500
 *   tuition_sub_total                = 1000 + 500 = 1500
 *   monthly_amount                   = 1500 / 12 = $125
 */
export interface PacketBillingValues {
  sufs_amount: number;
  tuition_total: number;
  opportunity_award_amount: number;
  annual_fee: number;
  tuition_sub_total: number;
  monthly_amount: number;
}

export function derivePacketBillingValues({
  schoolYearTuition,
  schoolYearAnnualFees,
  sufsAwardAmount,
  opportunityScholarshipRemaining,
  annualFee,
}: {
  schoolYearTuition: number;
  /** Per-student annual fee for the school year, sourced from
   *  `school_year.annual_fees`. Becomes the packet's `annual_fee`
   *  default — admin sets the policy at the year level and every
   *  packet derived this year inherits it. */
  schoolYearAnnualFees: number | null | undefined;
  /** Per-student SUFS award (the dollar value of the chosen tier). */
  sufsAwardAmount: number;
  /** Family-paid portion of tuition after Opportunity Scholarship
   *  coverage — what admin types into "Cost per student" on the
   *  Scholarship Determination card. Currently persisted on
   *  `registration_application.opportunity_scholarship_award_amount`
   *  (the column name lags the field's meaning for backwards
   *  compatibility). */
  opportunityScholarshipRemaining: number;
  /** Per-packet override of the year-level annual fee (e.g. waiver,
   *  scholarship recipient with fee included elsewhere). When set,
   *  takes precedence over `schoolYearAnnualFees`. */
  annualFee?: number | null;
}): PacketBillingValues {
  const sufs = Number.isFinite(sufsAwardAmount) ? sufsAwardAmount : 0;
  const remaining = Number.isFinite(opportunityScholarshipRemaining)
    ? opportunityScholarshipRemaining
    : 0;
  // Annual fee resolution order:
  //   1. Per-packet override (admin set a one-off on this packet)
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

  const tuition_total = Math.max(tuition - sufs, 0);
  const opportunity_award_amount = Math.max(tuition - sufs - remaining, 0);
  const tuition_sub_total = remaining + fee;
  // Round monthly to 2 decimal places — Stripe accepts integer
  // cents downstream, this just keeps the stored figure readable
  // for admin surfaces.
  const monthly_amount = Math.round((tuition_sub_total / 12) * 100) / 100;

  return {
    sufs_amount: sufs,
    tuition_total,
    opportunity_award_amount,
    annual_fee: fee,
    tuition_sub_total,
    monthly_amount,
  };
}

/**
 * Re-price a packet's Stripe SubscriptionItem to match its current
 * `monthly_amount`. No-op when the packet has no
 * `stripe_subscription_item_id` (billing hasn't started) or
 * `monthly_amount <= 0`. Best-effort — caller wraps in try/catch
 * and continues on Stripe failure (the Xano write succeeded; the
 * next manual edit can re-sync).
 *
 * Resolves student / family / year labels via three Xano reads so
 * the new Stripe Price gets the canonical
 * `<Family> — <Student> — <Year>` nickname that
 * `createSubscriptionWithStudentItems` originally stamped.
 */
export async function syncStripeForPacket(
  packet: XanoStudentRegistration
): Promise<void> {
  const subscriptionItemId = packet.stripe_subscription_item_id;
  const monthlyAmount = packet.monthly_amount;
  if (
    !subscriptionItemId ||
    typeof monthlyAmount !== "number" ||
    monthlyAmount <= 0
  ) {
    return;
  }
  const studentId = Number(packet.registration_students_id);
  const yearId = Number(packet.registration_school_years_id);

  const student =
    packet._registration_students_2 ??
    (await xano.students.getById(studentId));
  const familyId = Number(student.registration_families_id);

  const [family, year] = await Promise.all([
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
 * Resolve the set of `registration_student_registration` rows that
 * should bill for a given (family, year). Returns packets whose
 * student is not archived AND whose per-year application is
 * `isActive`. Used by every server-side billing surface that needs
 * to derive a family total from per-student values without
 * duplicating the filtering plumbing.
 *
 * Three round-trips (students + applications + year's packets) run
 * in parallel. Callers that already have any of these arrays in
 * scope can call `filterActiveFamilyPackets` directly instead.
 *
 * Returns `[]` when there are no active students for the year —
 * legitimate state for pre-acceptance families, so callers should
 * handle the empty case rather than treating it as an error.
 */
export async function fetchActiveFamilyPackets(
  familyId: number,
  yearId: number
): Promise<XanoStudentRegistration[]> {
  const [students, apps, yearPackets] = await Promise.all([
    xano.students.getByFamilyId(familyId),
    xano.applications.getByFamilyId(familyId),
    xano.studentRegistration.getByYear(yearId),
  ]);
  return filterActiveFamilyPackets({
    familyId,
    yearId,
    students,
    apps,
    yearPackets,
  });
}

/**
 * Pure version of `fetchActiveFamilyPackets` — same active-student
 * filter, but takes the three input arrays directly so callers
 * that already fetched them don't pay for a second round trip.
 */
export function filterActiveFamilyPackets({
  familyId,
  yearId,
  students,
  apps,
  yearPackets,
}: {
  familyId: number;
  yearId: number;
  students: Array<{ id: number; isArchived: boolean; registration_families_id: number }>;
  apps: Array<{
    registration_students_id: number;
    registration_school_years_id: number;
    isActive?: boolean;
  }>;
  yearPackets: XanoStudentRegistration[];
}): XanoStudentRegistration[] {
  const familyStudentIds = new Set(
    students
      .filter(
        (s) =>
          !s.isArchived && Number(s.registration_families_id) === familyId
      )
      .map((s) => s.id)
  );
  const activeStudentIds = new Set<number>();
  for (const app of apps) {
    if (Number(app.registration_school_years_id) !== yearId) continue;
    if (app.isActive === false) continue;
    const sid = Number(app.registration_students_id);
    if (familyStudentIds.has(sid)) activeStudentIds.add(sid);
  }
  return yearPackets.filter((p) =>
    activeStudentIds.has(Number(p.registration_students_id))
  );
}

/**
 * Rolled-up family totals derived from each active student's packet.
 *
 * Replaces the old family-level columns
 * (`monthly_tuition_payment` / `annual_fee_total` / `sufs_total`)
 * that used to live on `registration_families_payment`. Per-student
 * amounts are the source of truth now; this helper just sums them
 * for display surfaces (Tuition card, PDF, billing schedule) that
 * still want a single family figure.
 *
 * All sums tolerate `null` / `undefined` (legacy rows or new rows
 * before admin fills them in) — missing values are treated as 0.
 * Callers that need to distinguish "$0 / mo" from "not yet filled
 * in" should check the underlying packets directly.
 */
export interface FamilyBillingTotals {
  /** Σ `packet.monthly_amount` — what Stripe bills the family each
   *  month, when all per-student items are active. */
  monthlyTotal: number;
  /** Σ `packet.annual_fee` — total admin / annual fees the family
   *  owes for the year (`$500 × N` today). */
  annualFeeTotal: number;
  /** Σ `packet.sufs_amount` — total SUFS scholarship dollars awarded
   *  to the family across all active students. */
  sufsTotal: number;
  /** Σ `packet.tuition_total` — sum of each student's gross tuition
   *  net of SUFS (i.e. `school_year.tuition - sufs_amount`). */
  tuitionTotal: number;
  /** Σ `packet.opportunity_award_amount` — total Opportunity
   *  Scholarship coverage across active students. */
  oppAwardTotal: number;
  /** Σ `packet.tuition_sub_total` — annual family-paid total before
   *  monthly division. Should equal `monthlyTotal * 12` within
   *  rounding. */
  subTotal: number;
  /** Count of packets that contributed to the sums. Useful for
   *  rendering "$X / mo across N students" microcopy. */
  activeStudentCount: number;
}

/**
 * Sum each per-student column across the supplied packets.
 *
 * Caller is responsible for filtering to only the packets that
 * should bill — usually "active students for the year" (i.e.
 * matching `registration_application.isActive !== false` and
 * `registration_students.isArchived !== true`). This helper sums
 * whatever is passed; it doesn't know about enrollment state.
 */
export function sumFamilyBillingTotals(
  packets: XanoStudentRegistration[]
): FamilyBillingTotals {
  const sumField = (field: keyof XanoStudentRegistration): number =>
    packets.reduce((acc, p) => {
      const value = p[field];
      return acc + (typeof value === "number" ? value : 0);
    }, 0);

  return {
    monthlyTotal: sumField("monthly_amount"),
    annualFeeTotal: sumField("annual_fee"),
    sufsTotal: sumField("sufs_amount"),
    tuitionTotal: sumField("tuition_total"),
    oppAwardTotal: sumField("opportunity_award_amount"),
    subTotal: sumField("tuition_sub_total"),
    activeStudentCount: packets.length,
  };
}

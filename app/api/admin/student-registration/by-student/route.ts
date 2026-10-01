import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import type { AdminUser } from "@/lib/admin-auth";
import {
  xano,
  liveStripeSubscriptionItemId,
  activeStripeSubscriptionId,
  type XanoApplication,
} from "@/lib/xano";
import { getFirstInvoiceAtCurrentPriceMs } from "@/lib/stripe";
import { sendBillingAmountChangedEmail } from "@/lib/emails/triggers";
import { sendBillingAlert } from "@/lib/billing-alerts";
import {
  derivePacketBillingValues,
  syncStripeForApplication,
  type PacketBillingValues,
} from "@/lib/per-student-billing";
import { resolveStudentReceiptAmounts } from "@/lib/student-receipt";

/**
 * Per-student billing PATCH keyed on `(studentId, yearId)` rather
 * than the application's primary key. The Scholarship Determination
 * card doesn't have the application id in scope — it iterates over
 * students + per-year applications — so this endpoint takes the
 * lookup keys the card already knows and does the application
 * resolve server-side.
 *
 *   POST /api/admin/student-registration/by-student
 *   Body: {
 *     studentId: number,
 *     yearId: number,
 *     sufsAwardAmount?: number,
 *     remainingOpportunityAmount?: number,
 *     dryRun?: boolean,
 *     reason?: string,
 *     notifyParents?: boolean,   // email the new monthly once Stripe has it
 *     previousMonthly?: number,  // with stripeRetry: the pre-change monthly
 *   }
 *
 * The route reads the application row's existing values for any
 * input the caller didn't send, then runs the math through
 * `derivePacketBillingValues` so the seven billing columns always
 * land in a consistent state — no partial updates that leave the
 * derived columns out of sync with the inputs.
 *
 * Source of truth is the application row. The packet only carries
 * `stripe_subscription_item_id` (the Stripe-side link) so when
 * billing is live we still re-price the Stripe item to match the
 * new amount.
 *
 * Amount overrides. Once a student's award is confirmed and amounts
 * are on file, the Determination card locks the dollar inputs — the
 * family signed against those numbers. Its "Edit amounts" override
 * still writes through here, and an edit to such a row is treated
 * differently in three ways:
 *   - the row's stored `annual_fee` is kept, so the override moves
 *     only what admin changed;
 *   - an audit note lands on the family's timeline (nothing else
 *     records what the signed amount used to be);
 *   - `dryRun: true` returns the before / after figures without
 *     writing, so the card's confirm dialog shows exactly what this
 *     route is about to do.
 *
 * Returns the updated application row plus a `meta` block
 * (`stripeSync`, `auditNoteSaved`). 404 when no application exists
 * for the (student, year) pair.
 */

/** What happened on the Stripe side of a save. */
type StripeSync = "updated" | "not_started" | "failed";

const ECHO_CHECKED_COLUMNS = [
  "remaining_opportunity_amount",
  "sufs_amount",
  "annual_fee",
  "monthly_amount",
] as const satisfies ReadonlyArray<keyof PacketBillingValues>;

export async function POST(req: NextRequest) {
  try {
    const { admin } = await requireAdmin();
    const body = await req.json();

    const studentId = Number(body?.studentId);
    const yearId = Number(body?.yearId);
    if (!Number.isFinite(studentId) || studentId <= 0) {
      return NextResponse.json(
        { error: "studentId is required" },
        { status: 400 }
      );
    }
    if (!Number.isFinite(yearId) || yearId <= 0) {
      return NextResponse.json(
        { error: "yearId is required" },
        { status: 400 }
      );
    }

    // Optional numeric inputs. We distinguish "explicitly null"
    // (clear the column / treat as 0 in the math) from "undefined"
    // (don't change — fall back to the application row's existing
    // value).
    const hasSufs = Object.prototype.hasOwnProperty.call(
      body,
      "sufsAwardAmount"
    );
    const hasRemaining = Object.prototype.hasOwnProperty.call(
      body,
      "remainingOpportunityAmount"
    );
    const sufsInput: number | null | undefined = hasSufs
      ? body.sufsAwardAmount === null
        ? null
        : Number(body.sufsAwardAmount)
      : undefined;
    const remainingInput: number | null | undefined = hasRemaining
      ? body.remainingOpportunityAmount === null
        ? null
        : Number(body.remainingOpportunityAmount)
      : undefined;
    // A negative amount would push `monthly_amount` below the fee (or
    // below zero, which the Stripe re-price silently skips) — never a
    // real determination.
    if (
      hasSufs &&
      sufsInput !== null &&
      (!Number.isFinite(sufsInput as number) || (sufsInput as number) < 0)
    ) {
      return NextResponse.json(
        { error: "sufsAwardAmount must be a non-negative number or null" },
        { status: 400 }
      );
    }
    if (
      hasRemaining &&
      remainingInput !== null &&
      (!Number.isFinite(remainingInput as number) ||
        (remainingInput as number) < 0)
    ) {
      return NextResponse.json(
        {
          error:
            "remainingOpportunityAmount must be a non-negative number or null",
        },
        { status: 400 }
      );
    }

    const dryRun = body?.dryRun === true;
    const reason =
      typeof body?.reason === "string" ? body.reason.trim() : "";
    // The card re-sends an override (no new amounts) when the Stripe
    // half of the previous save failed.
    const stripeRetry = body?.stripeRetry === true;
    // Email the parents about the new monthly amount once Stripe has
    // it. On a retry the row already holds the new amount, so the
    // card passes the pre-change monthly it showed in the review.
    const notifyParents = body?.notifyParents === true;
    const retryPreviousMonthly = Number(body?.previousMonthly);

    // Resolve the application row and the school year in parallel.
    const [app, schoolYear] = await Promise.all([
      xano.applications.getByStudentAndYear(studentId, yearId),
      xano.schoolYears.getById(yearId),
    ]);
    if (!app) {
      return NextResponse.json(
        {
          error: `No application found for student ${studentId} in year ${yearId}.`,
        },
        { status: 404 }
      );
    }

    const sufsAwardAmount =
      sufsInput === undefined ? (app.sufs_amount ?? 0) : (sufsInput ?? 0);
    // "Remaining Amount Family Pays" reads/writes the dedicated
    // `remaining_opportunity_amount` column. When the caller doesn't
    // override, fall back to the stored value so partial updates
    // don't blow away the persisted input.
    const remainingOpportunityAmount =
      remainingInput === undefined
        ? app.remaining_opportunity_amount ?? 0
        : (remainingInput ?? 0);

    // An edit to a confirmed row with amounts on file is an override
    // of numbers the family signed against — same test the
    // Determination card uses to lock its dollar inputs.
    const before = resolveStudentReceiptAmounts(app);
    const isOverride =
      app.confirmed_scholarship === true && before.hasSavedDetermination;
    const storedAnnualFee =
      typeof app.annual_fee === "number" && Number.isFinite(app.annual_fee)
        ? app.annual_fee
        : null;

    const billingValues = derivePacketBillingValues({
      schoolYearTuition: schoolYear?.tuition ?? 0,
      schoolYearAnnualFees: schoolYear?.annual_fees ?? null,
      sufsAwardAmount,
      remainingOpportunityAmount,
      // Pre-confirmation, don't pass the existing per-row annual_fee
      // as an override — that would lock the row to its prior value
      // and ignore year-level policy updates. Falls through to school
      // year's `annual_fees` inside `derivePacketBillingValues`.
      // An override keeps the fee the family signed against, so a
      // year-level fee change can't ride along with an unrelated edit.
      annualFee: isOverride ? storedAnnualFee : null,
    });

    if (dryRun) {
      // `null` = couldn't tell (packet read failed). The dialog says
      // so rather than guessing either way.
      let billingLive: boolean | null = null;
      try {
        const packet = await findPacket(studentId, yearId);
        billingLive = Boolean(
          liveStripeSubscriptionItemId(packet?.stripe_subscription_item_id)
        );
      } catch (err) {
        console.error(
          "[/api/admin/student-registration/by-student] dry-run packet read failed:",
          err
        );
      }
      return NextResponse.json({
        dryRun: true,
        isOverride,
        billingLive,
        current: {
          sufs_amount: before.sufsAmount,
          remaining_opportunity_amount: before.remainingTuition,
          annual_fee: before.annualFee,
          monthly_amount: before.monthly,
        },
        next: {
          sufs_amount: billingValues.sufs_amount,
          remaining_opportunity_amount:
            billingValues.remaining_opportunity_amount,
          annual_fee: billingValues.annual_fee,
          monthly_amount: billingValues.monthly_amount,
        },
      } satisfies PerStudentBillingPreview);
    }

    const updatedApp = await xano.applications.update(app.id, billingValues);

    // Echo check on the four figures every receipt and Stripe read.
    // Xano drops inputs it treats as empty rather than erroring, and
    // a save that half-lands is worse than one that fails: the row
    // would show one amount while Stripe (priced off the echoed
    // `monthly_amount` below) bills another. Numeric compare, so a
    // `0` stored as null still counts as saved; a column the echo
    // leaves out entirely can't be judged and isn't flagged.
    const unsavedColumns = ECHO_CHECKED_COLUMNS.filter((column) => {
      const echoed = updatedApp[column];
      if (echoed === undefined) return false;
      const stored = Number(echoed ?? 0);
      return (
        !Number.isFinite(stored) ||
        Math.abs(stored - billingValues[column]) > 0.005
      );
    });
    if (unsavedColumns.length > 0) {
      console.error(
        `[/api/admin/student-registration/by-student] Xano did not store: ${unsavedColumns.join(", ")} (application ${app.id})`
      );
      await sendBillingAlert(
        "Tuition amounts not fully saved",
        [
          `A tuition change was sent to Xano, but these columns came back with a different value: ${unsavedColumns.join(", ")}.`,
          `The student's row may now disagree with itself — check it on the Scholarship Determination card before relying on it.`,
        ],
        {
          familyId: Number(updatedApp.registration_families_id),
          yearId,
          studentIds: [studentId],
          extra: { Application: `#${app.id}` },
        }
      );
    }

    // Re-price the Stripe SubscriptionItem when billing is live.
    // The packet carries `stripe_subscription_item_id`; we fetch it
    // and pair with the just-updated application's
    // `monthly_amount`. The Xano write above already landed, so a
    // Stripe failure doesn't fail the request — but it CANNOT pass
    // silently either: until the re-price lands, every admin/parent
    // surface shows the new amount while Stripe keeps invoicing the
    // old one. Alert staff so the drift gets fixed.
    let stripeSync: StripeSync = "not_started";
    try {
      const packet = await findPacket(studentId, yearId);
      const live = Boolean(
        liveStripeSubscriptionItemId(packet?.stripe_subscription_item_id)
      );
      await syncStripeForApplication(updatedApp, packet);
      if (live) stripeSync = "updated";
    } catch (err) {
      stripeSync = "failed";
      console.error(
        "[/api/admin/student-registration/by-student] Stripe re-price failed:",
        err
      );
      await sendBillingAlert(
        "Stripe re-price failed",
        [
          `This student's tuition was updated in the app, but the Stripe re-price failed — the family is still being invoiced at the OLD amount.`,
          `Re-save the amount on the Scholarship Determination card to retry, or update the subscription item in the Stripe Dashboard.`,
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        ],
        {
          familyId: Number(updatedApp.registration_families_id),
          yearId,
          studentIds: [studentId],
          extra: {
            "New monthly amount": `$${billingValues.monthly_amount}/mo`,
          },
        }
      );
    }

    // `null` = no note was due (not an override, or nothing moved).
    let auditNoteSaved: boolean | null = null;
    if (isOverride) {
      auditNoteSaved = await writeOverrideNote({
        admin,
        app: updatedApp,
        studentId,
        yearId,
        yearName: schoolYear?.year_name?.trim() || `Year #${yearId}`,
        before,
        after: billingValues,
        stripeSync,
        stripeRetry,
        reason,
      });
    }

    // `null` = no email was asked for or due.
    let parentEmailSent: boolean | null = null;
    const previousMonthly = stripeRetry
      ? retryPreviousMonthly
      : before.monthly;
    if (
      notifyParents &&
      isOverride &&
      stripeSync === "updated" &&
      Number.isFinite(previousMonthly) &&
      Math.abs(previousMonthly - billingValues.monthly_amount) > 0.005
    ) {
      parentEmailSent = await emailParentsAboutNewMonthly({
        app: updatedApp,
        studentId,
        yearId,
        yearName: schoolYear?.year_name?.trim() || `Year #${yearId}`,
        previousMonthly,
        newMonthly: billingValues.monthly_amount,
      });
    }

    return NextResponse.json({
      ...updatedApp,
      meta: { stripeSync, auditNoteSaved, unsavedColumns, parentEmailSent },
    });
  } catch (err) {
    return handleAdminError(err);
  }
}

/** Dry-run response — the figures the confirm dialog renders. */
export interface PerStudentBillingPreview {
  dryRun: true;
  /** The row is confirmed with amounts on file, so a save is an
   *  override of signed numbers (and will write an audit note). */
  isOverride: boolean;
  /** Student has a live Stripe subscription item, so a save re-prices
   *  it. `null` when the packet couldn't be read. */
  billingLive: boolean | null;
  current: PerStudentBillingFigures;
  next: PerStudentBillingFigures;
}

export interface PerStudentBillingFigures {
  sufs_amount: number;
  remaining_opportunity_amount: number;
  annual_fee: number;
  monthly_amount: number;
}

/**
 * Tell the parents a student's monthly payment changed, naming the
 * first invoice at the new amount when Stripe can say. Best-effort:
 * the re-price already landed, so a failure here only reports back.
 */
async function emailParentsAboutNewMonthly({
  app,
  studentId,
  yearId,
  yearName,
  previousMonthly,
  newMonthly,
}: {
  app: XanoApplication;
  studentId: number;
  yearId: number;
  yearName: string;
  previousMonthly: number;
  newMonthly: number;
}): Promise<boolean> {
  const familyId = Number(app.registration_families_id);
  if (!Number.isFinite(familyId) || familyId <= 0) return false;
  let firstInvoiceAt: number | null = null;
  try {
    const payment = await xano.familyPayments.getByFamilyAndYearStrict(
      familyId,
      yearId
    );
    const subscriptionId = activeStripeSubscriptionId(
      payment?.stripe_subscription_id
    );
    if (subscriptionId) {
      firstInvoiceAt = await getFirstInvoiceAtCurrentPriceMs(subscriptionId);
    }
  } catch (err) {
    // The email still goes out, saying "your next monthly invoice".
    console.error(
      "[/api/admin/student-registration/by-student] next invoice lookup failed:",
      err
    );
  }
  const result = await sendBillingAmountChangedEmail({
    familyId,
    yearId,
    studentId,
    yearName,
    previousMonthly,
    newMonthly,
    firstInvoiceAt,
  });
  return result.ok;
}

async function findPacket(studentId: number, yearId: number) {
  const yearPackets = await xano.studentRegistration.getByYear(yearId);
  return (
    yearPackets.find(
      (p) => Number(p.registration_students_id) === studentId
    ) ?? null
  );
}

function usd(value: number): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

/**
 * Record an amount override on the family's timeline. The tuition
 * signature stores no dollar amount and every receipt re-reads the
 * live application row, so after an override this note is the only
 * record of what the family originally signed against.
 *
 * Tagged `section: "billing"` so the activity stream files it under
 * Billing. Best-effort — the amounts are already saved, so a failed
 * write is reported back (`false`) rather than thrown. Returns `null`
 * when nothing moved and no note was due.
 *
 * A Stripe retry moves no amounts, but when it lands it still gets a
 * line: the note from the first attempt says the Stripe update
 * FAILED, and the timeline shouldn't end there.
 */
async function writeOverrideNote({
  admin,
  app,
  studentId,
  yearId,
  yearName,
  before,
  after,
  stripeSync,
  stripeRetry,
  reason,
}: {
  admin: AdminUser;
  app: XanoApplication;
  studentId: number;
  yearId: number;
  yearName: string;
  before: ReturnType<typeof resolveStudentReceiptAmounts>;
  after: PacketBillingValues;
  stripeSync: StripeSync;
  stripeRetry: boolean;
  reason: string;
}): Promise<boolean | null> {
  const changes: string[] = [];
  if (before.remainingTuition !== after.remaining_opportunity_amount) {
    changes.push(
      `Remaining amount family pays: ${usd(before.remainingTuition)} → ${usd(after.remaining_opportunity_amount)}`
    );
  }
  if (before.sufsAmount !== after.sufs_amount) {
    changes.push(
      `SUFS award: ${usd(before.sufsAmount)} → ${usd(after.sufs_amount)}`
    );
  }
  if (before.annualFee !== after.annual_fee) {
    changes.push(
      `Annual fee: ${usd(before.annualFee)} → ${usd(after.annual_fee)}`
    );
  }
  const monthlyChanged = before.monthly !== after.monthly_amount;
  const amountsMoved = changes.length > 0 || monthlyChanged;
  const retryLanded = stripeRetry && stripeSync === "updated";
  if (!amountsMoved && !retryLanded) return null;

  const familyId = Number(app.registration_families_id);
  if (!Number.isFinite(familyId) || familyId <= 0) return false;

  try {
    const student = await xano.students.getById(studentId).catch(() => null);
    const studentName =
      `${student?.first_name ?? ""} ${student?.last_name ?? ""}`.trim() ||
      `Student #${studentId}`;

    const stripeLine: Record<StripeSync, string> = {
      updated:
        "Stripe subscription updated — the new amount applies from the next invoice. Invoices already issued were not changed.",
      not_started:
        "Monthly billing hasn't started for this student, so nothing was sent to Stripe.",
      failed:
        "Stripe update FAILED — the family is still invoiced at the old amount until this is re-saved.",
    };

    const lines = amountsMoved
      ? [
          `Confirmed tuition amounts changed for ${studentName} (${yearName}).`,
          ...changes,
          monthlyChanged
            ? `Monthly billing: ${usd(before.monthly)} → ${usd(after.monthly_amount)}`
            : `Monthly billing: unchanged at ${usd(after.monthly_amount)}`,
          stripeLine[stripeSync],
          reason ? `Reason: ${reason}` : "No reason given.",
        ]
      : [
          `Stripe subscription updated for ${studentName} (${yearName}) on retry, after an earlier update failed.`,
          `Monthly billing: ${usd(after.monthly_amount)}, from the next invoice.`,
        ];

    await xano.adminNotes.create({
      registration_families_id: familyId,
      registration_students_id: studentId,
      registration_school_years_id: yearId,
      registration_student_registration_progress_id: null,
      registration_family_application_progress_id: null,
      author_email: admin.email,
      author_name: admin.name,
      body: lines.join("\n"),
      category: "other",
      is_pinned: false,
      section: "billing",
      is_shared_with_parent: false,
    });
    return true;
  } catch (err) {
    console.error(
      "[/api/admin/student-registration/by-student] override audit note failed:",
      err
    );
    return false;
  }
}

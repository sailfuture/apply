"use client";

import { Fragment } from "react";
import { HelpCircle } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type {
  AdminFamilyRegistrationResponse,
  AdminFamilyRegistrationStudentRow,
} from "@/app/api/admin/registrations/[id]/route";

/**
 * Shared admin per-student tuition breakdown ("the receipt").
 *
 * Extracted from the registration detail page so the per-family
 * billing schedule page can render the exact same table — both
 * surfaces must agree with the parent-facing `/dashboard/tuition`
 * view to the penny, so there is deliberately ONE implementation of
 * this math on the admin side.
 *
 * Data comes from `/api/admin/registrations/[id]` — pass its
 * `students`, `school_year`, and `scholarship` through unchanged.
 */

const SUFS_FIELDS: Record<string, keyof TuitionBreakdownSchoolYear> = {
  fes_eo_8: "fes_eo_8",
  fes_eo_9: "fes_eo_9",
  ftc_8: "ftc_8",
  ftc_9: "ftc_9",
  fes_ua_8_ese_1_3: "fes_ua_8_ese_1_3",
  fes_ua_9_ese_1_3: "fes_ua_9_ese_1_3",
  fes_ua_ese_4: "fes_ua_ese_4",
  fes_ua_ese_5: "fes_ua_ese_5",
};

/** Human label for each SUFS tier — same set the parent dashboard uses. */
const SUFS_LABELS: Record<string, string> = {
  fes_eo_8: "FES-EO (Grade 8)",
  fes_eo_9: "FES-EO (Grade 9)",
  ftc_8: "FTC (Grade 8)",
  ftc_9: "FTC (Grade 9)",
  fes_ua_8_ese_1_3: "FES-UA ESE 1-3 (Grade 8)",
  fes_ua_9_ese_1_3: "FES-UA ESE 1-3 (Grade 9)",
  fes_ua_ese_4: "FES-UA ESE 4",
  fes_ua_ese_5: "FES-UA ESE 5",
  // Admin-entered per-student amount (no school-year tier column);
  // the dollar value lives on `sufs_amount`.
  custom: "Custom amount",
};

export type TuitionBreakdownSchoolYear =
  AdminFamilyRegistrationResponse["school_year"];

function formatTuitionCurrency(value: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Render a colored status pill for the Step Up status column.
 *  Mirrors the same color mapping the parent-facing tuition table
 *  uses (Approved/Verified → green, Pending → amber, Denied → red,
 *  other → neutral). */
function tuitionStatusBadge(status: string) {
  if (!status) return null;
  const lower = status.toLowerCase();
  if (lower === "verified" || lower === "approved") {
    return (
      <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
        {status}
      </span>
    );
  }
  if (lower === "pending") {
    return (
      <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">
        {status}
      </span>
    );
  }
  if (lower === "denied" || lower === "rejected") {
    return (
      <span className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700">
        {status}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700">
      {status}
    </span>
  );
}

/**
 * Read-only per-student tuition breakdown — same table the parent
 * sees on `/dashboard/tuition`. Pure presentational: no inputs, no
 * editor jump-offs.
 *
 * Math mirrors `/dashboard/tuition` line-for-line — admin's view
 * has to agree with the parent's view to the penny, so we
 * deliberately re-implement the same formula here rather than
 * importing partial fragments and risking drift.
 *
 * Transportation is no longer a separate line item — it's been
 * rolled into the annual tuition figure. SNAP families still get
 * full OS coverage; their `opportunity_scholarship_award_amount`
 * is just 0, so the subtotal naturally collapses to the admin fee.
 */
export function TuitionBreakdownTable({
  students,
  schoolYear,
  scholarship,
}: {
  students: AdminFamilyRegistrationStudentRow[];
  schoolYear: TuitionBreakdownSchoolYear;
  /** Family-level scholarship summary. When the family is on the
   *  confirmed SNAP path, the per-app
   *  `opportunity_scholarship_award_amount` is null on purpose
   *  (admin doesn't enter a number — the Opportunity Scholarship
   *  covers whatever's left after SUFS). This block then renders
   *  the COMPUTED coverage (`tuition - SUFS`) on the
   *  Opportunity Scholarship Award line instead of "—". The
   *  per-student Cost Per Student line is gated on the family
   *  being on the OS path (`isOpportunityScholarship`). */
  scholarship: AdminFamilyRegistrationResponse["scholarship"];
}) {
  if (students.length === 0) {
    return null;
  }
  const tuition = schoolYear.tuition ?? 0;
  const adminFees = schoolYear.annual_fees ?? 0;
  // SNAP families with the SNAP award letter admin-confirmed get
  // the auto-coverage treatment. Pre-confirm SNAP families still
  // read the raw column so a half-set-up row doesn't get a
  // computed coverage that admin hasn't actually approved.
  const isSnapAutoCover =
    scholarship.isSNAPBenefits && scholarship.is_snap_confirmed;

  const rows = students.map((s) => {
    const sufsField = SUFS_FIELDS[s.sufs_type];
    // Prefer the canonical `sufs_amount` (the only home of a "Custom
    // amount" tier's typed value); the school-year tier derivation is
    // $0 for "custom". Fall back to the derivation for legacy rows
    // that pre-date the column.
    const stepUpAmount =
      typeof s.sufs_amount === "number"
        ? s.sufs_amount
        : sufsField
          ? (schoolYear[sufsField] as number | undefined) ?? 0
          : 0;
    // Remaining Tuition Amount comes from the application row's
    // `remaining_opportunity_amount` column — admin's "Remaining
    // Amount Family Pays" input on the Determination card.
    // Opportunity Scholarship Award is re-derived from inputs
    // (`tuition - SUFS - remaining`) so the displayed coverage is
    // always internally consistent with the row regardless of any
    // stale stored `opportunity_award_amount`. SNAP families have
    // `remaining === 0`, so the coverage collapses to `tuition - SUFS`
    // automatically. The `null` sentinel below distinguishes "no
    // scholarship determination at all" from "$0 award" so the
    // rendered row shows `—` instead of $0 for opted-out families.
    const familyPaysForTuition = s.remaining_opportunity_amount ?? 0;
    const hasOSDetermination =
      isSnapAutoCover ||
      scholarship.isOpportunityScholarship === true ||
      s.remaining_opportunity_amount != null;
    // Per-student award is only "finalized" once admin clicks
    // Confirm Scholarship Award Amount on the family-page
    // Determination card. Until then, the Opportunity Scholarship
    // Award row stays blank — admin shouldn't see a dollar value
    // before it's locked in.
    const awardConfirmed = s.confirmed_scholarship === true;
    const scholarshipAmount: number | null = hasOSDetermination
      ? Math.max(0, tuition - stepUpAmount - familyPaysForTuition)
      : null;
    const subtotal = familyPaysForTuition + adminFees;
    return {
      studentName: s.student_full_name,
      tuition,
      stepUpStatus: s.sufs_status,
      stepUpType: s.sufs_type,
      stepUpAmount,
      scholarshipAmount,
      awardConfirmed,
      adminFees,
      familyPaysForTuition,
      hasOSDetermination,
      subtotal,
    };
  });
  const grandTotal = rows.reduce((sum, r) => sum + r.subtotal, 0);
  const yearName = schoolYear.year_name ?? "";

  return (
    <div className="rounded-md border bg-white overflow-hidden">
      <table className="w-full text-sm">
        <tbody>
          {rows.map((row, idx) => (
            <Fragment key={idx}>
              {/* Student group header */}
              <tr className="bg-muted/40 border-t first:border-t-0">
                <td colSpan={2} className="px-4 py-3">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Student
                  </span>
                  <span className="mx-2 text-muted-foreground">—</span>
                  <span className="font-semibold text-foreground">
                    {row.studentName}
                  </span>
                </td>
              </tr>

              {/* Annual Tuition */}
              <tr className="border-t">
                <td className="px-4 py-3 text-muted-foreground">
                  Annual Tuition
                </td>
                <td className="px-4 py-3 text-right font-medium">
                  ${formatTuitionCurrency(row.tuition)}
                </td>
              </tr>

              {/* Step Up Status */}
              <tr className="border-t">
                <td className="px-4 py-3 text-muted-foreground">
                  Step Up for Students Award Status
                </td>
                <td className="px-4 py-3 text-right">
                  {row.stepUpStatus ? (
                    tuitionStatusBadge(row.stepUpStatus)
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
              </tr>

              {/* Step Up Type */}
              <tr className="border-t">
                <td className="px-4 py-3 text-muted-foreground">
                  Step Up for Students Award Type
                </td>
                <td className="px-4 py-3 text-right font-medium">
                  {row.stepUpType && SUFS_LABELS[row.stepUpType] ? (
                    SUFS_LABELS[row.stepUpType]
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
              </tr>

              {/* Step Up Amount */}
              <tr className="border-t">
                <td className="px-4 py-3 text-muted-foreground">
                  Step Up for Students Award Amount
                </td>
                <td className="px-4 py-3 text-right font-medium text-green-600">
                  {row.stepUpAmount > 0
                    ? `-$${formatTuitionCurrency(row.stepUpAmount)}`
                    : "$0.00"}
                </td>
              </tr>

              {/* Opportunity Scholarship */}
              <tr className="border-t">
                <td className="px-4 py-3 text-muted-foreground">
                  Opportunity Scholarship Award
                </td>
                <td className="px-4 py-3 text-right font-medium text-green-600">
                  {row.awardConfirmed &&
                  row.scholarshipAmount != null &&
                  row.scholarshipAmount > 0 ? (
                    `-$${formatTuitionCurrency(row.scholarshipAmount)}`
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
              </tr>

              {/* Remaining Tuition Amount — the per-student tuition
                  the family still owes after the Opportunity
                  Scholarship has been applied. Same value baked into
                  the subtotal below, broken out as its own row.
                  Renders whenever the row has a determination
                  (admin entered a per-student amount, OR family is
                  flagged on OS, OR family is on SNAP) — covers the
                  common case where admin has entered the amount but
                  hasn't yet explicitly set the scholarship path flag. */}
              {row.hasOSDetermination ? (
                <tr className="border-t">
                  <td className="px-4 py-3 text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      Remaining Tuition Amount
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className="inline-flex text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                          >
                            <HelpCircle className="size-3.5" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent
                          side="top"
                          className="max-w-xs text-xs"
                        >
                          {scholarship.isSNAPBenefits ? (
                            <p>
                              SNAP-qualified families have no remaining
                              tuition — the Opportunity Scholarship covers
                              the full per-student amount.
                            </p>
                          ) : (
                            <p>
                              The per-student tuition the family still owes
                              after the Opportunity Scholarship has been
                              applied.
                            </p>
                          )}
                        </TooltipContent>
                      </Tooltip>
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-medium">
                    ${formatTuitionCurrency(row.familyPaysForTuition)}
                  </td>
                </tr>
              ) : null}

              {/* Annual Admin Fee — sits directly above the
                  subtotal so the receipt reads top-to-bottom: gross
                  tuition, awards that offset it, then the line
                  items that make up what the family actually owes
                  (remaining tuition + admin fee = subtotal). */}
              <tr className="border-t">
                <td className="px-4 py-3 text-muted-foreground">
                  Annual Admin Fee
                </td>
                <td className="px-4 py-3 text-right font-medium">
                  ${formatTuitionCurrency(row.adminFees)}
                </td>
              </tr>

              {/* Student subtotal */}
              <tr className="border-t bg-muted/20">
                <td className="px-4 py-3 font-medium">
                  Subtotal — {row.studentName}
                </td>
                <td className="px-4 py-3 text-right font-semibold">
                  ${formatTuitionCurrency(row.subtotal)}
                </td>
              </tr>
            </Fragment>
          ))}

          {/* Grand total — title carries the school year in parens
              so admin always knows which year's receipt they're
              looking at without scrolling back to the page header.
              Same pattern as the parent dashboard's tuition table. */}
          <tr className="border-t-2 bg-white">
            <td className="px-4 py-3 font-bold">
              Total Annual Due
              {yearName ? (
                <span className="ml-1.5 font-normal text-muted-foreground">
                  — School Year ({yearName})
                </span>
              ) : null}
            </td>
            <td className="px-4 py-3 text-right font-bold">
              ${formatTuitionCurrency(grandTotal)}
            </td>
          </tr>
          <tr className="border-t bg-white">
            <td className="px-4 py-3 font-bold">
              Monthly Payment (Aug – Jul, 12 months)
            </td>
            <td className="px-4 py-3 text-right font-bold">
              ${formatTuitionCurrency(grandTotal / 12)}/mo
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

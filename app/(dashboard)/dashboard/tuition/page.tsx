"use client";

import { Fragment, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useStudents, useApplications, useSchoolYears } from "@/hooks/use-api";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { HelpCircle } from "lucide-react";
import { DashboardPageHeader } from "@/components/dashboard-page-header";

/** Maps sufs_type to the corresponding SchoolYear field. Same mapping used
 *  in the registration tuition page. */
const SUFS_FIELDS: Record<string, string> = {
  fes_eo_8: "fes_eo_8",
  fes_eo_9: "fes_eo_9",
  ftc_8: "ftc_8",
  ftc_9: "ftc_9",
  fes_ua_8_ese_1_3: "fes_ua_8_ese_1_3",
  fes_ua_9_ese_1_3: "fes_ua_9_ese_1_3",
  fes_ua_ese_4: "fes_ua_ese_4",
  fes_ua_ese_5: "fes_ua_ese_5",
};

const SUFS_LABELS: Record<string, string> = {
  fes_eo_8: "FES-EO (Grade 8)",
  fes_eo_9: "FES-EO (Grade 9)",
  ftc_8: "FTC (Grade 8)",
  ftc_9: "FTC (Grade 9)",
  fes_ua_8_ese_1_3: "FES-UA ESE 1-3 (Grade 8)",
  fes_ua_9_ese_1_3: "FES-UA ESE 1-3 (Grade 9)",
  fes_ua_ese_4: "FES-UA ESE 4",
  fes_ua_ese_5: "FES-UA ESE 5",
};

interface StudentRow {
  studentName: string;
  tuition: number;
  stepUpStatus: string;
  stepUpType: string;
  stepUpAmount: number;
  scholarshipAmount: number | null;
  remaining: number;
  adminFees: number;
  transportFees: number;
  usesTransport: boolean;
  busStop: string;
  subtotal: number;
}

function formatCurrency(value: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function getStatusBadge(status: string) {
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
 * Tuition & Fees detail page on the parent dashboard.
 *
 * Renders the same per-student cost breakdown the parent reviewed and
 * signed during registration — annual tuition, Step Up scholarship,
 * Opportunity scholarship, admin + transportation fees, monthly payment.
 * Read-only; the registration page is where the signature gets captured.
 */
export default function DashboardTuitionPage() {
  const searchParams = useSearchParams();
  const yearIdParam = searchParams.get("yearId");
  const requestedYearId = yearIdParam ? Number(yearIdParam) : null;

  const { data: students } = useStudents();
  const { data: applications } = useApplications();
  const { data: yearsData } = useSchoolYears();

  // Defensive fallback: if no `?yearId` was passed (e.g. parent landed
  // here from a stale link), pick the most recent year that this family
  // has any application for. The dashboard normally writes the resolved
  // year to the URL, but this keeps the page useful in either case.
  const resolvedYearId: number | null = useMemo(() => {
    if (requestedYearId !== null) return requestedYearId;
    if (!applications) return null;
    const ids = Array.from(
      new Set(
        (applications as { registration_school_years_id: number }[]).map(
          (a) => a.registration_school_years_id
        )
      )
    );
    if (ids.length === 0) return null;
    return ids.reduce((max, yid) => (yid > max ? yid : max));
  }, [requestedYearId, applications]);

  const yearId = resolvedYearId;
  const dashboardHref = yearId ? `/dashboard?yearId=${yearId}` : "/dashboard";

  const schoolYear = useMemo(() => {
    if (!yearsData || !yearId) return null;
    return (
      (yearsData as { id: number; year_name?: string; [k: string]: unknown }[]).find(
        (y) => y.id === yearId
      ) ?? null
    );
  }, [yearsData, yearId]);

  const yearName = (schoolYear?.year_name as string | undefined) ?? "current";

  // Build per-student rows from the same data the registration tuition page
  // reads — application + school year fields drive the math.
  const studentRows: StudentRow[] = useMemo(() => {
    if (!students || !applications || !schoolYear || !yearId) return [];
    const yearApps = (
      applications as {
        registration_school_years_id: number;
        registration_students_id: number;
        is_bus_transportation?: boolean;
        bus_stop?: string;
        sufs_status?: string;
        sufs_type?: string;
        opportunity_scholarship_award_amount?: number;
      }[]
    ).filter((a) => a.registration_school_years_id === yearId);

    const sy = schoolYear as Record<string, unknown>;
    const rows: StudentRow[] = [];

    for (const app of yearApps) {
      const student = (
        students as { id: number; first_name: string; last_name: string }[]
      ).find((s) => s.id === app.registration_students_id);
      if (!student) continue;

      const tuition = (sy.tuition as number) ?? 0;
      const adminFees = (sy.annual_fees as number) ?? 0;
      const transportFees = (sy.transportation_fees as number) ?? 0;

      const sufsType = app.sufs_type ?? "";
      const sufsField = SUFS_FIELDS[sufsType];
      const stepUpAmount =
        sufsField && sy[sufsField] ? (sy[sufsField] as number) : 0;
      const stepUpStatus = app.sufs_status ?? "";
      const scholarshipAmount = app.opportunity_scholarship_award_amount ?? null;

      const remaining = Math.max(
        0,
        tuition - stepUpAmount - (scholarshipAmount ?? 0)
      );
      const usesTransport = !!app.is_bus_transportation;
      const subtotal =
        remaining + adminFees + (usesTransport ? transportFees : 0);

      rows.push({
        studentName: `${student.first_name} ${student.last_name}`,
        tuition,
        stepUpStatus,
        stepUpType: sufsType,
        stepUpAmount,
        scholarshipAmount,
        remaining,
        adminFees,
        transportFees,
        usesTransport,
        busStop: app.bus_stop ?? "",
        subtotal,
      });
    }
    return rows;
  }, [students, applications, schoolYear, yearId]);

  const grandTotal = studentRows.reduce((sum, r) => sum + r.subtotal, 0);

  const loading = !students || !applications || !yearsData;

  return (
    <div className="flex flex-1 flex-col gap-6 p-6 mx-auto w-full max-w-4xl">
      <DashboardPageHeader
        backHref={dashboardHref}
        backLabel="Back to Dashboard"
        breadcrumb={[
          { label: "Dashboard", href: dashboardHref },
          // Academic year sits between Dashboard and the page label so
          // the parent always knows which year they're viewing — no need
          // to scroll up to the year picker.
          { label: yearName, href: dashboardHref },
          { label: "Tuition & Fees" },
        ]}
        title={`${yearName} academic year — payment schedule`}
        subtitle={`Per-student breakdown of tuition, scholarships, and fees for the ${yearName} school year. Same breakdown you reviewed and signed during registration.`}
      />

      {loading ? (
        <Skeleton className="h-96 w-full rounded-xl" />
      ) : studentRows.length === 0 ? (
        <div className="rounded-xl border bg-white px-6 py-12 text-center">
          <p className="text-muted-foreground text-sm">
            No students found for this school year.
          </p>
        </div>
      ) : (
        <div className="rounded-xl bg-background p-1.5 shadow-sm border">
          <div className="overflow-hidden rounded-lg border bg-white">
            <table className="w-full text-sm">
              <tbody>
                {studentRows.map((row, idx) => (
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
                        ${formatCurrency(row.tuition)}
                      </td>
                    </tr>

                    {/* Step Up Status */}
                    <tr className="border-t">
                      <td className="px-4 py-3 text-muted-foreground">
                        Step Up for Students Award Status
                      </td>
                      <td className="px-4 py-3 text-right">
                        {row.stepUpStatus ? (
                          getStatusBadge(row.stepUpStatus)
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>

                    {/* Step Up Type */}
                    <tr className="border-t">
                      <td className="px-4 py-3 text-muted-foreground">
                        <span className="inline-flex items-center gap-1.5">
                          Step Up for Students Award Type
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
                              <p>
                                The Step Up for Students award type is
                                determined by the scholarship program your
                                student was approved for. Award amount varies
                                by program type and grade level.
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        </span>
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
                          ? `-$${formatCurrency(row.stepUpAmount)}`
                          : "$0.00"}
                      </td>
                    </tr>

                    {/* Opportunity Scholarship */}
                    <tr className="border-t">
                      <td className="px-4 py-3 text-muted-foreground">
                        <span className="inline-flex items-center gap-1.5">
                          Opportunity Scholarship Award
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
                              <p>
                                The Opportunity Scholarship award is
                                determined based on your household income,
                                household size, and assets as reported in the
                                Financial Aid application.
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-green-600">
                        {row.scholarshipAmount != null && row.scholarshipAmount > 0 ? (
                          `-$${formatCurrency(row.scholarshipAmount)}`
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>

                    {/* Admin Fee */}
                    <tr className="border-t">
                      <td className="px-4 py-3 text-muted-foreground">
                        <span className="inline-flex items-center gap-1.5">
                          Annual Admin Fee
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
                              <p>
                                Covers registration, technology, materials,
                                and other operational costs. Required for all
                                enrolled students.
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-medium">
                        ${formatCurrency(row.adminFees)}
                      </td>
                    </tr>

                    {/* Transport Fee */}
                    <tr className="border-t">
                      <td className="px-4 py-3 text-muted-foreground">
                        <span className="inline-flex items-center gap-1.5">
                          Transportation Fee
                          {!row.usesTransport && (
                            <span className="text-xs text-muted-foreground/60">
                              (N/A)
                            </span>
                          )}
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
                              {row.usesTransport ? (
                                <p>
                                  Bus transportation has been selected for this
                                  student.
                                  {row.busStop
                                    ? ` Assigned bus stop: ${row.busStop}.`
                                    : ""}
                                </p>
                              ) : (
                                <p>
                                  Bus transportation was not selected for this
                                  student. This fee does not apply.
                                </p>
                              )}
                            </TooltipContent>
                          </Tooltip>
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-medium">
                        {row.usesTransport ? (
                          `$${formatCurrency(row.transportFees)}`
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>

                    {/* Student subtotal */}
                    <tr className="border-t bg-muted/20">
                      <td className="px-4 py-3 font-medium">
                        Subtotal — {row.studentName}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold">
                        ${formatCurrency(row.subtotal)}
                      </td>
                    </tr>
                  </Fragment>
                ))}

                {/* Grand total + monthly */}
                <tr className="border-t-2 bg-white">
                  <td className="px-4 py-3 font-bold">Total Due</td>
                  <td className="px-4 py-3 text-right font-bold">
                    ${formatCurrency(grandTotal)}
                  </td>
                </tr>
                <tr className="border-t bg-white">
                  <td className="px-4 py-3 font-bold">
                    Monthly Payment (Aug – Jul, 12 months)
                  </td>
                  <td className="px-4 py-3 text-right font-bold">
                    ${formatCurrency(grandTotal / 12)}/mo
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground text-center pt-4 border-t">
        Payment history and balance details will appear here once Stripe
        billing syncs are live. For questions about your account in the
        meantime, please{" "}
        <a
          href="mailto:tward@sailfuture.org?subject=Tuition%20question"
          className="text-primary underline underline-offset-2"
        >
          contact the office
        </a>
        .
      </p>
    </div>
  );
}


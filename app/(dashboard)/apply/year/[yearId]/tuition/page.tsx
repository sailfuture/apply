"use client";

import { Fragment, useEffect, useState, useRef, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { toast } from "sonner";
import { useApplicationFlow } from "@/contexts/application-flow-context";
import { useStudentRegistrationProgress } from "@/hooks/use-student-registration-progress";
import {
  useStudents,
  useApplications,
  useSchoolYears,
  useFamily,
  useScholarship,
} from "@/hooks/use-api";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import { CheckCircle2, Loader2, HelpCircle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import SignatureCanvas from "react-signature-canvas";

/** Human-readable labels for SUFS award types */
const SUFS_LABELS: Record<string, string> = {
  fes_eo_8: "FES-EO · Grade 8",
  fes_eo_9: "FES-EO · Grade 9",
  ftc_8: "FTC · Grade 8",
  ftc_9: "FTC · Grade 9",
  fes_ua_8_ese_1_3: "FES-UA · ESE 1-3 · Grade 8",
  fes_ua_9_ese_1_3: "FES-UA · ESE 1-3 · Grade 9",
  fes_ua_ese_4: "FES-UA · ESE 4",
  fes_ua_ese_5: "FES-UA · ESE 5",
};

interface StudentRow {
  studentName: string;
  tuition: number;
  stepUpStatus: string;
  stepUpAmount: number;
  scholarshipAmount: number | null;
  remaining: number;
  stepUpType: string;
  adminFees: number;
  /** Per-student tuition portion the family pays under the
   *  Opportunity Scholarship determination — surfaced as its own
   *  line when the family is on the OS path. Same value baked into
   *  `subtotal`. */
  familyPaysForTuition: number;
  /** True when this row has an OS determination — either the
   *  family is flagged on OS / SNAP or admin has entered a
   *  per-student award amount. Gates both the OS Award coverage
   *  line and the OS Cost Per Student breakout. */
  hasOSDetermination: boolean;
  subtotal: number;
}

function formatCurrency(value: number): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getStatusBadge(status: string) {
  if (!status) return null;
  const lower = status.toLowerCase();
  if (lower === "verified" || lower === "approved") {
    return <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">{status}</span>;
  }
  if (lower === "pending") {
    return <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">{status}</span>;
  }
  if (lower === "denied" || lower === "rejected") {
    return <span className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700">{status}</span>;
  }
  return <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700">{status}</span>;
}

export default function TuitionPage() {
  const params = useParams();
  const router = useRouter();
  const yearId = Number(params.yearId);
  const { user } = useUser();
  const { setPageTitle, registerSaveHandler, unregisterSaveHandler, updateSaveOptions } = useApplicationFlow();
  // Registration-progress bridge row — single source of truth.
  //   - `isTuition`            → section-complete bool
  //   - `signature_data`       → the tuition signature image / file
  //                              metadata (canonical home — matches
  //                              the admin's tuition signature
  //                              reader and the volunteer page's
  //                              `signature_data_volunteer` shape)
  //   - `name`                 → the parent's typed full name
  // Nothing else on this page writes completion state. Older rows
  // may carry the signature on the deprecated
  // `tuition_scholarship_signature` field; the load below falls
  // back to that for backwards-compat reads but every WRITE now
  // lands on `signature_data`.
  const {
    progress: regProgress,
    setSection: setRegSection,
    patchProgress: patchRegProgress,
  } = useStudentRegistrationProgress(yearId);
  const { data: students } = useStudents();
  const { data: applications } = useApplications();
  const { data: yearsData } = useSchoolYears();
  // Per-student billing math lives on the application row now —
  // the `applications` data above already carries it. Packet table
  // no longer holds tuition columns.
  // Scholarship row drives the Remaining Tuition Amount breakout —
  // when the family is on the OS path we render a dedicated
  // "Remaining Tuition Amount" line right above the subtotal so the
  // parent sees what they still owe for tuition after scholarships,
  // separately from the OS coverage line (which shows as a
  // discount on the row above).
  const { data: familyData } = useFamily();
  const familyIdForScholarship =
    (familyData as { id?: number } | undefined)?.id ?? null;
  const { data: scholarshipData } = useScholarship(
    familyIdForScholarship,
    yearId
  );
  const isOpportunityScholarshipFamily =
    (scholarshipData as { isOpportunityScholarship?: boolean } | null)
      ?.isOpportunityScholarship === true;
  const isSnapFamily =
    (scholarshipData as { isSNAPBenefits?: boolean } | null)
      ?.isSNAPBenefits === true;

  const [submitting, setSubmitting] = useState(false);
  const [signatureMeta, setSignatureMeta] = useState<Record<string, unknown> | null>(null);
  const [signatureUploading, setSignatureUploading] = useState(false);
  const [printedName, setPrintedName] = useState("");
  const sigCanvasRef = useRef<SignatureCanvas>(null);

  // Hydrate the printed-name field once the progress row arrives. Keyed on
  // the row so an async load overwrites the empty default exactly once.
  const nameLoadedRef = useRef(false);
  useEffect(() => {
    if (nameLoadedRef.current) return;
    if (!regProgress) return;
    if (regProgress.name) setPrintedName(regProgress.name);
    nameLoadedRef.current = true;
  }, [regProgress]);

  // Completion is read directly off the bool — no legacy fallbacks.
  const alreadyReviewed = regProgress?.isTuition === true;

  // Load the persisted signature from the progress row and draw it onto the
  // canvas on first render. Keyed on the row itself so the load retries if
  // the row arrives late. Reads `signature_data` first (canonical) and
  // falls back to `tuition_scholarship_signature` for rows written by the
  // previous version of this page before the field was unified.
  const signatureLoadedRef = useRef(false);
  useEffect(() => {
    if (signatureLoadedRef.current) return;
    const persisted = (regProgress?.signature_data ??
      regProgress?.tuition_scholarship_signature) as
      | { path?: string; url?: string }
      | null
      | undefined;
    if (!persisted || !persisted.path) return;

    setSignatureMeta(persisted as Record<string, unknown>);
    signatureLoadedRef.current = true;

    const url =
      persisted.url ??
      `${process.env.NEXT_PUBLIC_XANO_BASE ?? "https://xsc3-mvx7-r86m.n7e.xano.io"}${persisted.path}`;

    setTimeout(async () => {
      const canvas = sigCanvasRef.current;
      if (!canvas) return;
      try {
        const res = await fetch(url);
        const blob = await res.blob();
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          const rawCanvas = canvas.getCanvas();
          canvas.fromDataURL(dataUrl, {
            width: rawCanvas.offsetWidth,
            height: rawCanvas.offsetHeight,
          });
        };
        reader.readAsDataURL(blob);
      } catch (err) {
        console.error("Failed to load signature:", err);
      }
    }, 300);
  }, [regProgress]);

  const handleSubmitRef = useRef<() => Promise<void>>(() => Promise.resolve());

  useEffect(() => {
    setPageTitle("Tuition");
    registerSaveHandler(() => handleSubmitRef.current());
    return () => unregisterSaveHandler();
  }, [setPageTitle, registerSaveHandler, unregisterSaveHandler]);

  // Unlocked state — allows editing even if already reviewed
  const [unlocked, setUnlocked] = useState(false);

  // Unlock handler — flip `isTuition` back to false so the parent can edit
  // the signature and re-submit. We leave the signature JSON in place; it
  // just gets overwritten by the next save.
  async function handleUnlock() {
    setUnlocked(true);
    try {
      await setRegSection("isTuition", false);
    } catch {
      console.error("Failed to unlock tuition section");
    }
  }

  // Lock handler — re-locks the section
  function handleLock() {
    setUnlocked(false);
  }

  // Update the Complete Section button state. Wait for the progress row to
  // resolve so we don't briefly flicker "Complete" on top of an already-done
  // state.
  useEffect(() => {
    if (regProgress === null) return; // still loading
    if (alreadyReviewed && !unlocked) {
      updateSaveOptions({
        completed: true,
        completedLabel: "Tuition Section Completed",
        disabled: true,
        onUnlock: handleUnlock,
        isUnlocked: false,
      });
    } else {
      updateSaveOptions({
        label: "Complete Tuition Section",
        // Require both a drawn signature AND a printed name before the
        // section can be completed.
        disabled: !signatureMeta || signatureUploading || printedName.trim() === "",
        saving: submitting,
        completed: false,
        onUnlock: alreadyReviewed ? handleLock : undefined,
        isUnlocked: unlocked,
      });
    }
  }, [signatureMeta, signatureUploading, submitting, alreadyReviewed, unlocked, regProgress, printedName, updateSaveOptions]); // eslint-disable-line react-hooks/exhaustive-deps

  const loading = !students || !applications || !yearsData;

  // Find the school year for cost data
  const schoolYear = useMemo(() => {
    if (!yearsData) return null;
    return (yearsData as { id: number; [key: string]: unknown }[]).find(
      (y) => y.id === yearId
    ) as (typeof yearsData extends (infer T)[] ? T : never) | undefined ?? null;
  }, [yearsData, yearId]);

  // Build per-student rows from per-year application values — the
  // application row carries the authoritative per-student tuition
  // figures (sufs_amount, opportunity_award_amount, tuition_sub_total,
  // annual_fee) that admin enters on the Scholarship Determination
  // card.
  const studentRows: StudentRow[] = useMemo(() => {
    if (!students || !applications || !schoolYear) return [];

    const yearApps = (applications as {
      registration_school_years_id: number;
      registration_students_id: number;
      sufs_status?: string;
      sufs_type?: string;
      sufs_amount?: number | null;
      opportunity_award_amount?: number | null;
      annual_fee?: number | null;
      remaining_opportunity_amount?: number | null;
    }[]).filter((a) => a.registration_school_years_id === yearId);

    const rows: StudentRow[] = [];
    const sy = schoolYear as Record<string, unknown>;

    for (const app of yearApps) {
      const student = (students as { id: number; first_name: string; last_name: string }[])
        .find((s) => s.id === app.registration_students_id);
      if (!student) continue;

      const tuition = (sy.tuition as number) ?? 0;
      const sufsType = app.sufs_type ?? "";
      const stepUpStatus = app.sufs_status ?? "";

      // Read per-student billing values directly from the application
      // row's "input" columns (`sufs_amount`, `remaining_opportunity_amount`,
      // `annual_fee`). Subtotal is derived client-side so the displayed
      // numbers stay internally consistent even if any stored
      // "summary" column (`tuition_sub_total`, `monthly_amount`) drifted
      // due to a partial write or schema migration.
      const stepUpAmount =
        typeof app.sufs_amount === "number" ? app.sufs_amount : 0;
      const adminFees =
        typeof app.annual_fee === "number" ? app.annual_fee : 0;
      // "Remaining Tuition Amount" — admin's input on the Determination
      // card. Source of truth lives on `remaining_opportunity_amount`.
      const familyPaysForTuition =
        typeof app.remaining_opportunity_amount === "number"
          ? app.remaining_opportunity_amount
          : 0;
      // Opportunity Scholarship coverage — re-derived from the
      // inputs so the parent's view always matches the math regardless
      // of any stale stored `opportunity_award_amount`. Equals
      // `tuition - sufs - remaining`.
      const scholarshipCoverage = Math.max(
        tuition - stepUpAmount - familyPaysForTuition,
        0
      );
      // Per-student subtotal — what the family actually owes for this
      // student per year. Computed from inputs, not read from the
      // stored `tuition_sub_total` column.
      const subtotal = familyPaysForTuition + adminFees;

      // OS determination signal — true when family flagged OS/SNAP
      // OR admin has entered any per-student determination
      // (anything non-zero on the packet's billing columns).
      const hasOSDetermination =
        isOpportunityScholarshipFamily ||
        isSnapFamily ||
        familyPaysForTuition > 0 ||
        scholarshipCoverage > 0;

      rows.push({
        studentName: `${student.first_name} ${student.last_name}`,
        tuition,
        stepUpStatus,
        stepUpType: sufsType,
        stepUpAmount,
        scholarshipAmount: hasOSDetermination ? scholarshipCoverage : 0,
        remaining: hasOSDetermination ? scholarshipCoverage : 0,
        adminFees,
        familyPaysForTuition,
        hasOSDetermination,
        subtotal,
      });
    }

    return rows;
  }, [
    students,
    applications,
    schoolYear,
    yearId,
    isOpportunityScholarshipFamily,
    isSnapFamily,
  ]);

  // Totals
  const grandTotal = studentRows.reduce((sum, r) => sum + r.subtotal, 0);

  async function handleSignatureEnd() {
    if (!sigCanvasRef.current || sigCanvasRef.current.isEmpty()) return;
    const dataUrl = sigCanvasRef.current.toDataURL("image/png");
    setSignatureUploading(true);
    try {
      const blob = await fetch(dataUrl).then((r) => r.blob());
      const file = new File([blob], "tuition-signature.png", { type: "image/png" });
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      if (res.ok) {
        const meta = await res.json();
        setSignatureMeta(meta);
      }
    } catch (err) {
      console.error("Signature upload failed:", err);
    } finally {
      setSignatureUploading(false);
    }
  }

  function clearSignature() {
    sigCanvasRef.current?.clear();
    setSignatureMeta(null);
  }

  async function handleSubmitReview(): Promise<void> {
    if (alreadyReviewed) return;

    if (!signatureMeta) {
      toast.error("Please sign above to confirm your review.");
      throw new Error("Signature required");
    }
    if (printedName.trim() === "") {
      toast.error("Please type your full name to confirm your review.");
      throw new Error("Printed name required");
    }
    setSubmitting(true);
    try {
      // One PATCH — signature + printed name + completion bool land on the
      // same row in the same request. The server stamps `last_edited`
      // automatically and latches `submitted_date` if this is the last
      // section needed.
      //
      // Signature lands on `signature_data` (canonical). The retired
      // `tuition_scholarship_signature` column is intentionally not
      // touched on writes; loads fall back to it for backwards-compat
      // reads of rows written by the older code path.
      await patchRegProgress({
        isTuition: true,
        signature_data: signatureMeta,
        name: printedName.trim(),
      });
      toast.success("Tuition review submitted successfully.");
    } catch {
      toast.error("Failed to submit tuition review. Please try again.");
      throw new Error("Submit failed");
    } finally {
      setSubmitting(false);
    }
  }
  handleSubmitRef.current = handleSubmitReview;

  if (loading) {
    return (
      <div className="flex flex-1 flex-col gap-6 p-6 mx-auto w-full max-w-4xl">
        <div className="text-center xl:text-left">
          <Skeleton className="h-7 w-80 mb-2" />
          <Skeleton className="h-4 w-96" />
        </div>
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-6 mx-auto w-full max-w-4xl">
      <div className="flex items-start justify-between gap-4">
        <div className="text-center xl:text-left">
          <h1 className="text-2xl font-semibold">Tuition & Scholarship Breakdown</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Review your financial aid award and tuition payment details for the upcoming school year.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() => {
            window.print();
          }}
        >
          <svg className="size-4 mr-1.5" viewBox="0 0 20 20" fill="currentColor">
            <path d="M13.75 7h-7.5a.75.75 0 01-.75-.75V3.25a.75.75 0 01.75-.75h7.5a.75.75 0 01.75.75v3a.75.75 0 01-.75.75zM5.5 9.25a.75.75 0 000 1.5h.25a.75.75 0 000-1.5H5.5z" />
            <path fillRule="evenodd" d="M3.5 7A1.5 1.5 0 002 8.5v4A1.5 1.5 0 003.5 14h.75v2.25a.75.75 0 00.75.75h10a.75.75 0 00.75-.75V14h.75a1.5 1.5 0 001.5-1.5v-4A1.5 1.5 0 0016.5 7h-13zm10 5.5H6.5v3.5h7v-3.5z" clipRule="evenodd" />
          </svg>
          Download PDF
        </Button>
      </div>

      {studentRows.length === 0 ? (
        <div className="rounded-lg border bg-white px-6 py-12 text-center">
          <p className="text-muted-foreground text-sm">No students found for this school year.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Single consolidated table */}
          <div className="rounded-lg border bg-white overflow-hidden">
            <table className="w-full text-sm">
              <tbody>
                {studentRows.map((row, idx) => (
                  <Fragment key={idx}>
                    {/* Student group header */}
                    <tr className="bg-muted/40 border-t first:border-t-0">
                      <td colSpan={2} className="px-4 py-3">
                        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Student</span>
                        <span className="mx-2 text-muted-foreground">—</span>
                        <span className="font-semibold text-foreground">{row.studentName}</span>
                      </td>
                    </tr>

                    {/* Annual Tuition */}
                    <tr className="border-t">
                      <td className="px-4 py-3 text-muted-foreground">Annual Tuition</td>
                      <td className="px-4 py-3 text-right font-medium">${formatCurrency(row.tuition)}</td>
                    </tr>

                    {/* Step Up Status */}
                    <tr className="border-t">
                      <td className="px-4 py-3 text-muted-foreground">Step Up for Students Award Status</td>
                      <td className="px-4 py-3 text-right">
                        {row.stepUpStatus ? getStatusBadge(row.stepUpStatus) : <span className="text-muted-foreground">—</span>}
                      </td>
                    </tr>

                    {/* Step Up Type */}
                    <tr className="border-t">
                      <td className="px-4 py-3 text-muted-foreground">
                        <span className="inline-flex items-center gap-1.5">
                          Step Up for Students Award Type
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button type="button" className="inline-flex text-muted-foreground/50 hover:text-muted-foreground transition-colors">
                                <HelpCircle className="size-3.5" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-xs text-xs">
                              <p>The Step Up for Students award type is determined by the scholarship program your student was approved for through Step Up for Students. The award amount varies by program type and grade level.</p>
                            </TooltipContent>
                          </Tooltip>
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-medium">
                        {row.stepUpType && SUFS_LABELS[row.stepUpType]
                          ? SUFS_LABELS[row.stepUpType]
                          : <span className="text-muted-foreground">—</span>}
                      </td>
                    </tr>

                    {/* Step Up Amount */}
                    <tr className="border-t">
                      <td className="px-4 py-3 text-muted-foreground">Step Up for Students Award Amount</td>
                      <td className="px-4 py-3 text-right font-medium text-green-600">
                        {row.stepUpAmount > 0 ? `-$${formatCurrency(row.stepUpAmount)}` : "$0.00"}
                      </td>
                    </tr>

                    {/* Opportunity Scholarship */}
                    <tr className="border-t">
                      <td className="px-4 py-3 text-muted-foreground">
                        <span className="inline-flex items-center gap-1.5">
                          Opportunity Scholarship Award
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button type="button" className="inline-flex text-muted-foreground/50 hover:text-muted-foreground transition-colors">
                                <HelpCircle className="size-3.5" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-xs text-xs">
                              <p>The Opportunity Scholarship award is determined based on your household income, household size, and assets as reported in the Financial Aid application.</p>
                            </TooltipContent>
                          </Tooltip>
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-green-600">
                        {row.scholarshipAmount != null && row.scholarshipAmount > 0
                          ? `-$${formatCurrency(row.scholarshipAmount)}`
                          : <span className="text-muted-foreground">—</span>}
                      </td>
                    </tr>

                    {/* Remaining Tuition Amount — the per-student
                        tuition you still owe after the Opportunity
                        Scholarship has been applied. Same value baked
                        into the subtotal below, broken out as its own
                        row. Renders whenever this row has an OS
                        determination (admin entered a per-student
                        amount, OR family is flagged on OS, OR family
                        is on SNAP). */}
                    {row.hasOSDetermination ? (
                      <tr className="border-t">
                        <td className="px-4 py-3 text-muted-foreground">
                          <span className="inline-flex items-center gap-1.5">
                            Remaining Tuition Amount
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button type="button" className="inline-flex text-muted-foreground/50 hover:text-muted-foreground transition-colors">
                                  <HelpCircle className="size-3.5" />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-xs text-xs">
                                {isSnapFamily ? (
                                  <p>SNAP-qualified families have no remaining tuition — the Opportunity Scholarship covers the full per-student amount.</p>
                                ) : (
                                  <p>The per-student tuition you still owe after the Opportunity Scholarship has been applied.</p>
                                )}
                              </TooltipContent>
                            </Tooltip>
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-medium">
                          ${formatCurrency(row.familyPaysForTuition)}
                        </td>
                      </tr>
                    ) : null}

                    {/* Annual Admin Fee — sits directly above the
                        subtotal so the family reads the receipt
                        top-to-bottom: gross tuition, awards that
                        offset it, then the line items that make up
                        what they actually owe (remaining tuition +
                        admin fee = subtotal). */}
                    <tr className="border-t">
                      <td className="px-4 py-3 text-muted-foreground">
                        Annual Admin Fee
                      </td>
                      <td className="px-4 py-3 text-right font-medium">${formatCurrency(row.adminFees)}</td>
                    </tr>

                    {/* Student subtotal */}
                    <tr className="border-t bg-muted/20">
                      <td className="px-4 py-3 font-medium">Subtotal — {row.studentName}</td>
                      <td className="px-4 py-3 text-right font-semibold">${formatCurrency(row.subtotal)}</td>
                    </tr>
                  </Fragment>
                ))}

                {/* Grand total footer — title carries the school year
                    in parens so the family always knows which year's
                    receipt they're looking at without scrolling back to
                    the page header. */}
                <tr className="border-t-2 bg-white">
                  <td className="px-4 py-3 font-bold">
                    Total Annual Due
                    {(schoolYear as { year_name?: string } | null)?.year_name ? (
                      <span className="ml-1.5 font-normal text-muted-foreground">
                        — School Year ({(schoolYear as { year_name: string }).year_name})
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-right font-bold">${formatCurrency(grandTotal)}</td>
                </tr>
                <tr className="border-t bg-white">
                  <td className="px-4 py-3 font-bold">Monthly Payment (Aug – Jul, 12 months)</td>
                  <td className="px-4 py-3 text-right font-bold">${formatCurrency(grandTotal / 12)}/mo</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Acknowledgment & Signature */}
          <div className="rounded-xl border bg-white p-6">
            {alreadyReviewed && !unlocked ? (
              <div>
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="size-6 text-green-600 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      Tuition review submitted
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {regProgress?.last_edited
                        ? `Reviewed on ${new Date(regProgress.last_edited).toLocaleDateString(
                            "en-US",
                            { month: "long", day: "numeric", year: "numeric" }
                          )}`
                        : "Review completed"}
                    </p>
                  </div>
                </div>
                {!!(signatureMeta?.path) && (
                  <div className="mt-4 rounded-md border border-input bg-white p-3">
                    <p className="text-xs text-muted-foreground mb-2">Signature</p>
                    <div className="w-full" style={{ height: 100 }}>
                      <img
                        src={
                          (signatureMeta.url as string) ??
                          `${process.env.NEXT_PUBLIC_XANO_BASE ?? "https://xsc3-mvx7-r86m.n7e.xano.io"}${signatureMeta.path}`
                        }
                        alt="Signature"
                        className="w-full h-full object-contain object-left"
                      />
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <>
                <h3 className="text-sm font-semibold mb-1">Acknowledgment</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  By signing below, I acknowledge that I have reviewed the tuition and scholarship breakdown above and understand the financial obligations for the upcoming school year.
                </p>
                <div className="rounded-md border border-input bg-background">
                  <SignatureCanvas
                    ref={sigCanvasRef}
                    penColor="black"
                    onEnd={handleSignatureEnd}
                    canvasProps={{
                      className: "w-full rounded-md cursor-crosshair",
                      style: { height: 150 },
                    }}
                  />
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    {signatureUploading ? (
                      <span className="flex items-center gap-1.5">
                        <Loader2 className="size-3 animate-spin" /> Saving signature...
                      </span>
                    ) : signatureMeta ? (
                      <span className="flex items-center gap-1.5">
                        <CheckCircle2 className="size-3 text-green-600" /> Signature saved
                      </span>
                    ) : (
                      "Sign above using your mouse or touchscreen"
                    )}
                  </p>
                  <Button variant="outline" size="sm" onClick={clearSignature}>
                    Clear Signature
                  </Button>
                </div>
                {/* Printed name — stored on the progress row's `name` column
                    so the tuition acknowledgment has a typed record in
                    addition to the drawn signature. */}
                <Field className="mt-4">
                  <FieldLabel>Type your full name</FieldLabel>
                  <Input
                    placeholder="Full name of the signing parent or guardian"
                    value={printedName}
                    onChange={(e) => setPrintedName(e.target.value)}
                  />
                </Field>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

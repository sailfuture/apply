"use client";

import { useParams, usePathname, useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useEffect, useMemo, useCallback, useState } from "react";
import {
  ApplicationFlowProvider,
  useApplicationFlow,
} from "@/contexts/application-flow-context";
import { ApplicationSideNav } from "@/components/application-side-nav";
import { useApplicationSteps } from "@/hooks/use-application-steps";
import { PreSubmitReviewModal, type SectionStatus } from "@/components/pre-submit-review-modal";
import { useFamilyProgress } from "@/hooks/use-family-progress";
import { useStudentRegistrationProgress } from "@/hooks/use-student-registration-progress";

function LayoutInner({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const pathname = usePathname();
  const router = useRouter();
  const yearId = params.yearId as string;

  // The same layout serves both `/apply/year/[yearId]` (application phase)
  // and `/registration/year/[yearId]` (post-acceptance phase). The base
  // path follows whichever URL the user is on, so links + the overview
  // detection stay correct under either prefix.
  const flowPrefix = pathname.startsWith("/registration/") ? "/registration" : "/apply";
  const basePath = `${flowPrefix}/year/${yearId}`;
  const isOverview = pathname === basePath || pathname === `${basePath}/`;

  const { saveHandler, saveOptions, backGuard, onBack, hideChrome, hideBottomBar } =
    useApplicationFlow();

  const [helpOpen, setHelpOpen] = useState(false);
  const [unlockWarningOpen, setUnlockWarningOpen] = useState(false);
  // Pre-submit review modal — the same modal available from the year overview
  // is exposed here so parents can review & submit from any step page.
  const [preSubmitOpen, setPreSubmitOpen] = useState(false);
  // Section completion is tracked in `registration_family_application_progress`
  // (one row per family per year). The review modal renders one row per section
  // with a Fix button if the section isn't yet marked complete.
  const { progress, submit: submitFamilyApplication } = useFamilyProgress(Number(yearId));
  const {
    progress: regProgress,
    submit: submitRegistration,
  } = useStudentRegistrationProgress(Number(yearId));
  const [submitting, setSubmitting] = useState(false);
  const applicationSections: SectionStatus[] = useMemo(
    () => [
      { section: "family", complete: !!progress?.family_completed },
      { section: "students", complete: !!progress?.students_completed },
      { section: "financial_aid", complete: !!progress?.financial_aid_completed },
      { section: "testing", complete: !!progress?.testing_completed },
    ],
    [progress]
  );
  const registrationSubmitSections: SectionStatus[] = useMemo(
    () => [
      { section: "tuition", complete: !!regProgress?.isTuition },
      { section: "enrollment", complete: !!regProgress?.isEnrollment },
      { section: "registration", complete: !!regProgress?.isRegistration },
      { section: "volunteer", complete: !!regProgress?.isVolunteerHours },
    ],
    [regProgress]
  );

  // Get registration step counts for the Complete Section button
  const { registrationSteps, steps } = useApplicationSteps(Number(yearId));
  const REGISTRATION_SEGMENTS = new Set(["tuition", "enrollment-signing", "registration", "volunteer-hours"]);
  const currentSegment = pathname.replace(basePath, "").replace(/^\//, "").split("/")[0] || "";
  const isRegistrationPage = REGISTRATION_SEGMENTS.has(currentSegment);

  // Kick the parent back to the dashboard if their acceptance has
  // been revoked while they're on a post-acceptance page (tuition,
  // enrollment-signing, registration packet, volunteer hours). Only
  // these four pages are gated on acceptance — the apply-phase pages
  // (family / students / scholarship / nwea) are valid regardless
  // and stay accessible.
  //
  // Triggers on every change to `progress.isAccepted`, so the redirect
  // fires on page mount, on route changes within the apply tree, and
  // any time SWR revalidates the progress cache (e.g. after the parent
  // navigates between pages or hits manual refresh). For the
  // mid-session admin-revokes case, the kick-out lands the next time
  // SWR refreshes — typically the parent's next interaction.
  useEffect(() => {
    if (!isRegistrationPage) return;
    if (!progress) return; // still loading or errored — don't bounce
    if (progress.isAccepted === false) {
      router.replace("/dashboard");
    }
  }, [isRegistrationPage, progress, router]);

  // The modal sources its sections + submit action from whichever lifecycle
  // phase the user is currently in. Registration pages → the four post-
  // acceptance bools + registration submit. Everything else → the four
  // application bools + application submit.
  const submitSections = isRegistrationPage
    ? registrationSubmitSections
    : applicationSections;
  const modalPhase: "application" | "registration" = isRegistrationPage
    ? "registration"
    : "application";
  const activeSteps = isRegistrationPage ? registrationSteps : steps;
  const stepsExcludingSubmit = activeSteps.filter((s) => s.title !== "Submit Registration");
  const completedStepCount = stepsExcludingSubmit.filter((s) => s.status === "complete").length;
  const totalStepCount = stepsExcludingSubmit.length;

  // Determine the current step and next section
  const currentStep = stepsExcludingSubmit.find((s) => {
    const stepSegment = s.href.replace(basePath + "/", "").split("/")[0];
    return stepSegment === currentSegment;
  });
  const currentStepNumber = currentStep?.number ?? -1;
  const prevStep = [...stepsExcludingSubmit].reverse().find((s) => s.number < currentStepNumber && s.href !== "#");
  const nextStep = stepsExcludingSubmit.find((s) => s.number > currentStepNumber && s.href !== "#");
  const isFirstStep = !prevStep;
  const isLastStep = !nextStep;

  const handleBack = useCallback(() => {
    if (backGuard && !backGuard()) return;
    if (onBack) {
      onBack();
      return;
    }
    if (prevStep) {
      router.push(prevStep.href);
    } else {
      router.push(basePath);
    }
  }, [backGuard, onBack, prevStep, router, basePath]);

  // Local "pressing" state for the Complete Section button. The page-side
  // saveHandler does some sync validation work before flipping its
  // `saveOptions.saving` flag, so without this there's a perceptible
  // gap between click and the spinner showing — the button looks dead
  // for a few hundred ms. Flipping `pressing` synchronously on click
  // gives the user instant visual feedback that the click registered.
  const [pressing, setPressing] = useState(false);
  const handleSave = useCallback(async () => {
    if (!saveHandler) return;
    setPressing(true);
    try {
      await saveHandler();
    } catch {
      // Save failed — stay on page, error toast handled by the page
    } finally {
      setPressing(false);
    }
  }, [saveHandler]);
  const showSpinner = pressing || !!saveOptions.saving;

  // Show side nav on form pages (not overview, not hideChrome)
  const showSideNav = !isOverview && !hideChrome;
  // Show bottom bar on form pages (not overview, not hideChrome, not hideBottomBar)
  const showBottomBar = !isOverview && !hideChrome && !hideBottomBar;

  return (
    <div className="min-h-[calc(100vh-7.5rem)] flex flex-col">
      {/* Help / Contact Info Modal */}
      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Need Help?</DialogTitle>
            <DialogDescription>
              If you require assistance with your application, please contact us.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5 py-2">
            {/* Mrs. Tessa Ward */}
            <div>
              <p className="text-sm font-semibold">Mrs. Tessa Ward</p>
              <p className="text-xs text-muted-foreground">Dean of Students</p>
              <div className="mt-2 space-y-1.5">
                <div className="flex items-center gap-2.5">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
                    <svg className="size-4 text-muted-foreground" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M3 4a2 2 0 00-2 2v1.161l8.441 4.221a1.25 1.25 0 001.118 0L19 7.162V6a2 2 0 00-2-2H3z" />
                      <path d="M19 8.839l-7.831 3.916a2.75 2.75 0 01-2.338 0L1 8.839V14a2 2 0 002 2h14a2 2 0 002-2V8.839z" />
                    </svg>
                  </div>
                  <a href="mailto:dean@sailfuture.org" className="text-sm underline underline-offset-2">
                    dean@sailfuture.org
                  </a>
                </div>
                <div className="flex items-center gap-2.5">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
                    <svg className="size-4 text-muted-foreground" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M2 3.5A1.5 1.5 0 013.5 2h1.148a1.5 1.5 0 011.465 1.175l.716 3.223a1.5 1.5 0 01-1.052 1.767l-.933.267c-.41.117-.643.555-.48.95a11.542 11.542 0 006.254 6.254c.395.163.833-.07.95-.48l.267-.933a1.5 1.5 0 011.767-1.052l3.223.716A1.5 1.5 0 0118 15.352V16.5a1.5 1.5 0 01-1.5 1.5H15c-1.149 0-2.263-.15-3.326-.43A13.022 13.022 0 012.43 8.326 13.019 13.019 0 012 5V3.5z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <a href="tel:+17279001436" className="text-sm underline underline-offset-2">
                    (727) 900-1436
                  </a>
                </div>
              </div>
            </div>

            <Separator />

            {/* Ms. Laura Manke */}
            <div>
              <p className="text-sm font-semibold">Ms. Laura Manke</p>
              <p className="text-xs text-muted-foreground">Assistant Head of School</p>
              <div className="mt-2 space-y-1.5">
                <div className="flex items-center gap-2.5">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
                    <svg className="size-4 text-muted-foreground" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M3 4a2 2 0 00-2 2v1.161l8.441 4.221a1.25 1.25 0 001.118 0L19 7.162V6a2 2 0 00-2-2H3z" />
                      <path d="M19 8.839l-7.831 3.916a2.75 2.75 0 01-2.338 0L1 8.839V14a2 2 0 002 2h14a2 2 0 002-2V8.839z" />
                    </svg>
                  </div>
                  <a href="mailto:lmanke@sailfuture.org" className="text-sm underline underline-offset-2">
                    lmanke@sailfuture.org
                  </a>
                </div>
                <div className="flex items-center gap-2.5">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
                    <svg className="size-4 text-muted-foreground" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M2 3.5A1.5 1.5 0 013.5 2h1.148a1.5 1.5 0 011.465 1.175l.716 3.223a1.5 1.5 0 01-1.052 1.767l-.933.267c-.41.117-.643.555-.48.95a11.542 11.542 0 006.254 6.254c.395.163.833-.07.95-.48l.267-.933a1.5 1.5 0 011.767-1.052l3.223.716A1.5 1.5 0 0118 15.352V16.5a1.5 1.5 0 01-1.5 1.5H15c-1.149 0-2.263-.15-3.326-.43A13.022 13.022 0 012.43 8.326 13.019 13.019 0 012 5V3.5z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <a href="tel:+18135053539" className="text-sm underline underline-offset-2">
                    (813) 505-3539
                  </a>
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Side Nav (left) + Content — centered together */}
      <div className="flex-1 flex justify-center px-4 lg:px-6">
        <div className={`flex w-full gap-6 ${showSideNav ? "max-w-[980px]" : "max-w-2xl"}`}>
          {/* Side Navigation — left of content */}
          {showSideNav && (
            <ApplicationSideNav
              yearId={Number(yearId)}
              onSubmitClick={() => setPreSubmitOpen(true)}
            />
          )}

          {/* Main scrollable content. The global auto-save pill is placed
              inline in each page's header via <GlobalSaveStatusPill />.
              Extra bottom padding on mobile leaves room for the fixed nav. */}
          <main className="flex-1 min-w-0">
            {/* When the section is marked complete, dim AND fully block
                interaction with the page contents (`pointer-events-none`).
                Previously only the opacity changed — inputs underneath
                were still focusable / editable, which is why "unlock"
                appeared to do nothing on pages whose individual inputs
                weren't separately gated by a lock state. The block lifts
                automatically as soon as `saveOptions.completed` flips
                false (i.e. when onUnlock fires from the bottom-bar
                button below). */}
            <div
              className={
                saveOptions.completed
                  ? "opacity-50 pointer-events-none select-none"
                  : ""
              }
              aria-disabled={saveOptions.completed || undefined}
            >
              {children}
            </div>

            {/*
              Bottom nav behaviour:
              - xl+ (sidenav visible): renders inline below content with just the
                Complete/Save primary button. Back/Next come from the sidenav.
              - < xl (no sidenav): renders fixed at the bottom of the viewport
                with Back | Complete | Next, plus a Review & Submit link above.
            */}
            {showBottomBar && (
              <>
                {/* Desktop (xl+) — inline primary button below content */}
                <div className="hidden xl:flex mx-auto w-full max-w-4xl items-center gap-2 border-t pt-6 px-6">
                  {saveOptions.completed ? (
                    <button
                      className="flex-1 flex items-center justify-center gap-2 rounded-md bg-white border border-input px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted/30 transition-colors cursor-pointer"
                      onClick={() => saveOptions.onUnlock && setUnlockWarningOpen(true)}
                    >
                      <CheckCircle2 className="size-4 text-green-600 shrink-0" />
                      <span>
                        {saveOptions.completedLabel ?? "Section Completed"}
                        <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                          (Click to Edit)
                        </span>
                      </span>
                    </button>
                  ) : saveOptions.label ? (
                    <Button
                      variant={saveOptions.disabled ? "outline" : "default"}
                      className={`flex-1 py-2.5 ${saveOptions.disabled ? "bg-muted text-muted-foreground cursor-not-allowed hover:bg-muted" : ""}`}
                      onClick={saveHandler && !saveOptions.disabled ? handleSave : undefined}
                      disabled={saveHandler ? (saveOptions.disabled || showSpinner) : false}
                    >
                      {showSpinner ? (
                        <>
                          <Loader2 className="size-4 mr-1.5 shrink-0 animate-spin" />
                          {saveOptions.saving ? "Saving..." : "Working..."}
                        </>
                      ) : (
                        saveOptions.label
                      )}
                    </Button>
                  ) : (
                    <div className="flex-1 h-10 rounded-md bg-muted animate-pulse" />
                  )}
                </div>

                {/* Mobile (< xl) — fixed bottom bar. Two buttons only:
                    "Return to Dashboard" (goes to the year overview) and the
                    current section's Complete button. */}
                <div className="xl:hidden fixed bottom-0 left-0 right-0 z-50 border-t bg-background">
                  <div className="mx-auto w-full max-w-4xl flex items-stretch gap-2 px-3 py-3">
                    <Button
                      type="button"
                      variant="outline"
                      className="flex-1 min-w-0 py-2.5 bg-white"
                      onClick={() => router.push(basePath)}
                    >
                      <span className="truncate">Return to Dashboard</span>
                    </Button>

                    {saveOptions.completed ? (
                      <button
                        className="flex-1 min-w-0 flex items-center justify-center gap-2 rounded-md bg-white border border-input px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted/30 transition-colors cursor-pointer"
                        onClick={() => saveOptions.onUnlock && setUnlockWarningOpen(true)}
                      >
                        <CheckCircle2 className="size-4 text-green-600 shrink-0" />
                        <span className="truncate">
                          {saveOptions.completedLabel ?? "Section Completed"}
                          <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                            (Click to Edit)
                          </span>
                        </span>
                      </button>
                    ) : saveOptions.label ? (
                      <Button
                        variant={saveOptions.disabled ? "outline" : "default"}
                        className={`flex-1 min-w-0 py-2.5 ${saveOptions.disabled ? "bg-muted text-muted-foreground cursor-not-allowed hover:bg-muted" : ""}`}
                        onClick={saveHandler && !saveOptions.disabled ? handleSave : undefined}
                        disabled={saveHandler ? (saveOptions.disabled || showSpinner) : false}
                      >
                        {showSpinner ? (
                          <>
                            <Loader2 className="size-4 mr-1.5 shrink-0 animate-spin" />
                            <span className="truncate">
                              {saveOptions.saving ? "Saving..." : "Working..."}
                            </span>
                          </>
                        ) : (
                          <span className="truncate">{saveOptions.label}</span>
                        )}
                      </Button>
                    ) : (
                      <div className="flex-1 min-w-0 h-10 rounded-md bg-muted animate-pulse" />
                    )}
                  </div>
                </div>
              </>
            )}
          </main>
        </div>
      </div>

      {/* Unlock Warning Modal */}
      <AlertDialog open={unlockWarningOpen} onOpenChange={setUnlockWarningOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unlock this section?</AlertDialogTitle>
            <AlertDialogDescription>
              Unlocking this section will require you to resubmit the data for review. Any previously submitted information will need to be confirmed again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                saveOptions.onUnlock?.();
                setUnlockWarningOpen(false);
              }}
            >
              Yes, Unlock Section
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Pre-submit review modal — same modal as the year overview, reachable
          from every section page via the "Review & Submit Application" link. */}
      <PreSubmitReviewModal
        open={preSubmitOpen}
        onOpenChange={setPreSubmitOpen}
        sections={submitSections}
        basePath={basePath}
        submitting={submitting}
        phase={modalPhase}
        onConfirm={async () => {
          if (submitting) return;
          setSubmitting(true);
          try {
            // Phase drives which bool gets flipped and where the user
            // lands afterwards. Application submit → application-submitted
            // banner. Registration submit → enrolled-family dashboard.
            if (modalPhase === "registration") {
              await submitRegistration();
            } else {
              await submitFamilyApplication();
            }
            setPreSubmitOpen(false);
            router.push(basePath);
          } catch {
            // Keep the modal open so they can retry — error toast is handled
            // by trackAutosave inside the hook's submit().
          } finally {
            setSubmitting(false);
          }
        }}
      />
    </div>
  );
}

export default function ApplicationFlowLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ApplicationFlowProvider>
      <LayoutInner>{children}</LayoutInner>
    </ApplicationFlowProvider>
  );
}

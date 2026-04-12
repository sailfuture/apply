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
import { useMemo, useCallback, useState } from "react";
import {
  ApplicationFlowProvider,
  useApplicationFlow,
} from "@/contexts/application-flow-context";
import { ApplicationSideNav } from "@/components/application-side-nav";
import { useApplicationSteps } from "@/hooks/use-application-steps";

function LayoutInner({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const pathname = usePathname();
  const router = useRouter();
  const yearId = params.yearId as string;

  const basePath = `/apply/year/${yearId}`;
  const isOverview = pathname === basePath || pathname === `${basePath}/`;

  const { saveHandler, saveOptions, backGuard, onBack, hideChrome, hideBottomBar } =
    useApplicationFlow();

  const [helpOpen, setHelpOpen] = useState(false);
  const [unlockWarningOpen, setUnlockWarningOpen] = useState(false);

  // Get registration step counts for the Complete Section button
  const { registrationSteps, steps } = useApplicationSteps(Number(yearId));
  const REGISTRATION_SEGMENTS = new Set(["tuition", "enrollment-signing", "registration"]);
  const currentSegment = pathname.replace(basePath, "").replace(/^\//, "").split("/")[0] || "";
  const isRegistrationPage = REGISTRATION_SEGMENTS.has(currentSegment);
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
    router.push(basePath);
  }, [backGuard, onBack, router, basePath]);

  const handleSave = useCallback(async () => {
    if (!saveHandler) return;
    try {
      await saveHandler();
    } catch {
      // Save failed — stay on page, error toast handled by the page
    }
  }, [saveHandler]);

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
                  <a href="mailto:tward@sailfuture.org" className="text-sm underline underline-offset-2">
                    tward@sailfuture.org
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
      <div
        className={`flex-1 flex justify-center px-4 lg:px-6 ${
          showBottomBar ? "pb-[72px]" : ""
        }`}
      >
        <div className={`flex w-full gap-6 ${showSideNav ? "max-w-[980px]" : "max-w-2xl"}`}>
          {/* Side Navigation — left of content */}
          {showSideNav && <ApplicationSideNav yearId={Number(yearId)} />}

          {/* Main scrollable content */}
          <main className={`flex-1 min-w-0 ${saveOptions.completed ? "opacity-50" : ""}`}>
            {children}
          </main>
        </div>
      </div>

      {/* Fixed Bottom Nav — flush above footer */}
      {showBottomBar && (
        <div className="fixed bottom-[37px] left-0 right-0 z-50 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="mx-auto w-full max-w-4xl flex items-center gap-2 px-4 py-3">
            {/* Back */}
            <button
              onClick={isFirstStep ? undefined : (prevStep ? () => router.push(prevStep.href) : handleBack)}
              disabled={isFirstStep}
              className={`flex items-center justify-center gap-1.5 rounded-md border border-input px-3 py-2.5 text-sm font-medium transition-colors ${
                isFirstStep
                  ? "bg-muted text-muted-foreground/40 cursor-not-allowed"
                  : "bg-white text-muted-foreground hover:text-foreground hover:bg-gray-50"
              }`}
            >
              <svg className="size-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z" clipRule="evenodd" />
              </svg>
              Back
            </button>

            {/* Primary action — takes up most space */}
            {saveOptions.completed ? (
              <button
                className="flex-1 flex items-center justify-center gap-2 rounded-md bg-muted px-4 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted/80 transition-colors cursor-pointer"
                onClick={() => saveOptions.onUnlock && setUnlockWarningOpen(true)}
              >
                <svg className="size-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z" clipRule="evenodd" />
                </svg>
                {saveOptions.completedLabel ?? "Section Completed"}
              </button>
            ) : saveOptions.label ? (
              <Button
                variant={saveOptions.disabled ? "outline" : "default"}
                className={`flex-1 py-2.5 ${saveOptions.disabled ? "bg-muted text-muted-foreground cursor-not-allowed hover:bg-muted" : ""}`}
                onClick={saveHandler && !saveOptions.disabled ? handleSave : undefined}
                disabled={saveHandler ? (saveOptions.disabled || saveOptions.saving) : false}
              >
                <svg className="size-4 mr-1.5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M14.5 1A4.5 4.5 0 0010 5.5V9H3a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5a3 3 0 116 0v2.75a.75.75 0 01-1.5 0V5.5A4.5 4.5 0 0014.5 1z" clipRule="evenodd" />
                </svg>
                {saveOptions.saving ? "Saving..." : saveOptions.label}
              </Button>
            ) : (
              <div className="flex-1 h-10 rounded-md bg-muted animate-pulse" />
            )}

            {/* Next */}
            <button
              onClick={isLastStep ? undefined : (nextStep ? () => router.push(nextStep.href) : undefined)}
              disabled={isLastStep}
              className={`flex items-center justify-center gap-1.5 rounded-md px-3 py-2.5 text-sm font-medium transition-colors ${
                isLastStep
                  ? "border border-input bg-muted text-muted-foreground/40 cursor-not-allowed"
                  : saveOptions.completed
                    ? "bg-primary text-primary-foreground hover:bg-primary/90"
                    : "border border-input bg-white text-muted-foreground hover:text-foreground hover:bg-gray-50"
              }`}
            >
              Next
              <svg className="size-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        </div>
      )}

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

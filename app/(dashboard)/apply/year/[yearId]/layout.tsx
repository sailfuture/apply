"use client";

import { useParams, usePathname, useRouter } from "next/navigation";
import Image from "next/image";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useMemo, useCallback, useState } from "react";
import {
  ApplicationFlowProvider,
  useApplicationFlow,
} from "@/contexts/application-flow-context";

const FORM_STEPS = [
  { label: "Family", segment: "family", stepIndex: 0 },
  { label: "Students", segment: "students", stepIndex: 1 },
  { label: "Financial Aid", segment: "scholarship", stepIndex: 2 },
  { label: "Waiver", segment: "waiver", stepIndex: 3 },
  { label: "Agreement", segment: "agreement", stepIndex: 4 },
] as const;

function LayoutInner({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const pathname = usePathname();
  const router = useRouter();
  const yearId = params.yearId as string;

  const basePath = `/apply/year/${yearId}`;
  const isOverview = pathname === basePath || pathname === `${basePath}/`;

  const { saveHandler, saveOptions, backGuard, onBack, hideChrome } =
    useApplicationFlow();

  const [helpOpen, setHelpOpen] = useState(false);

  const handleBack = useCallback(() => {
    if (backGuard && !backGuard()) return;
    if (onBack) {
      onBack();
      return;
    }
    router.push(basePath);
  }, [backGuard, onBack, router, basePath]);

  // Determine which step segment is currently active
  const activeSegment = useMemo(() => {
    const after = pathname.replace(basePath, "").replace(/^\//, "").split("/")[0];
    return after || null;
  }, [pathname, basePath]);

  return (
    <div className="flex min-h-screen flex-col">
      {/* Fixed Header — hidden on overview and when hideChrome is set */}
      {!isOverview && !hideChrome && (
        <header className="fixed top-0 left-0 right-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="mx-auto w-full max-w-4xl flex h-14 items-center px-4">
            {/* Left: SFA logo — links back to checklist */}
            <div className="w-10 shrink-0">
              <button
                onClick={handleBack}
                className="focus:outline-none"
                aria-label="Back to checklist"
              >
                <Image
                  src="/logo.svg"
                  alt="SailFuture Academy"
                  width={28}
                  height={28}
                  className="size-7 rounded-full"
                />
              </button>
            </div>

            {/* Center: step navigation */}
            <nav className="flex-1 flex items-center justify-center gap-1 overflow-x-auto scrollbar-hide">
              {FORM_STEPS.map((step) => {
                const isActive = activeSegment === step.segment;
                return (
                  <button
                    key={step.label}
                    onClick={() => {
                      if (backGuard && !backGuard()) return;
                      router.push(`${basePath}/${step.segment}`);
                    }}
                    className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors ${
                      isActive
                        ? "font-semibold text-foreground"
                        : "text-muted-foreground/60 hover:text-foreground hover:bg-muted/50"
                    }`}
                  >
                    {step.label}
                  </button>
                );
              })}
            </nav>

            {/* Right: help / question mark button */}
            <div className="w-10 shrink-0 flex justify-end">
              <button
                onClick={() => setHelpOpen(true)}
                className="flex size-8 items-center justify-center rounded-full border border-input text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
              >
                <svg className="size-4" viewBox="0 0 20 20" fill="currentColor">
                  <path
                    fillRule="evenodd"
                    d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM8.94 6.94a.75.75 0 11-1.061-1.061 3 3 0 112.871 5.026v.345a.75.75 0 01-1.5 0v-.5c0-.72.57-1.172 1.081-1.287A1.5 1.5 0 108.94 6.94zM10 15a1 1 0 100-2 1 1 0 000 2z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            </div>
          </div>
        </header>
      )}

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

      {/* Scrollable Content */}
      <main className={`flex-1 overflow-y-auto ${isOverview || hideChrome ? "" : "pt-14 pb-20"}`}>
        {children}
      </main>

      {/* Fixed Bottom Nav — form pages only, hidden when hideChrome is set */}
      {!isOverview && !hideChrome && (
        <div className="fixed bottom-0 left-0 right-0 z-40 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="mx-auto w-full max-w-4xl flex items-center gap-3 px-4 py-3">
            <button
              onClick={handleBack}
              className="flex-1 flex items-center justify-center gap-2 rounded-md border border-input px-4 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            >
              <svg
                className="size-4"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z"
                  clipRule="evenodd"
                />
              </svg>
              Back
            </button>
            {saveHandler ? (
              <Button
                className="flex-1 py-2.5"
                onClick={saveHandler}
                disabled={saveOptions.disabled || saveOptions.saving}
              >
                {saveOptions.saving ? "Saving..." : "Save Section"}
              </Button>
            ) : (
              <div className="flex-1" />
            )}
          </div>
        </div>
      )}
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

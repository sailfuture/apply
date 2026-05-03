"use client";

import { useParams, usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import {
  ApplicationFlowProvider,
  useApplicationFlow,
} from "@/contexts/application-flow-context";
import { ReapplySideNav } from "@/components/reapply-side-nav";
import { Button } from "@/components/ui/button";
import { CheckCircle2, ChevronLeft, Loader2 } from "lucide-react";
import { ReapplyPreSubmitModal } from "@/components/reapply-pre-submit-modal";

/**
 * Layout for the /reapply/year/[yearId] flow.
 *
 * Mirrors the apply-flow layout intentionally — same sidenav-on-left +
 * content + bottom-bar pattern, same ApplicationFlowProvider so
 * page-level `registerSaveHandler` / `updateSaveOptions` calls drive the
 * Complete Section button identically. Sub-pages (Family, Students,
 * Scholarship) are re-exports of the apply-flow pages and "just work"
 * inside this layout — they detect `/reapply` via pathname and write to
 * the reapply progress row instead of the apply progress row.
 */
function ReapplyLayoutInner({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const pathname = usePathname();
  const router = useRouter();
  const yearId = params.yearId as string;
  const basePath = `/reapply/year/${yearId}`;
  const isOverview = pathname === basePath || pathname === `${basePath}/`;

  const { saveHandler, saveOptions, hideChrome, hideBottomBar } =
    useApplicationFlow();

  const [preSubmitOpen, setPreSubmitOpen] = useState(false);

  // Submit-button click goes through layout-level handler so save handlers
  // registered by individual pages can throw to cancel completion. Local
  // `pressing` state gives the user instant visual feedback that the
  // click registered — without it there's a perceptible gap between
  // click and `saveOptions.saving` going true.
  const [pressing, setPressing] = useState(false);
  const handleSave = async () => {
    if (!saveHandler) return;
    setPressing(true);
    try {
      await saveHandler();
    } catch {
      /* page surfaces the error via toast */
    } finally {
      setPressing(false);
    }
  };
  const showSpinner = pressing || !!saveOptions.saving;

  const showSideNav = !isOverview && !hideChrome;
  const showBottomBar = !isOverview && !hideChrome && !hideBottomBar;

  return (
    <div className="min-h-[calc(100vh-7.5rem)] flex flex-col">
      {/* Persistent "Back to Dashboard" strip — sticky under the global
          header. Lets the parent leave the reapply flow at any point and
          return to it later without losing autosaved progress. */}
      <div className="sticky top-14 z-30 border-b bg-white">
        <div className="mx-auto flex h-12 items-center justify-center px-4 lg:px-6">
          <Button asChild variant="outline" size="sm" className="bg-white">
            <Link href="/dashboard">
              <ChevronLeft className="size-4 mr-1.5" />
              Back to Dashboard
            </Link>
          </Button>
        </div>
      </div>

      {/* Side Nav (xl+) + Content — centered together. Mirrors the apply
          layout's same-width container so the visual rhythm matches. */}
      <div className="flex-1 flex justify-center px-4 lg:px-6">
        <div
          className={`flex w-full gap-6 ${
            showSideNav ? "max-w-[980px]" : "max-w-2xl"
          }`}
        >
          {showSideNav && (
            <ReapplySideNav
              yearId={Number(yearId)}
              onSubmitClick={() => setPreSubmitOpen(true)}
            />
          )}

          <main className="flex-1 min-w-0">
            {/* When marked complete, dim + fully block interaction with
                the page so inputs aren't editable until unlock fires.
                See apply layout for the full reasoning. */}
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

            {/* Bottom nav — same dual-mode pattern as the apply layout.
                xl+ shows the inline Complete Section button below content;
                mobile shows a fixed bottom bar with Return to Dashboard +
                Complete Section side-by-side. */}
            {showBottomBar && (
              <>
                <div className="hidden xl:flex mx-auto w-full max-w-4xl items-center gap-2 border-t pt-6 px-6">
                  {saveOptions.completed ? (
                    <button
                      type="button"
                      className="flex-1 flex items-center justify-center gap-2 rounded-md bg-white border border-input px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted/30 transition-colors cursor-pointer"
                      onClick={() => saveOptions.onUnlock?.()}
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
                      className={`flex-1 py-2.5 ${
                        saveOptions.disabled
                          ? "bg-muted text-muted-foreground cursor-not-allowed hover:bg-muted"
                          : ""
                      }`}
                      onClick={
                        saveHandler && !saveOptions.disabled
                          ? handleSave
                          : undefined
                      }
                      disabled={
                        saveHandler
                          ? saveOptions.disabled || showSpinner
                          : false
                      }
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

                <div className="xl:hidden fixed bottom-0 left-0 right-0 z-50 border-t bg-background">
                  <div className="mx-auto w-full max-w-4xl flex items-stretch gap-2 px-3 py-3">
                    <Button
                      type="button"
                      variant="outline"
                      className="flex-1 min-w-0 py-2.5 bg-white"
                      onClick={() => router.push("/dashboard")}
                    >
                      <span className="truncate">Return to Dashboard</span>
                    </Button>

                    {saveOptions.completed ? (
                      <button
                        type="button"
                        className="flex-1 min-w-0 flex items-center justify-center gap-2 rounded-md bg-white border border-input px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted/30 transition-colors cursor-pointer"
                        onClick={() => saveOptions.onUnlock?.()}
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
                        className={`flex-1 min-w-0 py-2.5 ${
                          saveOptions.disabled
                            ? "bg-muted text-muted-foreground cursor-not-allowed hover:bg-muted"
                            : ""
                        }`}
                        onClick={
                          saveHandler && !saveOptions.disabled
                            ? handleSave
                            : undefined
                        }
                        disabled={
                          saveHandler
                            ? saveOptions.disabled || showSpinner
                            : false
                        }
                      >
                        {showSpinner && (
                          <Loader2 className="size-4 mr-1.5 shrink-0 animate-spin" />
                        )}
                        <span className="truncate">
                          {showSpinner
                            ? saveOptions.saving
                              ? "Saving..."
                              : "Working..."
                            : saveOptions.label}
                        </span>
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

      <ReapplyPreSubmitModal
        open={preSubmitOpen}
        onOpenChange={setPreSubmitOpen}
        yearId={Number(yearId)}
      />
    </div>
  );
}

export default function ReapplyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ApplicationFlowProvider>
      <ReapplyLayoutInner>{children}</ReapplyLayoutInner>
    </ApplicationFlowProvider>
  );
}

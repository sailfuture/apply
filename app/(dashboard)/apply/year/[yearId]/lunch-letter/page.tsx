"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useParams } from "next/navigation";
import { useSWRConfig } from "swr";
import { useApplicationFlow } from "@/contexts/application-flow-context";
import { useApplications, useFamily } from "@/hooks/use-api";
import { useStudentRegistrationProgress } from "@/hooks/use-student-registration-progress";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ServiceUnavailable } from "@/components/service-unavailable";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

const EMBED_ID = "pandadoc-lunch-letter-embed";

/**
 * Free and reduced lunch letter: a household form the family completes
 * and signs once per school year, in PandaDoc, embedded inline (same
 * presentation as the enrollment agreement).
 *
 * One deliberate difference from the enrollment-agreement page: this page
 * never writes completion itself. `isLunchLetter` and the `lunch_letter_*`
 * fields are not in the progress PATCH allowlist, so the only way the
 * section turns green is the server asking PandaDoc (`/api/pandadoc/status`
 * or the webhook) and finding the envelope stored on the family's row
 * completed. The page just asks for that check and re-reads the row.
 */
export default function LunchLetterPage() {
  const params = useParams();
  const yearId = Number(params.yearId);

  const { setPageTitle, updateSaveOptions, setHideBottomBar } =
    useApplicationFlow();
  const {
    progress: regProgress,
    error: regProgressError,
    refresh: refreshRegProgress,
  } = useStudentRegistrationProgress(yearId);
  const { data: familyData, error: familyError } = useFamily();
  const { data: appsData, error: appsError } = useApplications();
  const { mutate: swrMutate } = useSWRConfig();

  const [pdfLoaded, setPdfLoaded] = useState(false);
  const [signingLoading, setSigningLoading] = useState(false);
  // Signed in the embed, waiting for the server to confirm with PandaDoc.
  const [finalizing, setFinalizing] = useState(false);
  const [signingSession, setSigningSession] = useState<{
    sessionId: string;
    documentId: string;
  } | null>(null);
  const signingInstanceRef = useRef<{ destroy: () => void } | null>(null);
  // Preparing the document failed (or it went missing). Stops the
  // auto-open effect from retrying in a loop; "Try again" clears it.
  const [prepFailed, setPrepFailed] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const creatingRef = useRef(false);
  const verifyOnMountRef = useRef(false);

  useEffect(() => {
    setPageTitle("Lunch Letter");
  }, [setPageTitle]);

  const applications = useMemo(() => {
    if (!appsData) return [];
    return (
      appsData as { registration_school_years_id: number; id: number }[]
    ).filter((a) => a.registration_school_years_id === yearId);
  }, [appsData, yearId]);
  // The document is family-level; an application only anchors the
  // ownership check on the PandaDoc routes.
  const app = applications[0];

  const loading = !appsData || !familyData || regProgress === null;
  const isCompleted = regProgress?.isLunchLetter === true;
  const docId = regProgress?.lunch_letter_pandadoc_id || null;

  useEffect(() => {
    // Signed: the Download button in the page body replaces the bar.
    if (isCompleted) {
      setHideBottomBar(true);
      return () => setHideBottomBar(false);
    }
    setHideBottomBar(false);
    updateSaveOptions({
      label: "Please Sign the Lunch Letter",
      completed: false,
      disabled: true,
    });
  }, [isCompleted, updateSaveOptions, setHideBottomBar]);

  const statusUrl = useCallback(
    (documentId: string) =>
      app
        ? `/api/pandadoc/status?documentId=${documentId}&applicationId=${app.id}&type=lunch_letter&yearId=${app.registration_school_years_id}`
        : null,
    [app]
  );

  /** Poll the server-side status check until PandaDoc reports the
   *  envelope completed, then re-read the row (the server has latched it
   *  by the time the response lands). `fast` is used right after the
   *  embed says "completed": PandaDoc's API can trail its own widget by a
   *  second or two. */
  const startPolling = useCallback(
    (documentId: string, fast = false) => {
      if (pollingRef.current) clearTimeout(pollingRef.current);
      const url = statusUrl(documentId);
      if (!url) return;
      let delay = fast ? 1000 : 3000;
      const maxDelay = fast ? 5000 : 30000;

      async function poll() {
        try {
          const res = await fetch(url as string);
          if (res.ok) {
            const data = await res.json();
            if (data.status === "missing") {
              pollingRef.current = null;
              setSigningSession(null);
              setFinalizing(false);
              setPrepFailed(true);
              toast.error(
                "This document is no longer available. Select Try again to start a new one."
              );
              return;
            }
            if (data.status === "completed") {
              pollingRef.current = null;
              // Await the re-read so the "finalizing" state holds until
              // the signed view is actually on screen.
              await refreshRegProgress();
              setSigningSession(null);
              setFinalizing(false);
              toast.success("Lunch letter signed. Thank you!");
              return;
            }
          }
        } catch {
          // Transient: fall through to the next tick.
        }
        delay = Math.min(delay * 1.3, maxDelay);
        pollingRef.current = setTimeout(poll, delay);
      }

      pollingRef.current = setTimeout(poll, fast ? 0 : delay);
    },
    [statusUrl, refreshRegProgress]
  );

  const handleSign = useCallback(async () => {
    if (!app || creatingRef.current) return;
    creatingRef.current = true;
    setSigningLoading(true);
    try {
      const res = await fetch("/api/pandadoc/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "lunch_letter",
          applicationId: app.id,
          yearId: app.registration_school_years_id,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        toast.error(body?.error ?? "Failed to prepare the lunch letter.");
        setPrepFailed(true);
        return;
      }
      const data = await res.json();
      // Already signed on PandaDoc; the create route synced the row.
      if (data.completed) {
        const row = await refreshRegProgress();
        // The row should now read signed. If it doesn't, stop here
        // rather than let the auto-open effect ask again forever.
        if (row?.isLunchLetter !== true) setPrepFailed(true);
        return;
      }
      setSigningSession({
        sessionId: data.sessionId,
        documentId: data.documentId,
      });
      startPolling(data.documentId);
    } catch {
      toast.error("Failed to open the lunch letter. Please try again.");
      setPrepFailed(true);
    } finally {
      creatingRef.current = false;
      setSigningLoading(false);
    }
  }, [app, refreshRegProgress, startPolling]);

  // Open the document whenever the page is unsigned with nothing open:
  // on first load, and again if a signed row is downgraded (below) while
  // the page is up.
  useEffect(() => {
    if (loading || !app || isCompleted) return;
    if (signingSession || signingLoading || prepFailed) return;
    // Deferred a tick: `handleSign` sets state, and the cleanup makes a
    // re-run (StrictMode, or a dependency settling) cancel the pending
    // call instead of starting a second one.
    const t = setTimeout(() => void handleSign(), 0);
    return () => clearTimeout(t);
  }, [
    loading,
    app,
    isCompleted,
    signingSession,
    signingLoading,
    prepFailed,
    handleSign,
  ]);

  // The row says signed: confirm once with PandaDoc before trusting it.
  // An envelope reopened or voided in the PandaDoc dashboard sends no
  // signal here; the status route clears the latch on a downgrade and the
  // re-read drops the page back into signing.
  useEffect(() => {
    if (verifyOnMountRef.current) return;
    if (loading || !isCompleted || !docId) return;
    const url = statusUrl(docId);
    if (!url) return;
    verifyOnMountRef.current = true;
    fetch(url)
      .then(() => refreshRegProgress())
      .catch(() => {});
  }, [loading, isCompleted, docId, statusUrl, refreshRegProgress]);

  const pdfUrl = useMemo(() => {
    if (!isCompleted || !docId || !app) return null;
    return `/api/pandadoc/download?documentId=${docId}&applicationId=${app.id}&yearId=${app.registration_school_years_id}`;
  }, [isCompleted, docId, app]);

  // The widget effect below must depend on the session alone: re-running
  // it tears the widget down and reopens the document, discarding what
  // the parent has typed. So it reaches the poller through a ref.
  const startPollingRef = useRef(startPolling);
  useEffect(() => {
    startPollingRef.current = startPolling;
  }, [startPolling]);

  // Mount the PandaDoc widget into the embed target once a session exists.
  useEffect(() => {
    if (!signingSession) return;
    let cancelled = false;

    const init = async () => {
      let target: HTMLElement | null = null;
      for (let i = 0; i < 20; i++) {
        target = document.getElementById(EMBED_ID);
        if (target) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      if (!target || cancelled) return;
      target.innerHTML = "";

      const { Signing } = await import("pandadoc-signing");
      if (cancelled) return;

      if (signingInstanceRef.current) {
        signingInstanceRef.current.destroy();
        signingInstanceRef.current = null;
      }

      const signing = new Signing(EMBED_ID, { debugMode: false });
      signing
        .on("document.completed", () => {
          setFinalizing(true);
          startPollingRef.current(signingSession.documentId, true);
        })
        .on("document.exception", (payload: unknown) => {
          console.error("PandaDoc signing exception:", payload);
        });

      signingInstanceRef.current = signing;
      await signing.open({ sessionId: signingSession.sessionId });
    };

    void init();

    return () => {
      cancelled = true;
      if (signingInstanceRef.current) {
        signingInstanceRef.current.destroy();
        signingInstanceRef.current = null;
      }
    };
  }, [signingSession]);

  useEffect(() => {
    return () => {
      if (pollingRef.current) clearTimeout(pollingRef.current);
    };
  }, []);

  // Wider than the rest of the flow: the PandaDoc widget collapses to its
  // cramped mobile layout inside `max-w-4xl`.
  const pageShell =
    "flex flex-1 flex-col gap-6 p-6 pb-0 mx-auto w-full max-w-6xl";

  // Only an error with no data behind it blocks the page.
  const blockingError =
    loading &&
    ((!appsData && appsError) ||
      (!familyData && familyError) ||
      (regProgress === null && regProgressError));
  if (blockingError) {
    return (
      <ServiceUnavailable
        onRetry={() =>
          swrMutate(
            (key) => typeof key === "string" && key.startsWith("/api/")
          )
        }
      />
    );
  }

  if (loading) {
    return (
      <div className={pageShell}>
        <div className="text-center xl:text-left">
          <Skeleton className="h-7 w-72 mb-2" />
          <Skeleton className="h-4 w-80" />
        </div>
        <Skeleton className="h-[70vh] w-full rounded-lg" />
      </div>
    );
  }

  return (
    <div className={pageShell}>
      <div>
        <h1 className="text-2xl font-semibold text-center xl:text-left">
          Free &amp; Reduced Lunch Letter
        </h1>
        <p className="text-muted-foreground text-sm mt-1 text-center xl:text-left">
          {isCompleted
            ? "This document has been signed and completed."
            : signingSession
              ? "Every family completes this form each school year, whether or not you expect to qualify. Fill it out and sign below."
              : "Your lunch letter is being prepared. It will load in this page as soon as it's ready."}
        </p>
      </div>

      {isCompleted && pdfUrl && (
        <div
          className="relative rounded-lg border overflow-hidden"
          style={{ height: "70vh" }}
        >
          {!pdfLoaded && (
            <div className="absolute inset-0 flex items-center justify-center bg-muted/30">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="size-5 animate-spin" />
                <span className="text-sm">Loading signed document...</span>
              </div>
            </div>
          )}
          <iframe
            src={pdfUrl}
            onLoad={() => setPdfLoaded(true)}
            className={`w-full h-full border-none transition-opacity duration-300 ${
              pdfLoaded ? "opacity-100" : "opacity-0"
            }`}
            title="Signed Free and Reduced Lunch Letter"
          />
        </div>
      )}

      {!isCompleted && signingSession && (
        <div
          className="relative rounded-lg border overflow-hidden bg-white w-full"
          style={{ height: "80vh", minHeight: 720 }}
        >
          <style>{`
            #${EMBED_ID} {
              position: absolute;
              inset: 0;
              width: 100%;
              height: 100%;
            }
            #${EMBED_ID} > * {
              width: 100% !important;
              height: 100% !important;
            }
            #${EMBED_ID} iframe {
              width: 100% !important;
              height: 100% !important;
              border: none !important;
              display: block !important;
            }
          `}</style>
          <div id={EMBED_ID} className="absolute inset-0" />
          {/* Signed in the widget, server confirmation in flight: cover
              the widget so the parent isn't left looking at a finished
              document with no sign that anything is happening. */}
          {finalizing && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="size-5 animate-spin" />
                <span className="text-sm">Saving your signed lunch letter...</span>
              </div>
            </div>
          )}
        </div>
      )}

      {!isCompleted && !signingSession && (
        <div
          className="relative rounded-lg border overflow-hidden"
          style={{ height: "70vh" }}
        >
          <Skeleton className="absolute inset-0 rounded-none" />
          <div className="absolute inset-0 flex items-center justify-center">
            {prepFailed ? (
              // Preparing failed (toast already shown): offer a retry
              // instead of a skeleton that never resolves.
              <Button
                variant="outline"
                className="bg-white"
                onClick={() => setPrepFailed(false)}
              >
                Try again
              </Button>
            ) : !app ? (
              <span className="text-sm text-muted-foreground">
                Add a student to your application before signing the lunch
                letter.
              </span>
            ) : (
              <div className="flex items-center gap-2">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  Preparing your lunch letter...
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {isCompleted && pdfUrl && (
        <div className="border-t pt-6 pb-6">
          <Button asChild variant="outline" className="w-full bg-white">
            <a href={pdfUrl} download="free-and-reduced-lunch-letter.pdf">
              Download Document
            </a>
          </Button>
        </div>
      )}
    </div>
  );
}

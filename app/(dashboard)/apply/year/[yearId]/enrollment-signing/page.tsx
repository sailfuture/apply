"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useParams } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { useSWRConfig } from "swr";
import { useApplicationFlow } from "@/contexts/application-flow-context";
import { useApplications, useFamily } from "@/hooks/use-api";
import { useStudentRegistrationProgress } from "@/hooks/use-student-registration-progress";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ServiceUnavailable } from "@/components/service-unavailable";
import { SignedPdfFrame } from "@/components/signed-pdf-frame";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

/**
 * Enrollment agreement signing page.
 *
 * The PandaDoc signing widget is embedded *inline* below the page header —
 * no modal, no nested dialog. This gives the widget the full page-width
 * canvas the signing UI expects (and avoids modal + iframe scroll-lock
 * interactions that were causing layout shift).
 *
 * Any parent on the family who is signed into Clerk can sign — the
 * `recipientEmail` on the PandaDoc session matches the current Clerk user's
 * primary email, so PandaDoc accepts the session and lets them sign.
 */
export default function EnrollmentSigningPage() {
  const params = useParams();
  const yearId = Number(params.yearId);
  useUser();

  const { setPageTitle, updateSaveOptions, setHideBottomBar } = useApplicationFlow();
  // Registration progress bridge row is the single source of truth for the
  // enrollment agreement — PandaDoc IDs, status, signed bool, and the
  // section-complete latch all live here.
  const {
    progress: regProgress,
    error: regProgressError,
    patchProgress: patchRegProgress,
    refresh: refreshRegProgress,
  } = useStudentRegistrationProgress(yearId);
  const { data: familyData, error: familyError } = useFamily();
  const { data: appsData, error: appsError } = useApplications();
  const { mutate: swrMutate } = useSWRConfig();

  const [signingLoading, setSigningLoading] = useState(false);
  const [signingSession, setSigningSession] = useState<{ sessionId: string; documentId: string } | null>(null);
  // Preparing the document failed. The auto-open effect only fires once
  // per mount (`autoInitRef`), so without this the page sat on "Loading
  // enrollment agreement..." forever after a single failed create.
  // "Try again" clears it and asks again.
  const [prepFailed, setPrepFailed] = useState(false);
  const signingInstanceRef = useRef<{ destroy: () => void } | null>(null);
  const pollingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoInitRef = useRef(false);
  const verifyOnMountRef = useRef(false);
  // The document whose signing has been announced. Two paths see a
  // completed signing, in either order: the widget's own "completed"
  // event and the status poll, which keeps running after the widget has
  // reported. Each used to show the success toast, so the parent got it
  // twice. Whichever gets there second now finds the document here.
  const announcedDocRef = useRef<string | null>(null);

  function announceSigned(documentId: string) {
    if (announcedDocRef.current === documentId) return;
    announcedDocRef.current = documentId;
    toast.success("Enrollment agreement signed successfully.");
  }

  useEffect(() => {
    setPageTitle("Enrollment");
  }, [setPageTitle]);

  const applications = useMemo(() => {
    if (!appsData) return [];
    return (appsData as { registration_school_years_id: number; id: number }[]).filter(
      (a) => a.registration_school_years_id === yearId
    );
  }, [appsData, yearId]);

  const loading = !appsData || !familyData || regProgress === null;

  // Bool is the single source of truth — no legacy payment-record fallbacks.
  const isCompleted = regProgress?.isEnrollment === true;
  const isSent = !!regProgress?.enrollment_agreement_pandadoc_id;

  useEffect(() => {
    // Once signed: hide the bottom bar entirely. The inline View / Re-Sign
    // Document buttons rendered in the page body replace the old
    // "Enrollment Agreement Signed" completion button.
    // Unsigned: show the bottom bar with a disabled "Please Sign" hint.
    if (isCompleted) {
      setHideBottomBar(true);
      return () => setHideBottomBar(false);
    }
    setHideBottomBar(false);
    updateSaveOptions({
      label: "Please Sign Enrollment Agreement",
      completed: false,
      disabled: true,
    });
  }, [isCompleted, updateSaveOptions, setHideBottomBar]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-initiate signing when page loads
  useEffect(() => {
    if (loading || autoInitRef.current) return;
    if (applications.length === 0) return;
    if (!isCompleted && !signingLoading && !signingSession) {
      autoInitRef.current = true;
      handleSign();
    }
  }, [loading, applications.length, isCompleted, isSent, signingLoading, signingSession]); // eslint-disable-line react-hooks/exhaustive-deps

  // Verify-on-mount: if the row claims the EA is signed, do a one-shot
  // PandaDoc status check before trusting the latch. PandaDoc-side
  // reverts (admin voided / reopened the envelope in the PandaDoc
  // dashboard) flip the doc back to a non-completed state, but our
  // app doesn't get a push notification for that — without this
  // check, `isEnrollment === true` outlives the actual envelope state
  // and the parent sees the (now-unsigned) PDF rendered as if it were
  // the signed copy. The status route clears the latches on downgrade,
  // and `refreshRegProgress` then pulls the corrected row so the page
  // re-renders into the signing flow. Fires once per mount.
  useEffect(() => {
    if (verifyOnMountRef.current) return;
    if (loading || !isCompleted) return;
    const docId = regProgress?.enrollment_agreement_pandadoc_id;
    const app = applications[0];
    if (!docId || !app) return;
    verifyOnMountRef.current = true;
    fetch(
      `/api/pandadoc/status?documentId=${docId}&applicationId=${app.id}&type=enrollment_agreement&yearId=${app.registration_school_years_id}`
    )
      .then(() => refreshRegProgress())
      .catch(() => {});
  }, [loading, isCompleted, regProgress, applications, refreshRegProgress]);

  const pdfUrl = useMemo(() => {
    const docId = regProgress?.enrollment_agreement_pandadoc_id;
    if (!isCompleted || !docId) return null;
    const app = applications[0];
    if (!app) return null;
    return `/api/pandadoc/download?documentId=${docId}&applicationId=${app.id}&yearId=${app.registration_school_years_id}`;
  }, [isCompleted, regProgress, applications]);

  async function handleSign() {
    if (applications.length === 0) {
      toast.error("Please enroll a student first.");
      return;
    }
    const app = applications[0];

    setPrepFailed(false);
    setSigningLoading(true);
    try {
      const res = await fetch("/api/pandadoc/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "enrollment_agreement",
          applicationId: app.id,
          yearId: app.registration_school_years_id,
        }),
      });

      if (!res.ok) {
        if (res.status === 409) {
          return;
        }
        // The route's error is the provider's raw message (status code
        // and JSON included) — fine for the log, not for a parent.
        const body = await res.json().catch(() => null);
        console.error("Enrollment agreement could not be prepared:", body?.error ?? res.status);
        toast.error(
          "We couldn't prepare your enrollment agreement. Please try again."
        );
        setPrepFailed(true);
        return;
      }

      const data = await res.json();
      // Already signed on PandaDoc but our row hadn't caught up (parent
      // closed the tab before a poll synced it). The create route synced
      // it server-side — DON'T open a signing session (that would re-sign
      // a completed doc); mirror the completion and render the PDF.
      if (data.completed) {
        await patchRegProgress({
          enrollment_agreement_status: "completed",
          is_enrollment_agreement_signed: true,
          isEnrollment: true,
        });
        return;
      }

      const { documentId, sessionId } = data;

      // Mirror the server's write optimistically so the SWR cache reflects
      // that a document is now "sent" without a round-trip.
      await patchRegProgress({
        enrollment_agreement_pandadoc_id: documentId,
        enrollment_agreement_status: "sent",
        enrollment_agreement_sent: new Date().toISOString(),
      });

      setSigningSession({ sessionId, documentId });
      startPolling(documentId);
    } catch {
      toast.error(
        "We couldn't prepare your enrollment agreement. Please try again."
      );
      setPrepFailed(true);
    } finally {
      setSigningLoading(false);
    }
  }

  function startPolling(documentId: string) {
    if (pollingRef.current) clearTimeout(pollingRef.current);
    let delay = 3000;
    const maxDelay = 30000;
    const appId = applications[0]?.id ?? 0;
    const yearId = applications[0]?.registration_school_years_id ?? 0;

    async function poll() {
      try {
        const res = await fetch(
          `/api/pandadoc/status?documentId=${documentId}&applicationId=${appId}&type=enrollment_agreement&yearId=${yearId}`
        );
        if (!res.ok) {
          delay = Math.min(delay * 1.5, maxDelay);
          pollingRef.current = setTimeout(poll, delay);
          return;
        }
        const data = await res.json();
        // PandaDoc envelope was deleted (admin trashed it). Stop the
        // polling loop, drop the signing session so the iframe goes
        // away, and surface a toast. The next time the parent clicks
        // Sign, the create route's self-heal will wipe the stale
        // Xano metadata and generate a fresh envelope.
        if (data.status === "missing") {
          pollingRef.current = null;
          setSigningSession(null);
          toast.error(
            "This document is no longer available. Please refresh and try again."
          );
          return;
        }
        if (data.status === "completed") {
          await patchRegProgress({
            enrollment_agreement_status: "completed",
            is_enrollment_agreement_signed: true,
            isEnrollment: true,
          });
          setSigningSession(null);
          announceSigned(documentId);
          pollingRef.current = null;
          return;
        }
        delay = Math.min(delay * 1.2, maxDelay);
        pollingRef.current = setTimeout(poll, delay);
      } catch {
        delay = Math.min(delay * 1.5, maxDelay);
        pollingRef.current = setTimeout(poll, delay);
      }
    }

    pollingRef.current = setTimeout(poll, delay);
  }

  // Inline PandaDoc embed — mounts the widget into the `<div
  // id="pandadoc-enrollment-embed">` below as soon as a signing session is
  // available. Cleanly destroys on unmount / session change.
  useEffect(() => {
    if (!signingSession) return;
    let cancelled = false;

    const init = async () => {
      // Wait for the embed target to exist in the DOM (we only render it
      // inside the signing branch of the template below).
      let target: HTMLElement | null = null;
      for (let i = 0; i < 20; i++) {
        target = document.getElementById("pandadoc-enrollment-embed");
        if (target) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      if (!target || cancelled) return;

      // Clear any stray child iframes from a prior mount.
      target.innerHTML = "";

      const { Signing } = await import("pandadoc-signing");
      if (cancelled) return;

      if (signingInstanceRef.current) {
        signingInstanceRef.current.destroy();
        signingInstanceRef.current = null;
      }

      // `debugMode` only makes the widget log its steps to the console
      // (event payloads included, which carry the signer's name and
      // email). Useful while developing, noise on a parent's device.
      const signing = new Signing("pandadoc-enrollment-embed", {
        debugMode: process.env.NODE_ENV !== "production",
      });
      signing
        .on("document.completed", async () => {
          await patchRegProgress({
            enrollment_agreement_status: "completed",
            is_enrollment_agreement_signed: true,
            isEnrollment: true,
          });
          setSigningSession(null);
          announceSigned(signingSession.documentId);
        })
        .on("document.exception", (payload: unknown) => {
          console.error("PandaDoc signing exception:", payload);
        });

      signingInstanceRef.current = signing;
      await signing.open({ sessionId: signingSession.sessionId });
    };

    init();

    return () => {
      cancelled = true;
      if (signingInstanceRef.current) {
        signingInstanceRef.current.destroy();
        signingInstanceRef.current = null;
      }
    };
  }, [signingSession]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearTimeout(pollingRef.current);
    };
  }, []);

  // The PandaDoc signing widget needs the full viewport width to render its
  // desktop layout (document preview + side toolbars). A `max-w-4xl`
  // constraint on this page collapses it to a cramped mobile-like view —
  // so we let this page use a wider container than the rest of the flow.
  const pageShell = "flex flex-1 flex-col gap-6 p-6 pb-0 mx-auto w-full max-w-6xl";

  // A fetch this page can't render without has exhausted SWR's retry
  // budget with nothing cached. `loading` keys on "no data yet", which
  // is also what a failed request leaves behind, so one 5xx used to
  // park the parent on the skeleton — and this is where acceptance
  // emails deep-link to. Only an error with NO data behind it blocks;
  // a failed background revalidation keeps the page on screen. "Try
  // again" refetches every parent-API key in place.
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
          <Skeleton className="h-7 w-56 mb-2" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-[70vh] w-full rounded-lg" />
      </div>
    );
  }

  return (
    <div className={pageShell}>
      <div>
        <h1 className="text-2xl font-semibold text-center xl:text-left">Enrollment Agreement</h1>
        <p className="text-muted-foreground text-sm mt-1 text-center xl:text-left">
          {isCompleted
            ? "This document has been signed and completed."
            : signingSession
              ? "Review and sign the enrollment agreement below."
              : prepFailed
                ? "We couldn't prepare your enrollment agreement. Please try again, or contact the school if it keeps happening."
                : applications.length === 0
                  ? "Add a student to your registration before signing the enrollment agreement."
                  : "Your enrollment agreement is being prepared. Signing will load in this page as soon as it's ready."}
        </p>
      </div>

      {/* Completed: the signed PDF inline, with a spinner and message
          while it loads, and the Download button underneath.

          `SignedPdfFrame` doesn't point the iframe at the download proxy
          until the proxy answers with a PDF. Right after signing it can
          still answer with a JSON error: PandaDoc hasn't produced the
          file yet, or `isEnrollment` was latched optimistically above
          and the row doesn't read "completed" until that save lands. A
          bare iframe showed that JSON to the parent as raw text.

          The Download button replaces the layout's "Section Completed"
          button. The preview already shows the doc inline, so a "View"
          action would just re-render the same thing — Download is the
          only meaningful follow-up.
          The "Re-Sign Document" affordance used to live here too, but
          it 409'd on the PandaDoc create endpoint (which rejects
          re-creating an already-signed doc) and there's no sane re-sign
          flow — once PandaDoc has the signed envelope, the parent can't
          legally replace it with a fresh signing session anyway. Admin
          can void the agreement from the PandaDoc dashboard if a
          re-sign is actually needed. */}
      {isCompleted && pdfUrl && (
        <SignedPdfFrame
          src={pdfUrl}
          title="Signed Enrollment Agreement"
          downloadName="enrollment-agreement.pdf"
          loadingLabel="Loading Signed PDF Document..."
        />
      )}

      {/* Active signing session — embed the PandaDoc widget directly in
          place of the preparing skeleton. The widget mounts into this
          container via the effect above.

          The 720px floor keeps the widget generous on a short desktop
          window, and it only applies from `xl` up. Below that the
          layout pins a bottom bar to the screen as well as the header
          (about 125px between them), and a 720px embed is taller than
          what is left of a phone screen (under 690px at 375×812): the
          widget's own controls ended up behind the bar. There the embed
          is 80vh, which fits between the two. */}
      {!isCompleted && signingSession && (
        <div className="relative rounded-lg border overflow-hidden bg-white w-full h-[80vh] xl:min-h-[720px]">
          <style>{`
            #pandadoc-enrollment-embed {
              position: absolute;
              inset: 0;
              width: 100%;
              height: 100%;
            }
            #pandadoc-enrollment-embed > * {
              width: 100% !important;
              height: 100% !important;
            }
            #pandadoc-enrollment-embed iframe {
              width: 100% !important;
              height: 100% !important;
              border: none !important;
              display: block !important;
            }
          `}</style>
          <div id="pandadoc-enrollment-embed" className="absolute inset-0" />
        </div>
      )}

      {/* Preparing skeleton — shown while we're creating the PandaDoc and
          waiting for a signing session to return. */}
      {!isCompleted && !signingSession && (
        <div className="relative rounded-lg border overflow-hidden" style={{ height: "70vh" }}>
          <Skeleton className="absolute inset-0 rounded-none" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex items-center gap-2">
              {signingLoading ? (
                <>
                  <Loader2 className="size-5 animate-spin text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    Preparing enrollment agreement...
                  </span>
                </>
              ) : prepFailed ? (
                // Preparing failed (toast already shown): offer a retry
                // instead of a placeholder that never resolves.
                <Button
                  variant="outline"
                  className="bg-white"
                  onClick={() => void handleSign()}
                >
                  Try again
                </Button>
              ) : applications.length === 0 ? (
                <span className="text-sm text-muted-foreground">
                  No student on this registration yet.
                </span>
              ) : (
                <span className="text-sm text-muted-foreground">
                  Loading enrollment agreement...
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

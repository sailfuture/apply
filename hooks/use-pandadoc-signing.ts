import { useState, useEffect, useRef, useCallback } from "react";
import { toast } from "sonner";
import { mutateApplications } from "@/hooks/use-api";

interface Application {
  id: number;
  registration_students_id: number;
  registration_school_years_id: number;
  enrollment_agreement_pandadoc_id: string | null;
  enrollment_agreement_status: string | null;
  enrollment_agreement_pdf_url: string | null;
}

/**
 * Per-student registration packet shape this hook needs. Carries
 * just the waiver fields — the full `XanoStudentRegistration` is
 * heavier than the hook should depend on, and callers already have
 * a typed packet row from `/api/student-registration`. Keyed by
 * `registration_students_id` so the hook can find the matching
 * packet for the student whose waiver is being signed.
 */
interface PacketForWaiver {
  id: number;
  registration_students_id: number;
  liability_waiver_pandadoc_id: string | null;
  liability_waiver_status: string | null;
  liability_waiver_pdf_url: string | null;
}

export interface SigningSession {
  sessionId: string;
  documentId: string;
  type: "liability_waiver" | "enrollment_agreement";
  applicationId: number;
}

export function usePandaDocSigning(
  applications: Application[],
  onRefresh: () => Promise<void>,
  /**
   * Per-student registration packets for the year — needed because
   * liability-waiver state moved from the application row to the
   * packet. The hook joins the first application's
   * `registration_students_id` to the matching packet to find
   * waiver fields.
   *
   * Defaults to `[]` so callers that haven't loaded packets yet
   * (or only care about the enrollment-agreement flow) don't have
   * to pass a third argument. Waiver-related affordances will read
   * empty / null until packets land.
   */
  packets: PacketForWaiver[] = []
) {
  const [signingLoading, setSigningLoading] = useState<string | null>(null);
  const [signingSession, setSigningSession] = useState<SigningSession | null>(
    null
  );
  // `docLoaded` flips true when PandaDoc's embed fires `document.loaded`
  // for the current session. Used by callers to render a full-screen
  // blocking overlay during the prep + iframe-init window — the
  // signingSession existing isn't enough on its own (it's set the
  // moment the API returns the sessionId, before the iframe has
  // rendered anything).
  const [docLoaded, setDocLoaded] = useState(false);
  const [resetConfirm, setResetConfirm] = useState<
    "liability_waiver" | "enrollment_agreement" | null
  >(null);
  const [resetting, setResetting] = useState(false);
  const [pdfViewerDoc, setPdfViewerDoc] = useState<{
    type: "liability_waiver" | "enrollment_agreement";
    url: string;
  } | null>(null);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const signingInstanceRef = useRef<{ destroy: () => void } | null>(null);
  const overlayTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Warm the embed chunk on mount so the dynamic `import("pandadoc-
  // signing")` in the init effect resolves instantly once a session is
  // ready — takes ~50-300ms off the critical path between the create
  // call returning and the iframe starting to load.
  useEffect(() => {
    void import("pandadoc-signing").catch(() => {});
  }, []);

  // Reset `docLoaded` every time a new signing session starts so the
  // overlay re-engages for the next sign attempt (the iframe needs
  // time to re-render even when a session is replayed).
  useEffect(() => {
    if (!signingSession) {
      setDocLoaded(false);
    } else {
      setDocLoaded(false);
    }
  }, [signingSession]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearTimeout(pollingRef.current);
    };
  }, []);

  // PandaDoc embed initialization
  useEffect(() => {
    if (!signingSession) return;

    let cancelled = false;

    const init = async () => {
      // Wait for the Dialog to render the wrapper div. It mounts
      // within a frame or two of `signingSession` being set, so poll
      // fast (short ticks) rather than the old 100ms × 20 = up-to-2s.
      let wrapper: HTMLElement | null = null;
      for (let i = 0; i < 40; i++) {
        wrapper = document.getElementById("pandadoc-signing-wrapper");
        if (wrapper) break;
        await new Promise((r) => setTimeout(r, 25));
      }
      if (!wrapper || cancelled) return;

      wrapper.innerHTML = '<div id="pandadoc-signing-embed"></div>';

      const { Signing } = await import("pandadoc-signing");
      if (cancelled) return;

      if (signingInstanceRef.current) {
        signingInstanceRef.current.destroy();
        signingInstanceRef.current = null;
      }

      const signing = new Signing("pandadoc-signing-embed", {
        debugMode: true,
      });

      // Any TERMINAL embed event must drop the blocking overlay — a
      // failure that leaves the overlay up traps the parent behind an
      // undismissable "Preparing…" screen forever. The vendor emits
      // several failure events besides `document.exception`; subscribe
      // to all of them.
      const dismissWithError = (label: string) => (payload: unknown) => {
        setDocLoaded(true);
        console.error(`PandaDoc signing ${label}:`, payload);
        toast.error(
          "There was a problem loading the document. Please close and try again."
        );
      };

      signing
        .on("document.loaded", () => {
          // Iframe has the doc rendered and interactive — drop overlay.
          setDocLoaded(true);
        })
        .on("document.completed", () => {
          onRefresh();
        })
        .on("document.exception", dismissWithError("exception"))
        .on("document.loading.error", dismissWithError("loading error"))
        .on("document.not.found", dismissWithError("not found"))
        .on(
          "document.attempts.limit.exceeded",
          dismissWithError("attempts limit exceeded")
        );

      signingInstanceRef.current = signing;

      // Safety net: if NO terminal event ever fires (session expired
      // before the iframe could report, network stall), don't strand
      // the parent behind the overlay indefinitely — drop it after a
      // generous window so they can retry.
      const overlayTimeout = setTimeout(() => {
        if (!cancelled) setDocLoaded(true);
      }, 25_000);
      overlayTimeoutRef.current = overlayTimeout;

      await signing.open({ sessionId: signingSession.sessionId });
    };

    init();

    return () => {
      cancelled = true;
      if (overlayTimeoutRef.current) {
        clearTimeout(overlayTimeoutRef.current);
        overlayTimeoutRef.current = null;
      }
      if (signingInstanceRef.current) {
        signingInstanceRef.current.destroy();
        signingInstanceRef.current = null;
      }
    };
  }, [signingSession, onRefresh]);

  /**
   * Find the packet for the first application's student. The waiver
   * flow is per-student per-year; we only ever sign for the first
   * application in the list (multi-student waiver flows go through
   * the per-student `/registration` page directly). Returns `null`
   * when no packet exists yet — `getDocField` etc. fall back to
   * empty values, matching the pre-packet behavior.
   */
  function packetForFirstApp(): PacketForWaiver | null {
    if (applications.length === 0) return null;
    const studentId = applications[0].registration_students_id;
    return (
      packets.find((p) => p.registration_students_id === studentId) ?? null
    );
  }

  function getDocField(type: "liability_waiver" | "enrollment_agreement") {
    if (applications.length === 0)
      return { pandadocId: null, status: null, pdfUrl: null };
    const app = applications[0];
    if (type === "liability_waiver") {
      const packet = packetForFirstApp();
      return {
        pandadocId: packet?.liability_waiver_pandadoc_id ?? null,
        status: packet?.liability_waiver_status ?? null,
        pdfUrl: packet?.liability_waiver_pdf_url ?? null,
      };
    }
    return {
      pandadocId: app.enrollment_agreement_pandadoc_id,
      status: app.enrollment_agreement_status,
      pdfUrl: app.enrollment_agreement_pdf_url,
    };
  }

  function viewDocument(type: "liability_waiver" | "enrollment_agreement") {
    if (applications.length === 0) return;
    const app = applications[0];
    const docId =
      type === "liability_waiver"
        ? packetForFirstApp()?.liability_waiver_pandadoc_id
        : app.enrollment_agreement_pandadoc_id;
    if (!docId) return;
    window.open(
      `/api/pandadoc/download?documentId=${docId}&applicationId=${app.id}&yearId=${app.registration_school_years_id}`,
      "_blank"
    );
  }

  function viewPdfInModal(type: "liability_waiver" | "enrollment_agreement") {
    if (applications.length === 0) return;
    const app = applications[0];
    const docId =
      type === "liability_waiver"
        ? packetForFirstApp()?.liability_waiver_pandadoc_id
        : app.enrollment_agreement_pandadoc_id;
    if (!docId) return;
    setPdfViewerDoc({
      type,
      url: `/api/pandadoc/download?documentId=${docId}&applicationId=${app.id}&yearId=${app.registration_school_years_id}`,
    });
  }

  const handleSign = useCallback(
    async (type: "liability_waiver" | "enrollment_agreement") => {
      if (applications.length === 0) {
        toast.error("Please enroll a student before signing documents.");
        return;
      }
      const app = applications[0];

      setSigningLoading(type);
      try {
        const res = await fetch("/api/pandadoc/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type,
            applicationId: app.id,
            yearId: app.registration_school_years_id,
          }),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => null);
          toast.error(
            body?.error ?? "Failed to prepare document. Please try again."
          );
          return;
        }

        const data = await res.json();
        // The envelope is already signed on PandaDoc but our row hadn't
        // caught up (the parent closed the tab before a poll synced
        // it). The create route just synced it server-side — DON'T open
        // a signing session (that would re-sign a completed doc); just
        // refresh so the page renders the signed PDF.
        if (data.completed) {
          await onRefresh();
          await mutateApplications();
          return;
        }

        const { documentId, sessionId } = data;
        setSigningSession({
          sessionId,
          documentId,
          type,
          applicationId: app.id,
        });
        startPolling(documentId, type, app.id, app.registration_school_years_id);
      } catch {
        toast.error("Failed to initiate signing. Please try again.");
      } finally {
        setSigningLoading(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [applications]
  );

  function handleSigningClose() {
    setSigningSession(null);
  }

  async function handleResetConfirmed() {
    if (!resetConfirm || applications.length === 0) return;
    const app = applications[0];

    setResetting(true);
    try {
      const res = await fetch("/api/pandadoc/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: resetConfirm, applicationId: app.id }),
      });

      if (!res.ok) {
        toast.error("Failed to reset document.");
        return;
      }

      await onRefresh();
      await mutateApplications();
    } catch {
      toast.error("Failed to reset document. Please try again.");
    } finally {
      setResetting(false);
      setResetConfirm(null);
    }
  }

  function startPolling(
    documentId: string,
    type: "liability_waiver" | "enrollment_agreement",
    applicationId: number,
    yearId: number
  ) {
    if (pollingRef.current) clearTimeout(pollingRef.current);

    let delay = 3000;
    const maxDelay = 30000;
    // Track the last status we acted on so we only fire the (heavy,
    // 5-endpoint) SWR revalidation when the status ACTUALLY changes —
    // not on every tick while the doc merely sits in "viewed" for the
    // whole time the parent reads it. That storm was ~100+ redundant
    // requests per signing session.
    let lastStatus: string | null = null;

    async function poll() {
      try {
        const res = await fetch(
          `/api/pandadoc/status?documentId=${documentId}&applicationId=${applicationId}&type=${type}&yearId=${yearId}`
        );
        if (!res.ok) {
          delay = Math.min(delay * 1.5, maxDelay);
          pollingRef.current = setTimeout(poll, delay);
          return;
        }
        const data = await res.json();

        // `status: "missing"` = PandaDoc no longer has the envelope
        // (admin deleted it). Stop polling permanently, drop the
        // signing session so the modal closes, refresh the parent's
        // metadata via `/api/pandadoc/reset` (so the next sign attempt
        // creates a fresh envelope), and surface a toast. Without
        // this branch, the polling loop hammered /api/pandadoc/status
        // forever after a deleted doc.
        if (data.status === "missing") {
          pollingRef.current = null;
          setSigningSession(null);
          await onRefresh();
          await mutateApplications();
          toast.error(
            "This document is no longer available. Please try again to start fresh."
          );
          return;
        }

        // Only revalidate when the status transitions — a steady
        // "viewed" while the parent reads shouldn't re-fetch anything.
        const statusChanged = data.status !== lastStatus;
        lastStatus = data.status;
        if (
          statusChanged &&
          (data.status === "completed" || data.status === "viewed")
        ) {
          await onRefresh();
          await mutateApplications();
        }
        if (data.status === "completed") {
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

  return {
    signingLoading,
    signingSession,
    docLoaded,
    resetConfirm,
    resetting,
    pdfViewerDoc,
    handleSign,
    handleSigningClose,
    handleResetConfirmed,
    setResetConfirm,
    viewDocument,
    viewPdfInModal,
    setPdfViewerDoc,
    getDocField,
  };
}

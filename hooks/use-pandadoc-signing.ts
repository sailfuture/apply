import { useState, useEffect, useRef, useCallback } from "react";
import { toast } from "sonner";
import { mutateApplications } from "@/hooks/use-api";

interface Application {
  id: number;
  liability_waiver_pandadoc_id: string | null;
  liability_waiver_status: string | null;
  liability_waiver_pdf_url: string | null;
  enrollment_agreement_pandadoc_id: string | null;
  enrollment_agreement_status: string | null;
  enrollment_agreement_pdf_url: string | null;
}

export interface SigningSession {
  sessionId: string;
  documentId: string;
  type: "liability_waiver" | "enrollment_agreement";
  applicationId: number;
}

export function usePandaDocSigning(
  applications: Application[],
  onRefresh: () => Promise<void>
) {
  const [signingLoading, setSigningLoading] = useState<string | null>(null);
  const [signingSession, setSigningSession] = useState<SigningSession | null>(
    null
  );
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
      await new Promise((r) => setTimeout(r, 400));
      if (cancelled) return;

      const wrapper = document.getElementById("pandadoc-signing-wrapper");
      if (!wrapper) return;

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

      signing
        .on("document.loaded", () => {
          console.log("PandaDoc: document loaded");
        })
        .on("document.completed", () => {
          onRefresh();
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
  }, [signingSession, onRefresh]);

  function getDocField(type: "liability_waiver" | "enrollment_agreement") {
    if (applications.length === 0)
      return { pandadocId: null, status: null, pdfUrl: null };
    const app = applications[0];
    if (type === "liability_waiver") {
      return {
        pandadocId: app.liability_waiver_pandadoc_id,
        status: app.liability_waiver_status,
        pdfUrl: app.liability_waiver_pdf_url,
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
        ? app.liability_waiver_pandadoc_id
        : app.enrollment_agreement_pandadoc_id;
    if (!docId) return;
    window.open(
      `/api/pandadoc/download?documentId=${docId}&applicationId=${app.id}`,
      "_blank"
    );
  }

  function viewPdfInModal(type: "liability_waiver" | "enrollment_agreement") {
    if (applications.length === 0) return;
    const app = applications[0];
    const docId =
      type === "liability_waiver"
        ? app.liability_waiver_pandadoc_id
        : app.enrollment_agreement_pandadoc_id;
    if (!docId) return;
    setPdfViewerDoc({
      type,
      url: `/api/pandadoc/download?documentId=${docId}&applicationId=${app.id}`,
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
          body: JSON.stringify({ type, applicationId: app.id }),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => null);
          toast.error(
            body?.error ?? "Failed to prepare document. Please try again."
          );
          return;
        }

        const { documentId, sessionId } = await res.json();
        setSigningSession({
          sessionId,
          documentId,
          type,
          applicationId: app.id,
        });
        startPolling(documentId, type, app.id);
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
    applicationId: number
  ) {
    if (pollingRef.current) clearTimeout(pollingRef.current);

    let delay = 3000;
    const maxDelay = 30000;

    async function poll() {
      try {
        const res = await fetch(
          `/api/pandadoc/status?documentId=${documentId}&applicationId=${applicationId}&type=${type}`
        );
        if (!res.ok) {
          delay = Math.min(delay * 1.5, maxDelay);
          pollingRef.current = setTimeout(poll, delay);
          return;
        }
        const data = await res.json();

        if (data.status === "completed" || data.status === "viewed") {
          await onRefresh();
          await mutateApplications();
          if (data.status === "completed") {
            pollingRef.current = null;
            return;
          }
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

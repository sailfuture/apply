"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useParams } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { useApplicationFlow } from "@/contexts/application-flow-context";
import { useApplications, useFamily, mutateApplications } from "@/hooks/use-api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, CheckCircle2 } from "lucide-react";
import useSWR from "swr";
import { toast } from "sonner";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function EnrollmentSigningPage() {
  const params = useParams();
  const yearId = Number(params.yearId);
  const { user } = useUser();

  const { setPageTitle, updateSaveOptions } = useApplicationFlow();
  const { data: familyData } = useFamily();
  const { data: appsData } = useApplications();

  const familyId = familyData?.id ?? null;

  // Fetch family payment record
  const { data: paymentRecord, mutate: mutatePayment } = useSWR(
    yearId ? `/api/family-payment?yearId=${yearId}` : null,
    fetcher,
    { revalidateOnFocus: false }
  );

  const [pdfLoaded, setPdfLoaded] = useState(false);
  const [signingLoading, setSigningLoading] = useState(false);
  const [signingSession, setSigningSession] = useState<{ sessionId: string; documentId: string } | null>(null);
  const signingInstanceRef = useRef<{ destroy: () => void } | null>(null);
  const pollingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoInitRef = useRef(false);

  useEffect(() => {
    setPageTitle("Enrollment");
  }, [setPageTitle]);

  const applications = useMemo(() => {
    if (!appsData) return [];
    return (appsData as { registration_school_years_id: number; id: number }[]).filter(
      (a) => a.registration_school_years_id === yearId
    );
  }, [appsData, yearId]);

  const loading = !appsData || !familyData || paymentRecord === undefined;

  const isCompleted = paymentRecord?.is_enrollment_agreement_signed === true || paymentRecord?.enrollment_agreement_status === "completed";
  const isSent = !!paymentRecord?.enrollment_agreement_pandadoc_id;
  const paymentId = paymentRecord?.id;

  const [unlocked, setUnlocked] = useState(false);

  async function handleUnlockEnrollment() {
    setUnlocked(true);
    try {
      await fetch("/api/family-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          registration_school_years_id: yearId,
          is_enrollment_agreement_signed: false,
          enrollment_agreement_status: "",
          enrollment_agreement_pandadoc_id: "",
        }),
      });
      await mutatePayment();
      autoInitRef.current = false;
    } catch {
      console.error("Failed to unlock enrollment section");
    }
  }

  useEffect(() => {
    if (isCompleted && !unlocked) {
      updateSaveOptions({
        completed: true,
        completedLabel: "Enrollment Agreement Signed",
        onUnlock: handleUnlockEnrollment,
      });
    } else {
      updateSaveOptions({
        label: "Please Sign Enrollment Agreement",
        completed: false,
        disabled: true,
        isUnlocked: unlocked,
      });
    }
  }, [isCompleted, unlocked, updateSaveOptions]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-initiate signing when page loads
  useEffect(() => {
    if (loading || autoInitRef.current) return;
    if (applications.length === 0) return;
    if (!isCompleted && !signingLoading && !signingSession) {
      autoInitRef.current = true;
      handleSign();
    }
  }, [loading, applications.length, isCompleted, isSent, signingLoading, signingSession]); // eslint-disable-line react-hooks/exhaustive-deps

  const pdfUrl = useMemo(() => {
    if (!isCompleted || !paymentRecord?.enrollment_agreement_pandadoc_id) return null;
    const appId = applications[0]?.id;
    if (!appId) return null;
    return `/api/pandadoc/download?documentId=${paymentRecord.enrollment_agreement_pandadoc_id}&applicationId=${appId}`;
  }, [isCompleted, paymentRecord, applications]);

  async function handleSign() {
    if (applications.length === 0) {
      toast.error("Please enroll a student first.");
      return;
    }
    const app = applications[0];

    setSigningLoading(true);
    try {
      const res = await fetch("/api/pandadoc/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "enrollment_agreement", applicationId: app.id }),
      });

      if (!res.ok) {
        if (res.status === 409) {
          // Document already signed — refresh data
          await mutatePayment();
          return;
        }
        const body = await res.json().catch(() => null);
        toast.error(body?.error ?? "Failed to prepare document.");
        return;
      }

      const { documentId, sessionId } = await res.json();

      // Save PandaDoc ID to family payment record (create if needed)
      await fetch("/api/family-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          registration_school_years_id: yearId,
          enrollment_agreement_pandadoc_id: documentId,
          enrollment_agreement_status: "sent",
          enrollment_agreement_sent_at: new Date().toISOString(),
        }),
      });
      await mutatePayment();

      setSigningSession({ sessionId, documentId });
      startPolling(documentId);
    } catch {
      toast.error("Failed to initiate signing.");
    } finally {
      setSigningLoading(false);
    }
  }

  function startPolling(documentId: string) {
    if (pollingRef.current) clearTimeout(pollingRef.current);
    let delay = 3000;
    const maxDelay = 30000;
    const appId = applications[0]?.id ?? 0;

    async function poll() {
      try {
        const res = await fetch(
          `/api/pandadoc/status?documentId=${documentId}&applicationId=${appId}&type=enrollment_agreement`
        );
        if (!res.ok) {
          delay = Math.min(delay * 1.5, maxDelay);
          pollingRef.current = setTimeout(poll, delay);
          return;
        }
        const data = await res.json();
        if (data.status === "completed") {
          // Update family payment record
          await fetch("/api/family-payment", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              registration_school_years_id: yearId,
              enrollment_agreement_status: "completed",
              is_enrollment_agreement_signed: true,
            }),
          });
          await mutatePayment();
          setSigningSession(null);
          toast.success("Enrollment agreement signed successfully.");
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

  // PandaDoc embed initialization
  useEffect(() => {
    if (!signingSession) return;
    let cancelled = false;

    const init = async () => {
      let wrapper: HTMLElement | null = null;
      for (let i = 0; i < 20; i++) {
        wrapper = document.getElementById("pandadoc-enrollment-wrapper");
        if (wrapper) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      if (!wrapper || cancelled) return;

      wrapper.innerHTML = '<div id="pandadoc-enrollment-embed"></div>';

      const { Signing } = await import("pandadoc-signing");
      if (cancelled) return;

      if (signingInstanceRef.current) {
        signingInstanceRef.current.destroy();
        signingInstanceRef.current = null;
      }

      const signing = new Signing("pandadoc-enrollment-embed", { debugMode: true });
      signing
        .on("document.completed", async () => {
          await fetch("/api/family-payment", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              registration_school_years_id: yearId,
              enrollment_agreement_status: "completed",
              is_enrollment_agreement_signed: true,
            }),
          });
          await mutatePayment();
          setSigningSession(null);
          toast.success("Enrollment agreement signed successfully.");
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

  if (loading) {
    return (
      <div className="flex flex-1 flex-col gap-6 p-6 mx-auto w-full max-w-4xl">
        <div className="text-center xl:text-left">
          <Skeleton className="h-7 w-56 mb-2" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-1 flex-col gap-6 p-6 pb-0 mx-auto w-full max-w-4xl">
        <div className="flex items-start justify-between gap-4">
          <div className="text-center xl:text-left">
            <h1 className="text-2xl font-semibold">Enrollment Agreement</h1>
            <p className="text-muted-foreground text-sm mt-1">
              {isCompleted
                ? "This document has been signed and completed."
                : "Your enrollment agreement is being prepared by the admissions team. You will be notified when it is ready for your signature."}
            </p>
          </div>
          {isCompleted && (
            <div className="flex gap-2 shrink-0">
              {pdfUrl && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open(pdfUrl, "_blank")}
                >
                  View Document
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  autoInitRef.current = false;
                  handleSign();
                }}
              >
                Re-Sign Document
              </Button>
            </div>
          )}
        </div>

        {/* Completed: Show PDF */}
        {isCompleted && pdfUrl && (
          <div className="relative rounded-lg border overflow-hidden" style={{ height: "70vh" }}>
            {!pdfLoaded && (
              <div className="absolute inset-0">
                <Skeleton className="absolute inset-0 rounded-none" />
              </div>
            )}
            <iframe
              src={pdfUrl}
              onLoad={() => setPdfLoaded(true)}
              className={`w-full h-full border-none transition-opacity duration-300 ${
                pdfLoaded ? "opacity-100" : "opacity-0"
              }`}
              title="Signed Enrollment Agreement"
            />
          </div>
        )}

        {/* Loading / preparing state */}
        {(signingLoading || (!isCompleted && !signingSession)) && (
          <div className="relative rounded-lg border overflow-hidden" style={{ height: "70vh" }}>
            <Skeleton className="absolute inset-0 rounded-none" />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="flex items-center gap-2">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Preparing enrollment agreement...</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* PandaDoc Signing Modal */}
      <Dialog
        open={!!signingSession}
        onOpenChange={(open) => {
          if (!open) {
            if (signingInstanceRef.current) {
              signingInstanceRef.current.destroy();
              signingInstanceRef.current = null;
            }
            if (pollingRef.current) {
              clearTimeout(pollingRef.current);
              pollingRef.current = null;
            }
            setSigningSession(null);
            mutatePayment();
          }
        }}
      >
        <DialogContent className="max-w-[95vw] sm:max-w-[95vw] w-full h-[90vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-6 py-4 border-b shrink-0">
            <DialogTitle>Sign Enrollment Agreement</DialogTitle>
            <DialogDescription>
              Review and sign the enrollment agreement below.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 relative overflow-hidden">
            <style>{`
              #pandadoc-enrollment-wrapper {
                position: absolute;
                inset: 0;
              }
              #pandadoc-enrollment-wrapper iframe {
                width: 100% !important;
                height: 100% !important;
                border: none;
              }
            `}</style>
            <div id="pandadoc-enrollment-wrapper" className="absolute inset-0" />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

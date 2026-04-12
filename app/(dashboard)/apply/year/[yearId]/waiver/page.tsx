"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useParams } from "next/navigation";
import { useApplicationFlow } from "@/contexts/application-flow-context";
import { useApplications, useFamily, mutateApplications } from "@/hooks/use-api";
import { usePandaDocSigning } from "@/hooks/use-pandadoc-signing";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2 } from "lucide-react";

export default function WaiverPage() {
  const params = useParams();
  const yearId = Number(params.yearId);

  const {
    setPageTitle,
    registerSaveHandler,
    unregisterSaveHandler,
  } = useApplicationFlow();

  useEffect(() => {
    setPageTitle("Liability Waiver");
    return () => unregisterSaveHandler();
  }, [setPageTitle, unregisterSaveHandler, registerSaveHandler]);

  const { data: familyData, mutate: mutateFamily } = useFamily();
  const { data: appsData, mutate: mutateApps } = useApplications();

  const applications = useMemo(() => {
    if (!appsData) return [];
    return (appsData as { registration_school_years_id: number }[]).filter(
      (a) => a.registration_school_years_id === yearId
    );
  }, [appsData, yearId]);

  const fetchData = useCallback(async () => {
    await Promise.all([mutateFamily(), mutateApps(), mutateApplications()]);
  }, [mutateFamily, mutateApps]);

  const signing = usePandaDocSigning(
    applications as unknown as Parameters<typeof usePandaDocSigning>[0],
    fetchData
  );

  const docField = signing.getDocField("liability_waiver");
  const isCompleted = docField.status === "completed";
  const isSent = !!docField.pandadocId;
  const loading = !appsData;

  // Auto-initiate signing if document exists but not completed
  const [pdfLoaded, setPdfLoaded] = useState(false);
  const autoInitRef = useRef(false);

  useEffect(() => {
    if (loading || autoInitRef.current) return;
    if (applications.length === 0) return;
    // Auto-initiate signing if not completed and not already in a signing session
    if (!isCompleted && !signing.signingLoading && !signing.signingSession) {
      autoInitRef.current = true;
      signing.handleSign("liability_waiver");
    }
  }, [loading, applications.length, isCompleted, signing]);

  const pdfUrl = useMemo(() => {
    if (!isCompleted || applications.length === 0) return null;
    const app = applications[0] as unknown as { id: number; liability_waiver_pandadoc_id?: string | null };
    if (!app.liability_waiver_pandadoc_id) return null;
    return `/api/pandadoc/download?documentId=${app.liability_waiver_pandadoc_id}&applicationId=${app.id}`;
  }, [isCompleted, applications]);

  if (loading) {
    return (
      <div className="flex flex-1 flex-col gap-6 p-6 mx-auto w-full max-w-4xl">
        <div className="text-center xl:text-left">
          <Skeleton className="h-7 w-48 mx-auto mb-2" />
          <Skeleton className="h-4 w-72 mx-auto" />
        </div>
        <Skeleton className="h-[60vh] w-full rounded-lg" />
      </div>
    );
  }

  if (applications.length === 0) {
    return (
      <div className="flex flex-1 flex-col gap-6 p-6 mx-auto w-full max-w-4xl">
        <div className="text-center xl:text-left">
          <h1 className="text-2xl font-semibold">Liability Waiver</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Please enroll a student before signing the liability waiver.
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-1 flex-col gap-6 p-6 pb-0 mx-auto w-full max-w-4xl">
        <div className="flex items-start justify-between gap-4">
          <div className="text-center xl:text-left">
            <h1 className="text-2xl font-semibold">Liability Waiver</h1>
            <p className="text-muted-foreground text-sm mt-1">
              {isCompleted
                ? "This document has been signed and completed."
                : isSent
                  ? "A liability waiver has been prepared and is awaiting your signature."
                  : "Preparing your liability waiver for signing..."}
            </p>
          </div>
          {isCompleted && (
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => signing.setResetConfirm("liability_waiver")}
            >
              Re-Sign Document
            </Button>
          )}
        </div>

        {/* Signing Loading State — skeleton placeholder */}
        {signing.signingLoading === "liability_waiver" && (
          <div className="relative rounded-lg border overflow-hidden" style={{ height: "70vh" }}>
            <Skeleton className="absolute inset-0 rounded-none" />
          </div>
        )}

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
              title="Signed Liability Waiver"
            />
          </div>
        )}

        {/* Signing Embed */}
        {signing.signingSession?.type === "liability_waiver" && (
          <>
            <style>{`
              #pandadoc-signing-wrapper {
                position: relative;
              }
              #pandadoc-signing-wrapper iframe {
                position: absolute;
                top: 0;
                left: 0;
                width: 100% !important;
                height: 100% !important;
                border: none;
              }
            `}</style>
            <div
              id="pandadoc-signing-wrapper"
              className="rounded-lg border overflow-hidden"
              style={{ height: "70vh" }}
            />
          </>
        )}

      </div>

      {/* Reset Confirmation Dialog */}
      <Dialog
        open={signing.resetConfirm === "liability_waiver"}
        onOpenChange={(open) => {
          if (!open) signing.setResetConfirm(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Start Over?</DialogTitle>
            <DialogDescription>
              This will discard the current liability waiver and create a new
              document from scratch. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => signing.setResetConfirm(null)}
              disabled={signing.resetting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={signing.handleResetConfirmed}
              disabled={signing.resetting}
            >
              {signing.resetting ? "Resetting..." : "Yes, Start Over"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

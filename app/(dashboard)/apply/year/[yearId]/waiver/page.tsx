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
    // If not sent yet, auto-initiate
    if (!isSent && !isCompleted && !signing.signingLoading && !signing.signingSession) {
      autoInitRef.current = true;
      signing.handleSign("liability_waiver");
    }
  }, [loading, applications.length, isSent, isCompleted, signing]);

  const pdfUrl = useMemo(() => {
    if (!isCompleted || applications.length === 0) return null;
    const app = applications[0] as unknown as { id: number; liability_waiver_pandadoc_id?: string | null };
    if (!app.liability_waiver_pandadoc_id) return null;
    return `/api/pandadoc/download?documentId=${app.liability_waiver_pandadoc_id}&applicationId=${app.id}`;
  }, [isCompleted, applications]);

  if (loading) {
    return (
      <div className="flex flex-1 flex-col gap-6 p-6 mx-auto w-full max-w-4xl">
        <div className="text-center">
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
        <div className="text-center">
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
      <div className="flex flex-1 flex-col gap-6 p-6 mx-auto w-full max-w-4xl">
        <div className="text-center">
          <h1 className="text-2xl font-semibold">Liability Waiver</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {isCompleted
              ? "This document has been signed and completed."
              : isSent
                ? "Please review and sign the liability waiver below."
                : "Preparing your liability waiver for signing..."}
          </p>
        </div>

        {/* Signing Loading State */}
        {signing.signingLoading === "liability_waiver" && (
          <div className="flex flex-col items-center justify-center py-20">
            <Loader2 className="size-10 animate-spin text-primary mb-4" />
            <p className="text-lg font-medium">Preparing Document</p>
            <p className="text-sm text-muted-foreground mt-1">
              This may take a few moments...
            </p>
          </div>
        )}

        {/* Completed: Show PDF */}
        {isCompleted && pdfUrl && (
          <div className="relative rounded-lg border overflow-hidden" style={{ height: "70vh" }}>
            {!pdfLoaded && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
                <Loader2 className="size-8 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Loading document...</p>
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

        {/* Not started and not loading — show sign button */}
        {!isCompleted &&
          !signing.signingLoading &&
          !signing.signingSession &&
          !isSent && (
            <div className="flex flex-col items-center justify-center py-20">
              <p className="text-sm text-muted-foreground mb-4">
                Click below to prepare and sign the liability waiver.
              </p>
              <Button onClick={() => signing.handleSign("liability_waiver")}>
                Sign Liability Waiver
              </Button>
            </div>
          )}

        {/* Already sent but not in signing session — show re-sign button */}
        {isSent &&
          !isCompleted &&
          !signing.signingLoading &&
          !signing.signingSession && (
            <div className="flex flex-col items-center justify-center py-20">
              <p className="text-sm text-muted-foreground mb-4">
                A liability waiver has been prepared and is awaiting your signature.
              </p>
              <div className="flex gap-3">
                <Button onClick={() => signing.handleSign("liability_waiver")}>
                  Sign Now
                </Button>
                <Button
                  variant="outline"
                  onClick={() => signing.setResetConfirm("liability_waiver")}
                >
                  Start Over
                </Button>
              </div>
            </div>
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

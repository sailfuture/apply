"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import useSWR from "swr";
import { useParams } from "next/navigation";
import { useApplicationFlow } from "@/contexts/application-flow-context";
import { useApplications, useFamily, mutateApplications } from "@/hooks/use-api";
import { usePandaDocSigning } from "@/hooks/use-pandadoc-signing";

// Local fetcher for the per-student packets — they hold the waiver
// state that used to live on the application row. We could lift this
// into `use-api` but the only caller right now is this page (and the
// admin pages, which fetch packets through the admin endpoint).
const packetsFetcher = (url: string) => fetch(url).then((r) => r.json());
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
    updateSaveOptions,
  } = useApplicationFlow();

  useEffect(() => {
    setPageTitle("Liability Waiver");
    return () => unregisterSaveHandler();
  }, [setPageTitle, unregisterSaveHandler, registerSaveHandler]);

  const { data: familyData, mutate: mutateFamily } = useFamily();
  const { data: appsData, mutate: mutateApps } = useApplications();

  // Packets carry waiver state now (moved off the application row).
  // Fetched per-year so the hook can join the first application's
  // student to its packet.
  const { data: packetsData, mutate: mutatePackets } = useSWR<
    | {
        id: number;
        registration_students_id: number;
        liability_waiver_pandadoc_id: string | null;
        liability_waiver_status: string | null;
        liability_waiver_pdf_url: string | null;
      }[]
    | null
  >(
    yearId ? `/api/student-registration?yearId=${yearId}` : null,
    packetsFetcher,
    { revalidateOnFocus: false }
  );

  const applications = useMemo(() => {
    if (!appsData) return [];
    return (appsData as { registration_school_years_id: number }[]).filter(
      (a) => a.registration_school_years_id === yearId
    );
  }, [appsData, yearId]);

  const packets = useMemo(
    () => (Array.isArray(packetsData) ? packetsData : []),
    [packetsData]
  );

  const fetchData = useCallback(async () => {
    await Promise.all([
      mutateFamily(),
      mutateApps(),
      mutatePackets(),
      mutateApplications(),
    ]);
  }, [mutateFamily, mutateApps, mutatePackets]);

  const signing = usePandaDocSigning(
    applications as unknown as Parameters<typeof usePandaDocSigning>[0],
    fetchData,
    packets
  );

  const docField = signing.getDocField("liability_waiver");
  const isCompleted = docField.status === "completed";
  const isSent = !!docField.pandadocId;
  const loading = !appsData;

  const [waiverUnlocked, setWaiverUnlocked] = useState(false);

  useEffect(() => {
    if (isCompleted && !waiverUnlocked) {
      updateSaveOptions({
        completed: true,
        completedLabel: "Liability Waiver Signed",
        onUnlock: () => {
          setWaiverUnlocked(true);
          autoInitRef.current = false;
          signing.handleSign("liability_waiver");
        },
      });
    } else {
      updateSaveOptions({
        label: "Please Sign Liability Waiver",
        disabled: true,
        completed: false,
        isUnlocked: waiverUnlocked,
      });
    }
  }, [isCompleted, waiverUnlocked, updateSaveOptions]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-initiate signing if document exists but not completed
  const [pdfLoaded, setPdfLoaded] = useState(false);
  const autoInitRef = useRef(false);

  useEffect(() => {
    if (loading || autoInitRef.current) return;
    // Wait for packets to load before deciding — waiver state
    // (including the "already completed" flag) lives on the packet,
    // so auto-initiating before packets arrive would fire a needless
    // create call on every revisit of an already-signed waiver.
    if (packetsData === undefined) return;
    if (applications.length === 0) return;
    // Auto-initiate signing if not completed and not already in a signing session
    if (!isCompleted && !signing.signingLoading && !signing.signingSession) {
      // useRef.current is designed to be mutated; the rule misfires here.
      // We use a ref instead of state because we don't want a re-render
      // — just a one-shot guard against re-entry while signing.* settles.
      // eslint-disable-next-line react-hooks/immutability
      autoInitRef.current = true;
      signing.handleSign("liability_waiver");
    }
  }, [loading, packetsData, applications.length, isCompleted, signing]);

  const pdfUrl = useMemo(() => {
    if (!isCompleted || applications.length === 0) return null;
    const app = applications[0] as unknown as {
      id: number;
      registration_students_id: number;
      registration_school_years_id: number;
    };
    // Waiver pandadoc id lives on the per-student packet now.
    const packet = packets.find(
      (p) => p.registration_students_id === app.registration_students_id
    );
    if (!packet?.liability_waiver_pandadoc_id) return null;
    return `/api/pandadoc/download?documentId=${packet.liability_waiver_pandadoc_id}&applicationId=${app.id}&yearId=${app.registration_school_years_id}`;
  }, [isCompleted, applications, packets]);

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
            <div className="flex gap-2 shrink-0">
              {pdfUrl && (
                <Button
                  asChild
                  variant="outline"
                  size="sm"
                >
                  <a href={pdfUrl} download="liability-waiver.pdf">
                    Download Document
                  </a>
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => signing.setResetConfirm("liability_waiver")}
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
              title="Signed Liability Waiver"
            />
          </div>
        )}

        {/* Loading state */}
        {signing.signingLoading === "liability_waiver" && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
            <span className="ml-2 text-sm text-muted-foreground">Preparing document...</span>
          </div>
        )}
      </div>

      {/* PandaDoc Signing Modal */}
      <Dialog
        open={!!signing.signingSession && signing.signingSession.type === "liability_waiver"}
        onOpenChange={(open) => {
          if (!open) {
            signing.handleSigningClose();
            mutateApps();
            mutateApplications();
          }
        }}
      >
        <DialogContent className="max-w-[95vw] sm:max-w-[95vw] w-full h-[90vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-6 py-4 border-b shrink-0">
            <DialogTitle>Sign Liability Waiver</DialogTitle>
            <DialogDescription>
              Review and sign the liability waiver below.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 relative overflow-hidden">
            <style>{`
              #pandadoc-signing-wrapper {
                position: absolute;
                inset: 0;
              }
              #pandadoc-signing-wrapper iframe {
                width: 100% !important;
                height: 100% !important;
                border: none;
              }
            `}</style>
            <div id="pandadoc-signing-wrapper" className="absolute inset-0" />
          </div>
        </DialogContent>
      </Dialog>

      {/* Full-screen blocking overlay during waiver prep. Covers two
          phases the parent shouldn't be able to click out of:
            1. signingLoading is "liability_waiver" → API creating
               + sending the PandaDoc envelope (can take 5-30s)
            2. signingSession exists but the embed hasn't fired
               `document.loaded` yet → iframe mounting / fetching
          Portaled to document.body so it shares the same stacking
          level as the shadcn Dialog's portal — without this, the
          Dialog's backdrop visually covers the overlay regardless
          of z-index because portals create new stacking contexts. */}
      {(signing.signingLoading === "liability_waiver" ||
        (signing.signingSession?.type === "liability_waiver" &&
          !signing.docLoaded)) &&
        typeof window !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95 backdrop-blur-sm"
            role="status"
            aria-live="polite"
            aria-label="Preparing liability waiver"
          >
            <div className="flex flex-col items-center gap-4 px-6 text-center">
              <Loader2 className="size-10 animate-spin text-primary" />
              <div className="space-y-1">
                <p className="text-base font-medium">
                  Preparing your liability waiver…
                </p>
                <p className="text-sm text-muted-foreground max-w-sm">
                  This usually takes a few seconds. Please don&apos;t close
                  this tab.
                </p>
              </div>
            </div>
          </div>,
          document.body
        )}

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

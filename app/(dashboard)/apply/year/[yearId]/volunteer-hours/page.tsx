"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import SignatureCanvas from "react-signature-canvas";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useApplicationFlow } from "@/contexts/application-flow-context";
import { useStudentRegistrationProgress } from "@/hooks/use-student-registration-progress";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { GlobalSaveStatusPill } from "@/components/save-status-pill";

/**
 * Volunteer Hours Acknowledgment — final post-registration step. Parent
 * reads the commitment terms, types their name, signs, and submits. The
 * signature image lands on `signature_data_volunteer` (Xano file metadata),
 * a raw payload containing the typed name + timestamp lands on
 * `volunteer_signature_data` (JSON), and `isVolunteerHours` flips true.
 *
 * When this section is the last of the four (tuition + enrollment +
 * registration + volunteer) to complete, the server-side PATCH handler
 * automatically stamps `submitted_date`, latching the enrolled-family
 * dashboard.
 */
export default function VolunteerHoursPage() {
  const params = useParams();
  const yearId = Number(params.yearId);

  const {
    setPageTitle,
    registerSaveHandler,
    unregisterSaveHandler,
    updateSaveOptions,
  } = useApplicationFlow();
  const {
    progress: regProgress,
    setSection: setRegSection,
    patchProgress: patchRegProgress,
  } = useStudentRegistrationProgress(yearId);

  const [submitting, setSubmitting] = useState(false);
  const [signatureMeta, setSignatureMeta] = useState<Record<string, unknown> | null>(null);
  const [signatureUploading, setSignatureUploading] = useState(false);
  const [printedName, setPrintedName] = useState("");
  const sigCanvasRef = useRef<SignatureCanvas>(null);

  const acknowledged = regProgress?.isVolunteerHours === true;
  const [unlocked, setUnlocked] = useState(false);

  const handleSubmitRef = useRef<() => Promise<void>>(() => Promise.resolve());

  useEffect(() => {
    setPageTitle("Volunteer Hours");
    registerSaveHandler(() => handleSubmitRef.current());
    return () => unregisterSaveHandler();
  }, [setPageTitle, registerSaveHandler, unregisterSaveHandler]);

  // Hydrate signature + name from the progress row once it arrives.
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current) return;
    if (!regProgress) return;
    const persisted = regProgress.signature_data_volunteer as
      | { path?: string; url?: string }
      | null
      | undefined;
    if (persisted && persisted.path) {
      setSignatureMeta(persisted as Record<string, unknown>);
      const url =
        persisted.url ??
        `${process.env.NEXT_PUBLIC_XANO_BASE ?? "https://xsc3-mvx7-r86m.n7e.xano.io"}${persisted.path}`;
      setTimeout(async () => {
        const canvas = sigCanvasRef.current;
        if (!canvas) return;
        try {
          const res = await fetch(url);
          const blob = await res.blob();
          const reader = new FileReader();
          reader.onload = () => {
            const dataUrl = reader.result as string;
            const rawCanvas = canvas.getCanvas();
            canvas.fromDataURL(dataUrl, {
              width: rawCanvas.offsetWidth,
              height: rawCanvas.offsetHeight,
            });
          };
          reader.readAsDataURL(blob);
        } catch (err) {
          console.error("Failed to load volunteer signature:", err);
        }
      }, 300);
    }
    if (regProgress.name_volunteer) setPrintedName(regProgress.name_volunteer);
    hydratedRef.current = true;
  }, [regProgress]);

  async function handleUnlock() {
    setUnlocked(true);
    try {
      await setRegSection("isVolunteerHours", false);
    } catch {
      console.error("Failed to unlock volunteer-hours section");
    }
  }

  function handleLock() {
    setUnlocked(false);
  }

  // Button state — wait for the progress row to arrive so the "Completed"
  // banner doesn't flicker in.
  useEffect(() => {
    if (regProgress === null) return;
    if (acknowledged && !unlocked) {
      updateSaveOptions({
        completed: true,
        completedLabel: "Volunteer Hours Acknowledged",
        disabled: true,
        onUnlock: handleUnlock,
        isUnlocked: false,
      });
    } else {
      updateSaveOptions({
        label: "Acknowledge & Continue",
        disabled: !signatureMeta || signatureUploading || printedName.trim() === "",
        saving: submitting,
        completed: false,
        onUnlock: acknowledged ? handleLock : undefined,
        isUnlocked: unlocked,
      });
    }
  }, [signatureMeta, signatureUploading, submitting, acknowledged, unlocked, regProgress, printedName, updateSaveOptions]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSignatureEnd() {
    if (!sigCanvasRef.current || sigCanvasRef.current.isEmpty()) return;
    const dataUrl = sigCanvasRef.current.toDataURL("image/png");
    setSignatureUploading(true);
    try {
      const blob = await fetch(dataUrl).then((r) => r.blob());
      const file = new File([blob], "volunteer-signature.png", { type: "image/png" });
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      if (res.ok) {
        const meta = await res.json();
        setSignatureMeta(meta);
      }
    } catch (err) {
      console.error("Volunteer signature upload failed:", err);
    } finally {
      setSignatureUploading(false);
    }
  }

  function clearSignature() {
    sigCanvasRef.current?.clear();
    setSignatureMeta(null);
  }

  async function handleAcknowledge(): Promise<void> {
    if (acknowledged) return;
    if (!signatureMeta) {
      toast.error("Please sign above to acknowledge.");
      throw new Error("Signature required");
    }
    if (printedName.trim() === "") {
      toast.error("Please type your full name to acknowledge.");
      throw new Error("Printed name required");
    }
    setSubmitting(true);
    try {
      // Single PATCH — latches the bool, stores the signature image,
      // records the typed name on its dedicated column, and stamps a
      // signing timestamp into the JSON payload. If this is the final
      // section of the four, the server latches `submitted_date`.
      await patchRegProgress({
        isVolunteerHours: true,
        signature_data_volunteer: signatureMeta,
        name_volunteer: printedName.trim(),
        volunteer_signature_data: {
          signed_at: new Date().toISOString(),
        },
      });
      toast.success("Volunteer hours acknowledgment recorded.");
    } catch {
      toast.error("Failed to record acknowledgment. Please try again.");
      throw new Error("Submit failed");
    } finally {
      setSubmitting(false);
    }
  }
  handleSubmitRef.current = handleAcknowledge;

  const loading = regProgress === null;

  if (loading) {
    return (
      <div className="flex flex-1 flex-col gap-6 p-6 mx-auto w-full max-w-4xl">
        <div>
          <div className="flex items-center justify-between gap-3 pb-3 border-b">
            <Skeleton className="h-3 w-20" />
          </div>
          <Skeleton className="h-8 w-3/4 mt-4" />
          <Skeleton className="h-4 w-2/3 mt-3" />
        </div>
        <div className="rounded-lg border p-6 space-y-3">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
        </div>
        <Skeleton className="h-32 w-full rounded-md" />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-6 mx-auto w-full max-w-4xl">
      <div>
        <div className="flex items-center justify-between gap-3 pb-3 border-b">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Volunteer Hours
          </p>
          <GlobalSaveStatusPill />
        </div>
        <h1 className="text-2xl font-semibold mt-4">
          Acknowledge the volunteer-hours commitment
        </h1>
        <p className="text-sm text-muted-foreground mt-2">
          SailFuture Academy families are partners in the school community. The
          program depends on your participation to run.
        </p>
      </div>

      {/* Commitment body */}
      <div className="rounded-xl border bg-white p-6 space-y-4">
        <section>
          <h2 className="text-sm font-semibold mb-2">The commitment</h2>
          <ul className="list-disc pl-5 space-y-1 text-sm text-muted-foreground">
            <li>
              <span className="font-medium text-foreground">40 hours per family per academic year.</span>
            </li>
            <li>
              <span className="font-medium text-foreground">8 hours per term</span>, over the five academic terms (Fall, Winter, Spring, Summer, and the extended term).
            </li>
            <li>
              Hours are logged and approved by SailFuture staff. You&rsquo;ll see your running total on your family dashboard once the year begins.
            </li>
            <li>
              Volunteer hours are a condition of enrollment. Families who fall short at year-end may be asked to make up the balance or may become ineligible for re-enrollment.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-sm font-semibold mb-2">What counts</h2>
          <p className="text-sm text-muted-foreground">
            Chaperoning events and trips, classroom or workshop support, facilities projects, fundraising help, parent-conference assistance, board or committee service, and approved community outreach on behalf of the Academy.
          </p>
        </section>

        <section>
          <h2 className="text-sm font-semibold mb-2">Acknowledgment</h2>
          <p className="text-sm text-muted-foreground">
            By signing below, I acknowledge that our family is responsible for completing 40 volunteer hours during this academic year (8 per term over 5 terms), and that our commitment to this service is part of our enrollment agreement with SailFuture Academy.
          </p>
        </section>
      </div>

      {/* Completed state */}
      {acknowledged && !unlocked ? (
        <div className="rounded-xl border bg-white p-6">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="size-6 text-green-600 shrink-0" />
            <div>
              <p className="text-sm font-medium text-foreground">
                Volunteer hours acknowledgment recorded
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {regProgress?.last_edited
                  ? `Acknowledged on ${new Date(regProgress.last_edited).toLocaleDateString(
                      "en-US",
                      { month: "long", day: "numeric", year: "numeric" }
                    )}`
                  : "Completed"}
              </p>
            </div>
          </div>
          {!!(signatureMeta?.path) && (
            <div className="mt-4 rounded-md border border-input bg-white p-3">
              <p className="text-xs text-muted-foreground mb-2">Signature</p>
              <div className="w-full" style={{ height: 100 }}>
                <img
                  src={
                    (signatureMeta.url as string) ??
                    `${process.env.NEXT_PUBLIC_XANO_BASE ?? "https://xsc3-mvx7-r86m.n7e.xano.io"}${signatureMeta.path}`
                  }
                  alt="Volunteer hours signature"
                  className="w-full h-full object-contain object-left"
                />
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-xl border bg-white p-6">
          <div className="rounded-md border border-input bg-background">
            <SignatureCanvas
              ref={sigCanvasRef}
              penColor="black"
              onEnd={handleSignatureEnd}
              canvasProps={{
                className: "w-full rounded-md cursor-crosshair",
                style: { height: 150 },
              }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {signatureUploading ? (
                <span className="flex items-center gap-1.5">
                  <Loader2 className="size-3 animate-spin" /> Saving signature...
                </span>
              ) : signatureMeta ? (
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="size-3 text-green-600" /> Signature saved
                </span>
              ) : (
                "Sign above using your mouse or touchscreen"
              )}
            </p>
            <Button variant="outline" size="sm" onClick={clearSignature}>
              Clear Signature
            </Button>
          </div>
          <Field className="mt-4">
            <FieldLabel>Type your full name</FieldLabel>
            <Input
              placeholder="Full name of the signing parent or guardian"
              value={printedName}
              onChange={(e) => setPrintedName(e.target.value)}
            />
          </Field>
        </div>
      )}
    </div>
  );
}

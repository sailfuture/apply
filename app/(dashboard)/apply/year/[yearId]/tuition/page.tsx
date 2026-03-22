"use client";

import { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { toast } from "sonner";
import { useApplicationFlow } from "@/contexts/application-flow-context";
import { useStudents, useApplications } from "@/hooks/use-api";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Loader2 } from "lucide-react";
import useSWR from "swr";
import SignatureCanvas from "react-signature-canvas";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface StudentApp {
  studentName: string;
  tuition: number;
  stepUpStatus: string;
  stepUpAmount: number;
  scholarshipAmount: number;
  remaining: number;
  adminFees: number;
  transportFees: number;
  usesTransport: boolean;
}

export default function TuitionPage() {
  const params = useParams();
  const router = useRouter();
  const yearId = Number(params.yearId);
  const { user } = useUser();
  const { setPageTitle, setHideBottomBar } = useApplicationFlow();
  const { data: students } = useStudents();
  const { data: applications } = useApplications();

  // Fetch existing payment review record
  const { data: paymentRecord, mutate: mutatePayment } = useSWR(
    yearId ? `/api/family-payment?yearId=${yearId}` : null,
    fetcher,
    { revalidateOnFocus: false }
  );

  const [submitting, setSubmitting] = useState(false);
  const [signatureMeta, setSignatureMeta] = useState<Record<string, unknown> | null>(null);
  const [signatureUploading, setSignatureUploading] = useState(false);
  const sigCanvasRef = useRef<SignatureCanvas>(null);

  const alreadyReviewed = paymentRecord?.tuition_reviewed === true;

  useEffect(() => {
    setPageTitle("Tuition");
    setHideBottomBar(true);
    return () => setHideBottomBar(false);
  }, [setPageTitle, setHideBottomBar]);

  const loading = !students || !applications;

  // Build per-student data from applications for this year
  const studentApps: StudentApp[] = [];
  if (students && applications) {
    const yearApps = (applications as { registration_school_years_id: number; registration_students_id: number; is_bus_transportation?: boolean }[])
      .filter((a) => a.registration_school_years_id === yearId);

    for (const app of yearApps) {
      const student = (students as { id: number; first_name: string; last_name: string }[])
        .find((s) => s.id === app.registration_students_id);
      if (!student) continue;

      // TODO: Wire these values to real scholarship data from the API
      studentApps.push({
        studentName: `${student.first_name} ${student.last_name}`,
        tuition: 22000,
        stepUpStatus: "Verified",
        stepUpAmount: 7770,
        scholarshipAmount: 14230,
        remaining: 0,
        adminFees: 500,
        transportFees: 1500,
        usesTransport: !!app.is_bus_transportation,
      });
    }
  }

  async function handleSignatureEnd() {
    if (!sigCanvasRef.current || sigCanvasRef.current.isEmpty()) return;
    const dataUrl = sigCanvasRef.current.toDataURL("image/png");
    setSignatureUploading(true);
    try {
      const blob = await fetch(dataUrl).then((r) => r.blob());
      const file = new File([blob], "tuition-signature.png", { type: "image/png" });
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      if (res.ok) {
        const meta = await res.json();
        setSignatureMeta(meta);
      }
    } catch (err) {
      console.error("Signature upload failed:", err);
    } finally {
      setSignatureUploading(false);
    }
  }

  function clearSignature() {
    sigCanvasRef.current?.clear();
    setSignatureMeta(null);
  }

  async function handleSubmitReview() {
    if (!signatureMeta) {
      toast.error("Please sign above to confirm your review.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/family-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          registration_school_years_id: yearId,
          tuition_reviewed_by: user?.fullName ?? "Parent/Guardian",
        }),
      });
      if (!res.ok) throw new Error("Failed to submit");
      await mutatePayment();
      toast.success("Tuition review submitted successfully.");
      router.push(`/apply/year/${yearId}`);
    } catch {
      toast.error("Failed to submit tuition review. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-1 flex-col gap-6 p-6 mx-auto w-full max-w-4xl">
        <div className="text-center xl:text-left">
          <Skeleton className="h-7 w-80 mb-2" />
          <Skeleton className="h-4 w-96" />
        </div>
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-6 mx-auto w-full max-w-4xl">
      <div className="text-center xl:text-left">
        <h1 className="text-2xl font-semibold">Tuition & Scholarship Breakdown</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Review your financial aid award and tuition payment details for the upcoming school year.
        </p>
      </div>

      {studentApps.length === 0 ? (
        <div className="rounded-lg border bg-white px-6 py-12 text-center">
          <p className="text-muted-foreground text-sm">No students found for this school year.</p>
        </div>
      ) : (
        <div className="space-y-8">
          {studentApps.map((sa, idx) => (
            <div key={idx}>
              <h3 className="text-lg font-semibold mb-3">{sa.studentName}</h3>

              {/* Award Summary */}
              <div className="rounded-lg border bg-white overflow-hidden mb-4">
                <table className="w-full text-sm">
                  <tbody className="divide-y">
                    <tr>
                      <td className="px-4 py-3 text-muted-foreground">Annual Tuition Cost</td>
                      <td className="px-4 py-3 text-right font-medium">${sa.tuition.toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-3 text-muted-foreground">Step Up for Students Award Status</td>
                      <td className="px-4 py-3 text-right">
                        <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">{sa.stepUpStatus}</span>
                      </td>
                    </tr>
                    <tr>
                      <td className="px-4 py-3 text-muted-foreground">Step Up for Students Award Amount</td>
                      <td className="px-4 py-3 text-right font-medium text-green-600">${sa.stepUpAmount.toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-3 text-muted-foreground">SailFuture Opportunity Scholarship Award Amount</td>
                      <td className="px-4 py-3 text-right font-medium text-green-600">${sa.scholarshipAmount.toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
                    </tr>
                    <tr className="bg-muted/30">
                      <td className="px-4 py-3 font-medium">Remaining Tuition Payment</td>
                      <td className="px-4 py-3 text-right font-semibold">${sa.remaining.toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Fees */}
              <div className="rounded-lg border bg-white overflow-hidden mb-4">
                <table className="w-full text-sm">
                  <tbody className="divide-y">
                    <tr>
                      <td className="px-4 py-3 text-muted-foreground">Annual Administrative Fees *</td>
                      <td className="px-4 py-3 text-right font-medium">${sa.adminFees.toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-3 text-muted-foreground">Transportation Fees * <span className="text-xs">(Only applicable to students who utilize bus transportation)</span></td>
                      <td className="px-4 py-3 text-right font-medium">${sa.transportFees.toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Payment Options */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <h4 className="text-sm font-semibold mb-2">With Transportation <span className="text-xs font-normal text-muted-foreground">(SNAP Pre-Approved)</span></h4>
                  <div className="rounded-lg border bg-white overflow-hidden">
                    <table className="w-full text-sm">
                      <tbody className="divide-y">
                        <tr>
                          <td className="px-4 py-3 text-muted-foreground">Monthly (Aug&ndash;Jul)</td>
                          <td className="px-4 py-3 text-right font-medium">$181.82</td>
                        </tr>
                        <tr>
                          <td className="px-4 py-3 text-muted-foreground">Annual (5% Discount)</td>
                          <td className="px-4 py-3 text-right font-medium">$1,900.00</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                <div>
                  <h4 className="text-sm font-semibold mb-2">Without Transportation <span className="text-xs font-normal text-muted-foreground">(SNAP Pre-Approved)</span></h4>
                  <div className="rounded-lg border bg-white overflow-hidden">
                    <table className="w-full text-sm">
                      <tbody className="divide-y">
                        <tr>
                          <td className="px-4 py-3 text-muted-foreground">Monthly (Aug&ndash;Jul)</td>
                          <td className="px-4 py-3 text-right font-medium">$45.45</td>
                        </tr>
                        <tr>
                          <td className="px-4 py-3 text-muted-foreground">Annual (5% Discount)</td>
                          <td className="px-4 py-3 text-right font-medium">$475.00</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          ))}

          {/* Acknowledgment & Signature */}
          <div className="rounded-xl border bg-white p-6 mt-4">
            {alreadyReviewed ? (
              <div className="flex items-center gap-3">
                <CheckCircle2 className="size-6 text-green-600 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Tuition review submitted
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Reviewed by {paymentRecord.tuition_reviewed_by} on{" "}
                    {new Date(paymentRecord.tuition_reviewed_at).toLocaleDateString("en-US", {
                      month: "long",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </p>
                </div>
              </div>
            ) : (
              <>
                <h3 className="text-sm font-semibold mb-1">Acknowledgment</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  By signing below, I acknowledge that I have reviewed the tuition and scholarship breakdown above and understand the financial obligations for the upcoming school year.
                </p>
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
                <Button
                  className="mt-4"
                  onClick={handleSubmitReview}
                  disabled={!signatureMeta || signatureUploading || submitting}
                >
                  {submitting ? "Submitting..." : "Confirm & Submit Review"}
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

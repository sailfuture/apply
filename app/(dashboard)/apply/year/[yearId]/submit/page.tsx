"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface SchoolYear {
  id: number;
  year_name: string;
}

interface Parent {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  address_line_1: string;
  city: string;
  state: string;
  zipcode: string;
}

interface Student {
  id: number;
  first_name: string;
  last_name: string;
}

interface Application {
  id: number;
  registration_students_id: number;
  registration_school_years_id: number;
  current_previous_school: string;
  last_grade_completed: string;
  current_grade: string;
  describe_student_strengths: string;
  describe_student_opportunities_for_growth: string;
  nwea_testing_complete: boolean;
  test_scores: Record<string, unknown> | null;
  liability_waiver_pandadoc_id: string | null;
  liability_waiver_status: string | null;
  enrollment_agreement_pandadoc_id: string | null;
  enrollment_agreement_status: string | null;
  liability_waiver_pdf_url: string | null;
  enrollment_agreement_pdf_url: string | null;
}

type StepStatus = "complete" | "in_progress" | "not_started";

interface Step {
  number: number;
  title: string;
  description: string;
  status: StepStatus;
  detail: string;
  href?: string;
  signingType?: "liability_waiver" | "enrollment_agreement";
}

function StepNumber({ number, status }: { number: number; status: StepStatus }) {
  if (status === "complete") {
    return (
      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
        <svg className="size-4 text-green-600 dark:text-green-400" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
        </svg>
      </div>
    );
  }
  const bg =
    status === "in_progress"
      ? "bg-primary text-primary-foreground"
      : "bg-muted text-muted-foreground";
  return (
    <div
      className={`flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${bg}`}
    >
      {number}
    </div>
  );
}

function isDeadlinePassed(deadline: string | null): boolean {
  if (!deadline) return false;
  return new Date() > new Date(deadline + "T23:59:59");
}

export default function SubmitPage() {
  const params = useParams();
  const router = useRouter();
  const yearId = Number(params.yearId);

  const [yearName, setYearName] = useState("");
  const [schoolYear, setSchoolYear] = useState<SchoolYear & { scholarship_deadline?: string | null } | null>(null);
  const [parents, setParents] = useState<Parent[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [scholarshipExists, setScholarshipExists] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [familyId, setFamilyId] = useState<number | null>(null);

  const [signingLoading, setSigningLoading] = useState<string | null>(null);
  const [resetConfirm, setResetConfirm] = useState<"liability_waiver" | "enrollment_agreement" | null>(null);
  const [resetting, setResetting] = useState(false);
  const [signingSession, setSigningSession] = useState<{
    sessionId: string;
    documentId: string;
    type: "liability_waiver" | "enrollment_agreement";
    applicationId: number;
  } | null>(null);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const signingInstanceRef = useRef<{ destroy: () => void } | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [familyRes, yearsRes, studentsRes, appsRes] = await Promise.all([
        fetch("/api/families"),
        fetch("/api/school-years"),
        fetch("/api/students"),
        fetch("/api/applications"),
      ]);

      let fId: number | null = null;
      if (familyRes.ok) {
        const fam = await familyRes.json();
        setParents(fam.parents ?? []);
        fId = fam.id ?? null;
        setFamilyId(fId);
      }

      if (yearsRes.ok) {
        const years = await yearsRes.json();
        const found = years.find((y: SchoolYear) => y.id === yearId);
        if (found) {
          setYearName(found.year_name);
          setSchoolYear(found);
        }
      }

      if (studentsRes.ok) {
        setStudents(await studentsRes.json());
      }

      if (appsRes.ok) {
        const allApps: Application[] = await appsRes.json();
        const yearApps = allApps.filter((a) => a.registration_school_years_id === yearId);
        setApplications(yearApps);
      }

      if (fId) {
        const scholarshipRes = await fetch(`/api/scholarship?familyId=${fId}&yearId=${yearId}`);
        if (scholarshipRes.ok) {
          const data = await scholarshipRes.json();
          if (data && data.id) setScholarshipExists(true);
        }
      }
    } catch (err) {
      console.error("Failed to fetch:", err);
    } finally {
      setLoading(false);
    }
  }, [yearId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

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

      const signing = new Signing(
        "pandadoc-signing-embed",
        { debugMode: true },
      );

      signing
        .on("document.loaded", () => {
          console.log("PandaDoc: document loaded");
        })
        .on("document.completed", () => {
          fetchData();
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
  }, [signingSession, fetchData]);

  function getDocField(type: "liability_waiver" | "enrollment_agreement") {
    if (applications.length === 0) return { pandadocId: null, status: null, pdfUrl: null };
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
    const docId = type === "liability_waiver"
      ? app.liability_waiver_pandadoc_id
      : app.enrollment_agreement_pandadoc_id;
    if (!docId) return;
    window.open(`/api/pandadoc/download?documentId=${docId}&applicationId=${app.id}`, "_blank");
  }

  async function handleSign(type: "liability_waiver" | "enrollment_agreement") {
    if (applications.length === 0) return;
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
        console.error("Signing error:", body?.error ?? res.statusText);
        return;
      }

      const { documentId, sessionId } = await res.json();
      setSigningSession({ sessionId, documentId, type, applicationId: app.id });
      startPolling(documentId, type, app.id);
    } catch (err) {
      console.error("Failed to initiate signing:", err);
    } finally {
      setSigningLoading(null);
    }
  }

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
        console.error("Reset failed");
        return;
      }

      await fetchData();
    } catch (err) {
      console.error("Failed to reset document:", err);
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
    if (pollingRef.current) clearInterval(pollingRef.current);

    pollingRef.current = setInterval(async () => {
      try {
        const res = await fetch(
          `/api/pandadoc/status?documentId=${documentId}&applicationId=${applicationId}&type=${type}`
        );
        if (!res.ok) return;
        const data = await res.json();

        if (data.status === "completed" || data.status === "viewed") {
          await fetchData();
          if (data.status === "completed" && pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
          }
        }
      } catch {
        // polling errors are non-critical
      }
    }, 5000);
  }

  const enrolled = applications
    .map((app) => ({
      app,
      student: students.find((s) => s.id === app.registration_students_id),
    }))
    .filter((x): x is { app: Application; student: Student } => !!x.student);

  function parentComplete(p: Parent): boolean {
    return !!(p.phone && p.address_line_1 && p.city && p.state && p.zipcode);
  }

  function appComplete(app: Application): boolean {
    return !!(
      app.current_previous_school &&
      app.last_grade_completed &&
      app.current_grade &&
      app.describe_student_strengths &&
      app.describe_student_opportunities_for_growth
    );
  }

  function getStatus(complete: boolean, started: boolean): StepStatus {
    if (complete) return "complete";
    if (started) return "in_progress";
    return "not_started";
  }

  const allParentsComplete = parents.length > 0 && parents.every(parentComplete);
  const parentStarted = parents.length > 0;

  const studentsWithApps = enrolled;
  const studentsEnrolled = studentsWithApps.length;
  const studentsComplete = studentsEnrolled > 0;
  const studentsStarted = students.length > 0;
  const allStudentsDetailComplete = studentsComplete && studentsWithApps.every(({ app }) => appComplete(app));

  const allHaveNwea =
    studentsEnrolled > 0 &&
    studentsWithApps.every(({ app }) => app.nwea_testing_complete || app.test_scores !== null);
  const someHaveNwea = studentsWithApps.some(({ app }) => app.nwea_testing_complete || app.test_scores !== null);
  const studentsDetailComplete = studentsComplete && allHaveNwea;
  const studentsDetailStarted = studentsStarted || someHaveNwea;

  const scholarshipDeadlinePassed = isDeadlinePassed((schoolYear as Record<string, string | null> | null)?.scholarship_deadline ?? null);

  const liabilityDoc = getDocField("liability_waiver");
  const enrollmentDoc = getDocField("enrollment_agreement");
  const liabilityComplete = liabilityDoc.status === "completed";
  const liabilitySent = !!liabilityDoc.pandadocId;
  const enrollmentComplete = enrollmentDoc.status === "completed";
  const enrollmentSent = !!enrollmentDoc.pandadocId;

  const steps: Step[] = [
    {
      number: 1,
      title: "Family",
      description: "Contact information, addresses, and parents",
      status: getStatus(allParentsComplete, parentStarted),
      detail: allParentsComplete
        ? "Complete"
        : parentStarted
          ? "Address or contact missing"
          : "Not started",
      href: `/apply/year/${yearId}/family`,
    },
    {
      number: 2,
      title: "Students",
      description: "Enroll students, transportation, scholarships, and NWEA testing",
      status: getStatus(studentsDetailComplete, studentsDetailStarted),
      detail: studentsDetailComplete
        ? `${studentsEnrolled} student${studentsEnrolled !== 1 ? "s" : ""} — complete`
        : studentsComplete
          ? `${studentsEnrolled} enrolled — details pending`
          : studentsStarted
            ? `${students.length} student${students.length !== 1 ? "s" : ""} available`
            : "No students added",
      href: `/apply/year/${yearId}/students`,
    },
    {
      number: 3,
      title: "Financial Aid",
      description: "Opportunity scholarship and financial aid documents",
      status: getStatus(scholarshipExists, false),
      detail: scholarshipExists
        ? "Submitted"
        : scholarshipDeadlinePassed
          ? "Deadline passed"
          : "Not started",
      href: `/apply/year/${yearId}/scholarship`,
    },
    {
      number: 4,
      title: "Liability Waiver",
      description: "Review and sign the liability waiver",
      status: getStatus(liabilityComplete, liabilitySent),
      detail: liabilityComplete
        ? "Signed"
        : liabilitySent
          ? "Awaiting signature"
          : "Not started",
      signingType: "liability_waiver",
    },
    {
      number: 5,
      title: "Enrollment Agreement",
      description: "Review and sign the enrollment agreement",
      status: getStatus(enrollmentComplete, enrollmentSent),
      detail: enrollmentComplete
        ? "Signed"
        : enrollmentSent
          ? "Awaiting signature"
          : "Not started",
      signingType: "enrollment_agreement",
    },
  ];

  const allComplete = allParentsComplete && allStudentsDetailComplete && scholarshipExists && liabilityComplete && enrollmentComplete;

  async function handleSubmit() {
    setSubmitting(true);
    try {
      const statusRes = await fetch("/api/application-statuses");
      if (!statusRes.ok) throw new Error("Failed to fetch statuses");
      const statuses: { id: number; status_name: string }[] = await statusRes.json();
      const submittedStatus = statuses.find(
        (s) => s.status_name.toLowerCase() === "submitted"
      );
      if (!submittedStatus) throw new Error("Submitted status not found");

      await Promise.all(
        applications.map((app) =>
          fetch(`/api/applications/${app.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              registration_application_status_id: submittedStatus.id,
            }),
          })
        )
      );

      setSubmitted(true);
    } catch (err) {
      console.error("Failed to submit:", err);
    } finally {
      setSubmitting(false);
      setConfirmOpen(false);
    }
  }

  if (loading) {
    return (
      <>
        <PageHeader yearName="" />
        <div className="flex min-h-[60vh] items-center justify-center">
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </>
    );
  }

  if (submitted) {
    return (
      <>
        <PageHeader yearName={yearName} />
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-4 pt-0 text-center min-h-[60vh]">
          <div className="flex size-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
            <svg className="size-8 text-green-600 dark:text-green-400" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold">Application Submitted!</h1>
          <p className="text-muted-foreground text-sm max-w-md">
            Thank you for submitting your application for {yearName}. You will be notified once an acceptance determination has been made.
          </p>
          <p className="text-muted-foreground text-sm max-w-md">
            If you have any questions, please contact us at{" "}
            <a href="mailto:tward@sailfuture.org" className="text-primary underline underline-offset-2">tward@sailfuture.org</a>{" "}
            or call{" "}
            <a href="tel:+17279001436" className="text-primary underline underline-offset-2">(727) 900-1436</a>.
          </p>
          <Button
            className="mt-4"
            onClick={() => router.push(`/apply/year/${yearId}`)}
          >
            Return to Overview
          </Button>
        </div>
      </>
    );
  }

  return (
    <>
      {signingLoading && (
        <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-background/80 backdrop-blur-sm">
          <svg
            className="size-10 animate-spin text-primary mb-4"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <p className="text-lg font-medium">Preparing Document</p>
          <p className="text-sm text-muted-foreground mt-1">This may take a few moments...</p>
        </div>
      )}
      <PageHeader yearName={yearName} />
      <div className="flex flex-1 flex-col gap-6 p-4 pt-0">
        <div>
          <h1 className="text-2xl font-semibold">Submit Application</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Review the checklist below to ensure all sections are complete before submitting your application for {yearName}.
          </p>
        </div>

        {/* Application Checklist Table */}
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground w-10">#</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Section</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {steps.map((step) => {
                const isSigning = step.signingType ? signingLoading === step.signingType : false;
                const isSigned = step.signingType && step.status === "complete";
                const isSent = step.signingType && step.status === "in_progress";

                return (
                  <tr key={step.number} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3">
                      <StepNumber number={step.number} status={step.status} />
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium">{step.title}</p>
                      <p className="text-muted-foreground text-xs mt-0.5">{step.description}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          step.status === "complete"
                            ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                            : step.status === "in_progress"
                              ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                              : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                        }`}
                      >
                        {step.detail}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {step.signingType ? (
                        <div className="flex items-center justify-end gap-2">
                          {isSigned ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => viewDocument(step.signingType!)}
                            >
                              View Document
                            </Button>
                          ) : (
                            <>
                              {isSent && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  disabled={isSigning}
                                  onClick={() => setResetConfirm(step.signingType!)}
                                >
                                  Start Over
                                </Button>
                              )}
                              <Button
                                size="sm"
                                disabled={isSigning || applications.length === 0}
                                onClick={() => handleSign(step.signingType!)}
                              >
                                {isSent ? "Resume Signing" : "Sign Document"}
                              </Button>
                            </>
                          )}
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => step.href && router.push(step.href)}
                        >
                          {step.status === "complete" ? "Review" : "Continue"}
                          <svg className="size-4 ml-1" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
                          </svg>
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {!allComplete && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-950/30">
            <p className="text-sm text-amber-800 dark:text-amber-300">
              Please complete all sections before submitting your application. Return to the{" "}
              <button
                type="button"
                className="underline underline-offset-2 font-medium"
                onClick={() => router.push(`/apply/year/${yearId}`)}
              >
                overview
              </button>{" "}
              to finish any remaining steps.
            </p>
          </div>
        )}

        <Button
          size="lg"
          className="w-full py-6 text-base font-semibold"
          disabled={!allComplete || submitting}
          onClick={() => setConfirmOpen(true)}
        >
          {submitting ? "Submitting..." : "Submit Application"}
        </Button>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Submit Application?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to submit your application for {yearName}? You will still be able to view your application after submission.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleSubmit} disabled={submitting}>
              {submitting ? "Submitting..." : "Yes, Submit"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!signingSession} onOpenChange={(open) => { if (!open) handleSigningClose(); }}>
        <DialogContent className="sm:max-w-[95vw] w-[95vw] h-[90vh] p-0 flex flex-col overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-2 shrink-0">
            <DialogTitle>
              {signingSession?.type === "liability_waiver"
                ? "Sign Liability Waiver"
                : "Sign Enrollment Agreement"}
            </DialogTitle>
            <DialogDescription>
              Review and sign the document below.
            </DialogDescription>
          </DialogHeader>
          {/* eslint-disable-next-line react/no-unknown-property */}
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
            className="flex-1 m-6 mt-0"
          />
        </DialogContent>
      </Dialog>

      <Dialog open={!!resetConfirm} onOpenChange={(open) => { if (!open) setResetConfirm(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Start Over?</DialogTitle>
            <DialogDescription>
              This will discard the current{" "}
              {resetConfirm === "liability_waiver"
                ? "liability waiver"
                : "enrollment agreement"}{" "}
              and create a new document from scratch. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setResetConfirm(null)}
              disabled={resetting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleResetConfirmed}
              disabled={resetting}
            >
              {resetting ? "Resetting..." : "Yes, Start Over"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function PageHeader({ yearName }: { yearName: string }) {
  return (
    <header className="flex h-16 shrink-0 items-center gap-2">
      <div className="flex items-center gap-2 px-4">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mr-2 data-vertical:h-4 data-vertical:self-auto"
        />
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem className="hidden md:block">
              <BreadcrumbLink href="/">Overview</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator className="hidden md:block" />
            <BreadcrumbItem>
              <BreadcrumbPage>Submit Application</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </div>
    </header>
  );
}

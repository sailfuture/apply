"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
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
import { Button } from "@/components/ui/button";
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
  start_date: string | null;
  end_date: string | null;
  tuition: number;
  annual_fees: number;
  transportation_fees: number;
  fes_eo_9: number;
  fes_eo_8: number;
  ftc_8: number;
  ftc_9: number;
  fes_ua_8_ese_1_3: number;
  fes_ua_9_ese_1_3: number;
  fes_ua_ese_4: number;
  fes_ua_ese_5: number;
  opportunity_scholarship_award: number;
  isActive: boolean;
  isPast: boolean;
  isNextYear: boolean;
  isFuture: boolean;
  application_deadline: string | null;
  scholarship_deadline: string | null;
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

interface Application {
  id: number;
  registration_students_id: number;
  registration_families_id: number;
  registration_application_status_id: number;
  registration_school_years_id: number;
  is_bus_transportation: boolean;
  bus_stop: string;
  nwea_testing_complete: boolean;
  test_scores: Record<string, unknown> | null;
  liability_waiver_pandadoc_id: string | null;
  liability_waiver_status: string | null;
  liability_waiver_sent_at: string | null;
  enrollment_agreement_pandadoc_id: string | null;
  enrollment_agreement_status: string | null;
  enrollment_agreement_sent_at: string | null;
  liability_waiver_pdf_url: string | null;
  enrollment_agreement_pdf_url: string | null;
}

interface Student {
  id: number;
  first_name: string;
  last_name: string;
  date_of_birth: string;
  gender: string;
  ethnicity: string;
}



function formatDate(date: string | null): string {
  if (!date) return "TBD";
  return new Date(date + "T00:00:00").toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function isDeadlinePassed(deadline: string | null): boolean {
  if (!deadline) return false;
  return new Date() > new Date(deadline + "T23:59:59");
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

export default function YearDetailPage() {
  const params = useParams();
  const router = useRouter();
  const yearId = Number(params.yearId);

  const [schoolYear, setSchoolYear] = useState<SchoolYear | null>(null);
  const [parents, setParents] = useState<Parent[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [scholarshipExists, setScholarshipExists] = useState(false);
  const [loading, setLoading] = useState(true);
  const [familyId, setFamilyId] = useState<number | null>(null);
  const [isAccepted, setIsAccepted] = useState(false);

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

  const fetchData = useCallback(async () => {
    try {
      const familyRes = await fetch("/api/families");
      let fId: number | null = null;
      let fetchedParents: Parent[] = [];
      if (familyRes.ok) {
        const fam = await familyRes.json();
        if (fam?.id) {
          fId = fam.id;
          setFamilyId(fId);
          setIsAccepted(fam.isAccepted ?? false);
          fetchedParents = fam.parents ?? [];
          setParents(fetchedParents);
        }
      }

      const fetches: Promise<Response>[] = [
        fetch("/api/school-years"),
        fetch("/api/students"),
        fetch("/api/applications"),
      ];
      if (fId) {
        fetches.push(
          fetch(`/api/scholarship?familyId=${fId}&yearId=${yearId}`)
        );
      }

      const [yearsRes, studentsRes, appsRes, scholarshipRes] =
        await Promise.all(fetches);

      if (yearsRes.ok) {
        const years: SchoolYear[] = await yearsRes.json();
        const found = years.find((y) => y.id === yearId);
        if (found) setSchoolYear(found);
      }

      if (studentsRes.ok) setStudents(await studentsRes.json());

      if (appsRes.ok) {
        const allApps: Application[] = await appsRes.json();
        setApplications(
          allApps.filter((a) => a.registration_school_years_id === yearId)
        );
      }

      if (scholarshipRes?.ok) {
        const data = await scholarshipRes.json();
        if (data && data.id) setScholarshipExists(true);
      }
    } catch (err) {
      console.error("Failed to fetch data:", err);
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

  const signingInstanceRef = useRef<{ destroy: () => void } | null>(null);

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

  if (!schoolYear) {
    return (
      <>
        <PageHeader yearName="" />
        <div className="flex min-h-[60vh] items-center justify-center">
          <p className="text-muted-foreground">School year not found.</p>
        </div>
      </>
    );
  }

  const appDeadlinePassed = isDeadlinePassed(schoolYear.application_deadline);
  const scholarshipDeadlinePassed = isDeadlinePassed(schoolYear.scholarship_deadline);

  const studentsWithApps = applications
    .map((app) => ({
      app,
      student: students.find((s) => s.id === app.registration_students_id),
    }))
    .filter(
      (item): item is { app: Application; student: Student } => !!item.student
    );

  // -- Derive step completion --

  const parentComplete = parents.some(
    (p) => p.address_line_1 && p.phone && p.email
  );
  const parentStarted = parents.length > 0;

  const studentsEnrolled = studentsWithApps.length;
  const studentsTotal = students.length;
  const studentsComplete = studentsEnrolled > 0;
  const studentsStarted = studentsTotal > 0;

  const scholarshipComplete = scholarshipExists;

  

  const allHaveNwea =
    studentsEnrolled > 0 &&
    studentsWithApps.every(
      ({ app }) => app.nwea_testing_complete || app.test_scores !== null
    );
  const someHaveNwea = studentsWithApps.some(
    ({ app }) => app.nwea_testing_complete || app.test_scores !== null
  );

  function getStatus(complete: boolean, started: boolean): StepStatus {
    if (complete) return "complete";
    if (started) return "in_progress";
    return "not_started";
  }

  const studentsDetailComplete =
    studentsComplete && allHaveNwea;
  const studentsDetailStarted =
    studentsStarted || someHaveNwea;

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
      status: getStatus(parentComplete, parentStarted),
      detail: parentComplete
        ? "Complete"
        : parentStarted
          ? "Address or contact missing"
          : "Not started",
      href: `/apply/year/${yearId}/family`,
    },
    {
      number: 2,
      title: "Students",
      description:
        "Enroll students, transportation, scholarships, and NWEA testing",
      status: getStatus(studentsDetailComplete, studentsDetailStarted),
      detail: studentsDetailComplete
        ? `${studentsEnrolled} student${studentsEnrolled !== 1 ? "s" : ""} — complete`
        : studentsComplete
          ? `${studentsEnrolled} enrolled — details pending`
          : studentsStarted
            ? `${studentsTotal} student${studentsTotal !== 1 ? "s" : ""} available`
            : "No students added",
      href: `/apply/year/${yearId}/students`,
    },
    {
      number: 3,
      title: "Scholarships",
      description: "Complete the family opportunity scholarship application",
      status: getStatus(scholarshipComplete, false),
      detail: scholarshipComplete
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
      <PageHeader yearName={schoolYear.year_name} />
      <div className="flex flex-1 flex-col gap-6 p-4 pt-0">
        {/* Year Overview */}
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold">
              {schoolYear.year_name}
            </h1>
            <YearBadge year={schoolYear} />
          </div>
          <p className="text-muted-foreground text-sm">
            {formatDate(schoolYear.start_date)} &mdash;{" "}
            {formatDate(schoolYear.end_date)}
          </p>
        </div>

        {/* Status Banner */}
        {!isAccepted && (
          <Card className="border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 gap-0 py-0">
            <CardContent className="py-4 flex items-start gap-3">
              <svg
                className="size-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z"
                  clipRule="evenodd"
                />
              </svg>
              <div>
                <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                  Pending Acceptance
                </p>
                <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                  Complete and submit your application below. You will be notified once an acceptance determination has been made.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {isAccepted && (
          <Card className="border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/30 gap-0 py-0">
            <CardContent className="py-4 flex items-start gap-3">
              <svg
                className="size-5 text-green-600 dark:text-green-400 shrink-0 mt-0.5"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
                  clipRule="evenodd"
                />
              </svg>
              <div>
                <p className="text-sm font-medium text-green-800 dark:text-green-300">
                  Accepted
                </p>
                <p className="text-xs text-green-700 dark:text-green-400 mt-0.5">
                  Congratulations! Your family has been accepted for {schoolYear.year_name}. Review your application details below.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Application Checklist */}
        <div>
          <h2 className="text-lg font-semibold mb-1">
            {isAccepted ? "Application Details" : "Application Checklist"}
          </h2>
          <p className="text-muted-foreground text-sm mb-4">
            {isAccepted
              ? `Review your completed application for ${schoolYear.year_name}.`
              : `Complete each step to finish your application for ${schoolYear.year_name}.`}
          </p>
          <div className="grid gap-3">
            {steps.map((step) => {
              if (step.signingType) {
                const isSigning = signingLoading === step.signingType;
                const isSigned = step.status === "complete";
                const isSent = step.status === "in_progress";

                return (
                  <div
                    key={step.number}
                    className="flex w-full items-center gap-4 rounded-md border px-4 py-4"
                  >
                    <StepNumber number={step.number} status={step.status} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{step.title}</p>
                      <p className="text-muted-foreground text-xs mt-0.5 truncate">
                        {step.description}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span
                        className={`text-xs font-medium ${
                          step.status === "complete"
                            ? "text-green-600 dark:text-green-400"
                            : step.status === "in_progress"
                              ? "text-amber-600 dark:text-amber-400"
                              : "text-muted-foreground"
                        }`}
                      >
                        {step.detail}
                      </span>
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
                            {isSent
                              ? "Resume Signing"
                              : "Sign Document"}
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                );
              }

              return (
                <Button
                  key={step.number}
                  variant="outline"
                  className="h-auto w-full justify-start gap-4 px-4 py-4 text-left"
                  onClick={() => step.href && router.push(step.href)}
                >
                  <StepNumber number={step.number} status={step.status} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{step.title}</p>
                    <p className="text-muted-foreground text-xs mt-0.5 font-normal truncate">
                      {step.description}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span
                      className={`text-xs font-medium ${
                        step.status === "complete"
                          ? "text-green-600 dark:text-green-400"
                          : step.status === "in_progress"
                            ? "text-blue-600 dark:text-blue-400"
                            : "text-muted-foreground"
                      }`}
                    >
                      {step.detail}
                    </span>
                    <svg
                      className="size-4 text-muted-foreground"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path
                        fillRule="evenodd"
                        d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </div>
                </Button>
              );
            })}
          </div>
        </div>

        {/* Deadlines */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardContent className="pt-6">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">
                Application Deadline
              </p>
              <p
                className={`text-sm font-medium mt-1 ${appDeadlinePassed ? "text-red-600 dark:text-red-400" : ""}`}
              >
                {schoolYear.application_deadline
                  ? formatDate(schoolYear.application_deadline)
                  : "No deadline"}
                {appDeadlinePassed && (
                  <span className="ml-1.5 text-[10px] font-normal uppercase">
                    Closed
                  </span>
                )}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">
                Scholarship Deadline
              </p>
              <p
                className={`text-sm font-medium mt-1 ${scholarshipDeadlinePassed ? "text-red-600 dark:text-red-400" : ""}`}
              >
                {schoolYear.scholarship_deadline
                  ? formatDate(schoolYear.scholarship_deadline)
                  : "No deadline"}
                {scholarshipDeadlinePassed && (
                  <span className="ml-1.5 text-[10px] font-normal uppercase">
                    Closed
                  </span>
                )}
              </p>
            </CardContent>
          </Card>
        </div>

      </div>

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


function YearBadge({ year }: { year: SchoolYear }) {
  let label = "";
  let className = "";
  if (year.isActive) {
    label = "Active";
    className = "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400";
  } else if (year.isNextYear) {
    label = "Next Year";
    className = "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400";
  } else if (year.isPast) {
    label = "Past";
    className = "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400";
  } else {
    return null;
  }
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${className}`}>
      {label}
    </span>
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
              <BreadcrumbLink href="/">Dashboard</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator className="hidden md:block" />
            <BreadcrumbItem className="hidden md:block">
              <BreadcrumbLink href="/apply">Applications</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator className="hidden md:block" />
            <BreadcrumbItem>
              <BreadcrumbPage>{yearName || "School Year"}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </div>
    </header>
  );
}

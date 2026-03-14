"use client";

import { useState, useMemo, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useApplicationFlow } from "@/contexts/application-flow-context";
import { useFamily, useSchoolYears, useStudents, useApplications, useScholarship } from "@/hooks/use-api";
import { mutate } from "swr";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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
  href: string;
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

  const { setPageTitle } = useApplicationFlow();

  useEffect(() => {
    setPageTitle("Submit Application");
  }, [setPageTitle]);

  const { data: familyData } = useFamily();
  const { data: yearsData } = useSchoolYears();
  const { data: studentsData } = useStudents();
  const { data: appsData } = useApplications();

  const familyId = familyData?.id ?? null;
  const parents: Parent[] = familyData?.parents ?? [];
  const students: Student[] = studentsData ?? [];

  const schoolYear = useMemo(() => {
    if (!yearsData) return null;
    return (yearsData as (SchoolYear & { opportunity_scholarship_deadline?: string | null })[]).find(
      (y) => y.id === yearId
    ) ?? null;
  }, [yearsData, yearId]);

  const yearName = schoolYear?.year_name ?? "";

  const applications: Application[] = useMemo(() => {
    if (!appsData) return [];
    return (appsData as Application[]).filter((a) => a.registration_school_years_id === yearId);
  }, [appsData, yearId]);

  const { data: scholarshipData } = useScholarship(familyId, yearId);
  const scholarshipExists = !!(scholarshipData && scholarshipData.id);

  const loading = !familyData || !yearsData || !studentsData || !appsData;

  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

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

  const scholarshipDeadlinePassed = isDeadlinePassed((schoolYear as Record<string, string | null> | null)?.opportunity_scholarship_deadline ?? null);

  const firstApp = applications[0] as Application | undefined;
  const liabilityComplete = firstApp?.liability_waiver_status === "completed";
  const liabilitySent = !!firstApp?.liability_waiver_pandadoc_id;
  const enrollmentComplete = firstApp?.enrollment_agreement_status === "completed";
  const enrollmentSent = !!firstApp?.enrollment_agreement_pandadoc_id;

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
      href: `/apply/year/${yearId}/waiver`,
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
      href: `/apply/year/${yearId}/agreement`,
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
              isSubmitted: true,
            }),
          })
        )
      );

      // Revalidate the applications cache so the overview page picks up isSubmitted
      await mutate("/api/applications");
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
      <div className="flex flex-1 flex-col gap-6 p-6 mx-auto w-full max-w-4xl">
        <div className="text-center">
          <Skeleton className="h-7 w-48 mx-auto" />
          <Skeleton className="h-4 w-64 mx-auto mt-2" />
        </div>
        <div className="overflow-hidden rounded-lg border">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center px-4 py-3 border-b last:border-b-0">
              <Skeleton className="size-5 rounded-full shrink-0" />
              <Skeleton className="h-4 w-36 ml-3 flex-1" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
          ))}
        </div>
        <Skeleton className="h-10 w-full rounded-md" />
      </div>
    );
  }

  if (submitted) {
    // Redirect to overview which now shows the "Under Review" stage
    router.push(`/apply/year/${yearId}`);
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center min-h-[60vh]">
        <div className="flex size-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
          <svg className="size-8 text-green-600 dark:text-green-400" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
          </svg>
        </div>
        <p className="text-muted-foreground text-sm">Redirecting...</p>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-1 flex-col gap-6 p-6 mx-auto w-full max-w-4xl">
        <div className="text-center">
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
              {steps.map((step) => (
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
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => router.push(step.href)}
                      >
                        {step.status === "complete" ? "Review" : "Continue"}
                        <svg className="size-4 ml-1" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
                        </svg>
                      </Button>
                    </td>
                  </tr>
                ))}
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
    </>
  );
}

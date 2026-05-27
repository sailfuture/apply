import { useMemo } from "react";
import useSWR from "swr";
import {
  useFamily,
  useSchoolYears,
  useApplications,
  useScholarship,
} from "@/hooks/use-api";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export type StepStatus = "complete" | "in_progress" | "not_started";

export interface StepDef {
  number: number;
  title: string;
  description: string;
  status: StepStatus;
  detail: string;
  href: string;
}

function getStatus(complete: boolean, started: boolean): StepStatus {
  if (complete) return "complete";
  if (started) return "in_progress";
  return "not_started";
}

export function useApplicationSteps(yearId: number) {
  const base = `/apply/year/${yearId}`;

  const { data: familyData } = useFamily();
  const { data: yearsData } = useSchoolYears();
  const { data: appsData } = useApplications();
  const familyId = familyData?.id ?? null;
  const { data: scholarshipData, isLoading: scholarshipLoading } = useScholarship(familyId, yearId);

  // Progress bridge rows — explicit "section completed" bools take priority
  // over the derived field checks below. When a user clicks "Complete X",
  // the corresponding bool flips and the sidenav turns green immediately.
  // Two bridge rows because the application and post-acceptance registration
  // stages are tracked in separate tables.
  const { data: progressData } = useSWR<{
    family_completed?: boolean;
    students_completed?: boolean;
    financial_aid_completed?: boolean;
    testing_completed?: boolean;
    /** Per-year submission + acceptance flags. Moved here from
     *  `registration_families` so they can be tracked per academic
     *  year rather than once-and-forever per family. */
    isSubmitted?: boolean;
    isAccepted?: boolean;
    /** Application type — `"New Application"` for new applicants,
     *  `"Re-Enrollment"` for returning families re-applying.
     *  Re-enrollers skip the Initial Testing (NWEA) step in the
     *  step-list + sidenav below; their scores carry forward from
     *  prior applications. */
    type?: "New Application" | "Re-Enrollment" | string;
  } | null>(
    yearId ? `/api/family-progress?yearId=${yearId}` : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 10000 }
  );
  const { data: regProgressData } = useSWR<{
    isTuition?: boolean;
    isEnrollment?: boolean;
    isRegistration?: boolean;
    isVolunteerHours?: boolean;
    submitted_date?: number | null;
    /** Whether the enrollment-agreement PandaDoc has been dispatched yet.
     *  Used as a "started" signal so the sidenav can show in-progress. */
    enrollment_agreement_pandadoc_id?: string | null;
  } | null>(
    yearId ? `/api/student-registration-progress?yearId=${yearId}` : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 10000 }
  );

  const loading = !familyData || !yearsData || !appsData;

  const schoolYear = useMemo(() => {
    if (!yearsData) return null;
    return (
      (yearsData as { id: number; year_name: string }[]).find(
        (y) => y.id === yearId
      ) ?? null
    );
  }, [yearsData, yearId]);

  const yearApps = useMemo(() => {
    if (!appsData) return [];
    return (
      appsData as { registration_school_years_id: number }[]
    ).filter((a) => a.registration_school_years_id === yearId);
  }, [appsData, yearId]);

  const familyStarted = (familyData?.parents ?? []).length > 0;

  const studentsStarted = yearApps.length > 0;

  // NWEA "started" — true once at least one yearApp is scheduled or has scores.
  // Drives the in-progress signal on the sidenav step. Admin flips
  // `testing_completed` on the progress row for the "complete" state.
  const nweaStarted = useMemo(() => {
    return yearApps.some((app) => {
      const a = app as Record<string, unknown>;
      return a.nwea_testing_scheduled === true || a.nwea_testing_complete === true || !!a.test_scores;
    });
  }, [yearApps]);

  // Side-nav avoids flashing grey-then-green by waiting for the
  // scholarship row to settle alongside the core fetches.
  const stepsLoading = loading || scholarshipLoading;

  const scholarshipStarted = !!(scholarshipData && scholarshipData.id);
  const financialAidStarted = scholarshipStarted || yearApps.some((app) => {
    const a = app as { sufs_award_id?: number };
    return typeof a.sufs_award_id === "number" && a.sufs_award_id > 0;
  });

  // A section is "done" only when the explicit bool on the
  // `registration_family_application_progress` row is true — the
  // bridge row is the source of truth, not field-presence inference.
  const familyDone = !!progressData?.family_completed;
  const studentsDone = !!progressData?.students_completed;
  const financialAidDone = !!progressData?.financial_aid_completed;
  const nweaDone = !!progressData?.testing_completed;
  // Re-enrollment families skip Initial Testing — their NWEA scores
  // carry forward from prior applications, so there's nothing for
  // them to do on that step. `begin-reapplication` stamps
  // `testing_completed: true` on the row so the section bool stays
  // coherent; the sidenav + step-list also drop the NWEA item
  // entirely for these families so they don't see a finished step
  // they never visited.
  const isReEnrollment = progressData?.type === "Re-Enrollment";

  const steps: StepDef[] = useMemo(
    () => {
      const allSteps: StepDef[] = [
        {
          number: 1,
          title: "Your Family Information",
          description: "",
          status: getStatus(familyDone, familyStarted),
          detail: familyDone
            ? "Complete"
            : familyStarted
              ? "In progress"
              : "Not started",
          href: `${base}/family`,
        },
        {
          number: 2,
          title: "Student Details",
          description: "",
          // Transportation lives inside this step now — per-student
          // bus toggles + stop pickers are rendered alongside the
          // strengths/growth fields on the students page.
          status: getStatus(studentsDone, studentsStarted),
          detail: studentsDone ? "Complete" : studentsStarted ? "In progress" : "Not started",
          href: `${base}/students`,
        },
        {
          number: 3,
          title: "Financial Aid",
          description: "",
          status: getStatus(financialAidDone, financialAidStarted),
          detail: financialAidDone
            ? "Complete"
            : financialAidStarted
              ? "In progress"
              : "Not started",
          href: `${base}/scholarship`,
        },
      ];
      if (!isReEnrollment) {
        allSteps.push({
          number: 4,
          title: "Initial Testing",
          description: "",
          status: getStatus(nweaDone, nweaStarted),
          detail: nweaDone ? "Complete" : nweaStarted ? "In progress" : "Not started",
          href: `${base}/nwea`,
        });
      }
      allSteps.push({
        // Renumber the submit step based on whether NWEA is present —
        // re-enrollment families see Submit as step 4 (since they
        // don't have step 4 = NWEA); new applicants see it as step 5.
        number: isReEnrollment ? 4 : 5,
        title: "Submit Application",
        description: "",
        // NWEA does NOT gate Submit — testing typically happens after
        // the application is submitted. For re-enrollment families the
        // gate is the same three sections (NWEA isn't on the list).
        status:
          familyDone && studentsDone && financialAidDone
            ? ("in_progress" as StepStatus)
            : ("not_started" as StepStatus),
        detail:
          familyDone && studentsDone && financialAidDone
            ? "Ready to submit"
            : "Locked",
        href: `#`,
      });
      return allSteps;
    },
    [
      base,
      familyDone,
      familyStarted,
      studentsDone,
      studentsStarted,
      financialAidDone,
      financialAidStarted,
      nweaDone,
      nweaStarted,
      isReEnrollment,
    ]
  );

  const completedCount = steps.filter((s) => s.status === "complete" && s.title !== "Submit Application").length;
  const allComplete = steps.filter((s) => s.title !== "Submit Application" && s.title !== "Initial Testing").every((s) => s.status === "complete");

  // Post-acceptance registration steps — driven exclusively by the section
  // bools on the `registration_student_registration_progress` bridge row,
  // No legacy fallbacks; the bool is the only signal that counts.
  const tuitionReviewed = regProgressData?.isTuition === true;
  const postEnrollmentSigned = regProgressData?.isEnrollment === true;
  const registrationComplete = regProgressData?.isRegistration === true;
  const volunteerAcknowledged = regProgressData?.isVolunteerHours === true;
  // Force the "started" flag on so `getStatus` returns `in_progress`
  // (amber edit pencil) rather than `not_started` (muted numbered
  // circle). The family can land on this step at any time without
  // any preceding gate clearing.
  const volunteerStarted = true;

  // Billing is no longer a parent-facing step — admin creates the
  // Stripe `send_invoice` subscription on Confirm Registration, and
  // the family receives invoice emails directly from Stripe. So the
  // "all sections complete" rollup drops the old payment-setup gate.
  const allRegistrationSectionsComplete =
    tuitionReviewed &&
    postEnrollmentSigned &&
    registrationComplete &&
    volunteerAcknowledged;

  const registrationSteps: StepDef[] = useMemo(
    () => [
      {
        number: 1,
        title: "Review Tuition & Scholarship Award",
        description: "Review your financial aid award and tuition details.",
        status: getStatus(tuitionReviewed, true),
        detail: tuitionReviewed ? "Reviewed" : "In progress",
        href: `${base}/tuition`,
      },
      {
        number: 2,
        title: "Sign Enrollment Agreement",
        description: "Review and sign the enrollment agreement for the upcoming year.",
        status: getStatus(postEnrollmentSigned, true),
        detail: postEnrollmentSigned ? "Signed" : "In progress",
        href: `${base}/enrollment-signing`,
      },
      {
        number: 3,
        title: "Begin Registration Process",
        description: "Complete the final registration steps to confirm your student\u2019s seat.",
        status: getStatus(registrationComplete, true),
        detail: registrationComplete ? "Complete" : "In progress",
        href: `${base}/registration`,
      },
      {
        number: 4,
        title: "Volunteer Hours Acknowledgment",
        description: "Acknowledge the mandatory volunteer-hours commitment for the year.",
        status: getStatus(volunteerAcknowledged, volunteerStarted),
        detail: volunteerAcknowledged ? "Acknowledged" : "In progress",
        href: `${base}/volunteer-hours`,
      },
      {
        number: 5,
        title: "Submit Registration",
        description: "Review and submit your completed registration.",
        status: allRegistrationSectionsComplete ? "in_progress" as StepStatus : "not_started" as StepStatus,
        detail: allRegistrationSectionsComplete ? "Ready to submit" : "Locked",
        href: `#`, // No page — triggers modal from overview
      },
    ],
    [
      base,
      tuitionReviewed,
      postEnrollmentSigned,
      registrationComplete,
      volunteerAcknowledged,
      volunteerStarted,
      allRegistrationSectionsComplete,
    ]
  );

  const registrationCompletedCount = registrationSteps.filter((s) => s.status === "complete").length;

  // Application stage flags. `isSubmitted` and `isAccepted` now live on
  // the per-year `family_application_progress` row (they used to be
  // family-level booleans, but acceptance is per-year-per-family). We
  // keep the per-app fallbacks so the stage advances if admin moved an
  // individual student forward before flipping the family-level flag.
  const familySubmitted = progressData?.isSubmitted === true;
  const familyAccepted = progressData?.isAccepted === true;
  const isSubmitted =
    familySubmitted ||
    yearApps.some((a) => (a as { isSubmitted?: boolean }).isSubmitted);
  const isOffered = yearApps.some((a) => (a as { isOffered?: boolean }).isOffered);
  const isAccepted =
    familyAccepted ||
    yearApps.some((a) => (a as { isAccepted?: boolean }).isAccepted);

  // Derive stage: "apply" | "review" | "accepted"
  const stage: "apply" | "review" | "accepted" =
    isAccepted
      ? "accepted"
      : isSubmitted
        ? "review"
        : "apply";

  return {
    steps,
    registrationSteps,
    registrationCompletedCount,
    allRegistrationSectionsComplete,
    completedCount,
    allComplete,
    loading,
    stepsLoading: !!stepsLoading,
    schoolYear,
    yearApps,
    stage,
    isSubmitted,
    isOffered,
    isAccepted,
  };
}

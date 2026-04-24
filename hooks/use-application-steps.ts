import { useMemo } from "react";
import useSWR from "swr";
import {
  useFamily,
  useSchoolYears,
  useApplications,
  useScholarship,
} from "@/hooks/use-api";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface FullScholarshipResponse {
  opportunity_scholarship: {
    id: number;
    household_adults: number;
    household_children: number;
    no_contributing_member: boolean;
    government_benefits: boolean;
    family_contribution_per_month: number;
    scholarship_advocacy_letter: string;
    isNotParticipating: boolean;
    isSNAPBenefits: boolean;
    isOpportunityScholarship: boolean;
    snap_benefits: Record<string, unknown>[];
  };
  contributing_members: {
    first_name: string;
    last_name: string;
    address_1: string;
    city: string;
    state: string;
    zipcode: string;
    estimated_annual_income: number;
  }[];
  homes: {
    type: string;
    address_1: string;
    city: string;
    state: string;
    zipcode: string;
    total_value: number;
    outstanding_debt: number;
  }[];
  vehicles: {
    type: string;
    car_make: string;
    car_model: string;
    car_year: string;
    total_value: number;
    remaining_debt: number;
  }[];
  benefits: {
    type: string;
    amount_monthly: number;
  }[];
}

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

  // Fetch payment record for tuition review status
  const { data: paymentRecord } = useSWR(
    familyId && yearId ? `/api/family-payment?yearId=${yearId}` : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 10000 }
  );

  // Progress bridge row — explicit "section completed" bools take priority
  // over the derived field checks below. When a user clicks "Complete X",
  // this flips and the sidenav turns green immediately.
  const { data: progressData } = useSWR<{
    family_completed?: boolean;
    students_completed?: boolean;
    financial_aid_completed?: boolean;
    testing_completed?: boolean;
  } | null>(
    yearId ? `/api/family-progress?yearId=${yearId}` : null,
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

  const familyComplete = useMemo(() => {
    const parents = familyData?.parents ?? [];
    if (parents.length === 0) return false;
    return parents.every(
      (p: {
        first_name: string;
        last_name: string;
        email: string;
        phone: string;
        relationship: string;
        address_line_1: string;
        city: string;
        state: string;
        zipcode: string;
      }) =>
        p.first_name &&
        p.last_name &&
        p.email &&
        p.phone &&
        p.relationship &&
        p.address_line_1 &&
        p.city &&
        p.state &&
        p.zipcode
    );
  }, [familyData]);

  const familyStarted = (familyData?.parents ?? []).length > 0;

  // Student Details completion — school-history fields only.
  // NWEA, SUFS, and Transportation live on other steps and don't gate this one.
  const studentsComplete = useMemo(() => {
    if (yearApps.length === 0) return false;
    return yearApps.every((app) => {
      const a = app as Record<string, unknown>;
      if (!a.current_previous_school) return false;
      if (!a.last_grade_completed) return false;
      if (!a.current_grade) return false;
      if (!a.describe_student_strengths) return false;
      if (!a.describe_student_opportunities_for_growth) return false;
      return true;
    });
  }, [yearApps]);

  const studentsStarted = yearApps.length > 0;

  // NWEA completion — admin-entered. Complete when every yearApp has
  // nwea_testing_complete flipped on (or has test scores as a legacy signal).
  // Started when at least one is scheduled or has scores. Doesn't block Submit.
  const nweaComplete = useMemo(() => {
    if (yearApps.length === 0) return false;
    return yearApps.every((app) => {
      const a = app as Record<string, unknown>;
      return a.nwea_testing_complete === true || !!a.test_scores;
    });
  }, [yearApps]);

  const nweaStarted = useMemo(() => {
    return yearApps.some((app) => {
      const a = app as Record<string, unknown>;
      return a.nwea_testing_scheduled === true || a.nwea_testing_complete === true || !!a.test_scores;
    });
  }, [yearApps]);

  // SUFS completion — every yearApp must have a sufs_award_id entered (parent's
  // 6-digit Step Up For Students Award ID). Admin-only sufs_type is separate.
  const sufsComplete = useMemo(() => {
    if (yearApps.length === 0) return false;
    return yearApps.every((app) => {
      const a = app as { sufs_award_id?: number };
      return typeof a.sufs_award_id === "number" && a.sufs_award_id > 0;
    });
  }, [yearApps]);

  // Fetch full scholarship data (including sub-entities) for proper completion checks
  const scholarshipId = scholarshipData?.id ?? null;
  const { data: fullScholarship } = useSWR<FullScholarshipResponse>(
    scholarshipId ? `/api/scholarship/${scholarshipId}` : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 10000 }
  );

  // Full loading state — includes all scholarship waterfall steps settling
  // Used by side nav to avoid showing grey circles that then flip to green
  const stepsLoading = loading || scholarshipLoading || (!!scholarshipId && !fullScholarship);

  const scholarshipComplete = useMemo(() => {
    if (!fullScholarship?.opportunity_scholarship) return false;
    const s = fullScholarship.opportunity_scholarship;

    // Opted out of financial aid — counts as complete
    if (s.isNotParticipating) return true;

    // SNAP benefits path — complete if at least one document uploaded
    if (s.isSNAPBenefits) return Array.isArray(s.snap_benefits) && s.snap_benefits.length > 0;

    // Full application path — must have chosen to participate
    if (!s.isOpportunityScholarship) return false;

    const members = fullScholarship.contributing_members ?? [];
    const homes = fullScholarship.homes ?? [];
    const vehicles = fullScholarship.vehicles ?? [];
    const benefits = fullScholarship.benefits ?? [];

    // Household Size: both inputs required
    const incomeComplete =
      s.household_adults > 0 &&
      s.household_children > 0 &&
      (!s.government_benefits || benefits.every((b) => b.type && b.amount_monthly > 0));

    // Contributing Members: all fields required (address_2 optional)
    const membersComplete =
      s.no_contributing_member ||
      (members.length > 0 &&
        members.every(
          (m) =>
            m.first_name &&
            m.last_name &&
            m.address_1 &&
            m.city &&
            m.state &&
            m.zipcode &&
            m.estimated_annual_income > 0
        ));

    // Home/Real Estate: all fields required per property (address_2 optional)
    // Vehicles: all fields required per vehicle
    const assetsComplete =
      (homes.length === 0 ||
        homes.every(
          (h) =>
            h.type &&
            h.address_1 &&
            h.city &&
            h.state &&
            h.zipcode &&
            h.total_value > 0 &&
            h.outstanding_debt >= 0
        )) &&
      (vehicles.length === 0 ||
        vehicles.every(
          (v) =>
            v.type &&
            v.car_make &&
            v.car_model &&
            v.car_year &&
            v.total_value > 0 &&
            v.remaining_debt >= 0
        ));

    // Family Contribution + Scholarship Advocacy Letter
    const contributionComplete =
      s.family_contribution_per_month > 0 &&
      (s.scholarship_advocacy_letter ?? "").trim().length > 0;

    return incomeComplete && membersComplete && assetsComplete && contributionComplete;
  }, [fullScholarship]);

  // Financial Aid (the sidenav step) combines SUFS selection + Opportunity Scholarship.
  const financialAidComplete = scholarshipComplete && sufsComplete;
  const scholarshipStarted = !!(scholarshipData && scholarshipData.id);
  const financialAidStarted = scholarshipStarted || yearApps.some((app) => {
    const a = app as { sufs_award_id?: number };
    return typeof a.sufs_award_id === "number" && a.sufs_award_id > 0;
  });

  const firstApp = yearApps[0] as
    | {
        liability_waiver_status?: string | null;
        enrollment_agreement_status?: string | null;
        liability_waiver_pandadoc_id?: string | null;
        enrollment_agreement_pandadoc_id?: string | null;
        isSubmitted?: boolean;
        isOffered?: boolean;
        isAccepted?: boolean;
      }
    | undefined;

  const liabilityComplete =
    firstApp?.liability_waiver_status === "completed";
  const liabilitySent = !!firstApp?.liability_waiver_pandadoc_id;
  const enrollmentComplete =
    firstApp?.enrollment_agreement_status === "completed";
  const enrollmentSent = !!firstApp?.enrollment_agreement_pandadoc_id;

  // Explicit "section completed" bools from the progress bridge row take
  // priority — clicking "Complete X Section" flips these and the sidenav
  // should reflect it immediately, independent of the derived field checks.
  const familyDone = !!progressData?.family_completed || familyComplete;
  const studentsDone = !!progressData?.students_completed || studentsComplete;
  const financialAidDone = !!progressData?.financial_aid_completed || financialAidComplete;
  const nweaDone = !!progressData?.testing_completed || nweaComplete;

  const steps: StepDef[] = useMemo(
    () => [
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
      {
        number: 4,
        title: "Initial Testing",
        description: "",
        status: getStatus(nweaDone, nweaStarted),
        detail: nweaDone ? "Complete" : nweaStarted ? "In progress" : "Not started",
        href: `${base}/nwea`,
      },
      {
        number: 5,
        title: "Submit Application",
        description: "",
        // NWEA does NOT gate Submit — testing typically happens after application is submitted.
        status: (familyDone && studentsDone && financialAidDone) ? "in_progress" as StepStatus : "not_started" as StepStatus,
        detail: (familyDone && studentsDone && financialAidDone) ? "Ready to submit" : "Locked",
        href: `#`,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    ]
  );

  const completedCount = steps.filter((s) => s.status === "complete" && s.title !== "Submit Application").length;
  const allComplete = steps.filter((s) => s.title !== "Submit Application" && s.title !== "Initial Testing").every((s) => s.status === "complete");

  // Post-acceptance registration steps
  const tuitionReviewed = paymentRecord?.tuition_reviewed === true || paymentRecord?.isFamilyAccepted === true;

  // Enrollment signing: check family payment record
  const postEnrollmentSigned = paymentRecord?.is_enrollment_agreement_signed === true || paymentRecord?.enrollment_agreement_status === "completed";
  const postEnrollmentStarted = !!paymentRecord?.enrollment_agreement_pandadoc_id;

  // Registration: in progress once the user has visited / started filling out the form
  // For now, mark as started if tuition is reviewed (prerequisite met)
  const registrationStarted = tuitionReviewed;
  const registrationComplete = false; // TODO: wire to real completion check

  const allRegistrationSectionsComplete = tuitionReviewed && postEnrollmentSigned && registrationComplete;

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
        title: "Submit Registration",
        description: "Review and submit your completed registration.",
        status: allRegistrationSectionsComplete ? "in_progress" as StepStatus : "not_started" as StepStatus,
        detail: allRegistrationSectionsComplete ? "Ready to submit" : "Locked",
        href: `#`, // No page — triggers modal from overview
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [base, tuitionReviewed, postEnrollmentSigned, registrationComplete, allRegistrationSectionsComplete]
  );

  const registrationCompletedCount = registrationSteps.filter((s) => s.status === "complete").length;

  // Application stage flags (from first app for this year OR family-level flag)
  const isSubmitted =
    familyData?.isSubmitted === true ||
    yearApps.some((a) => (a as { isSubmitted?: boolean }).isSubmitted);
  const isOffered = yearApps.some((a) => (a as { isOffered?: boolean }).isOffered);
  const isAccepted = yearApps.some((a) => (a as { isAccepted?: boolean }).isAccepted);
  const familyAccepted = familyData?.isAccepted ?? false;

  // Derive stage: "apply" | "review" | "accepted"
  const stage: "apply" | "review" | "accepted" =
    isAccepted || familyAccepted
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

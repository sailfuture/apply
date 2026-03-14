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
    snap_benefits: Record<string, unknown> | null;
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
  const { data: scholarshipData } = useScholarship(familyId, yearId);

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

  // Students are complete only when every enrolled app has all required fields
  const studentsComplete = useMemo(() => {
    if (yearApps.length === 0) return false;
    return yearApps.every((app) => {
      const a = app as Record<string, unknown>;
      if (!a.current_previous_school) return false;
      if (!a.last_grade_completed) return false;
      if (!a.current_grade) return false;
      if (!a.describe_student_strengths) return false;
      if (!a.describe_student_opportunities_for_growth) return false;
      if (a.is_bus_transportation && (!a.registration_parents_id || !a.bus_stop)) return false;
      if (!a.nwea_testing_complete && !a.test_scores) return false;
      return true;
    });
  }, [yearApps]);

  const studentsStarted = yearApps.length > 0;

  // Fetch full scholarship data (including sub-entities) for proper completion checks
  const scholarshipId = scholarshipData?.id ?? null;
  const { data: fullScholarship } = useSWR<FullScholarshipResponse>(
    scholarshipId ? `/api/scholarship/${scholarshipId}` : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 10000 }
  );

  const scholarshipComplete = useMemo(() => {
    if (!fullScholarship?.opportunity_scholarship) return false;
    const s = fullScholarship.opportunity_scholarship;

    // Opted out of financial aid — counts as complete
    if (s.isNotParticipating) return true;

    // SNAP benefits path — complete if documentation uploaded
    if (s.isSNAPBenefits) return !!s.snap_benefits;

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

  const scholarshipStarted = !!(scholarshipData && scholarshipData.id);

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

  const steps: StepDef[] = useMemo(
    () => [
      {
        number: 1,
        title: "Your Family Information",
        description: "",
        status: getStatus(familyComplete, familyStarted),
        detail: familyComplete
          ? "Complete"
          : familyStarted
            ? "In progress"
            : "Not started",
        href: `${base}/family`,
      },
      {
        number: 2,
        title: "Student Enrollment Information",
        description: "",
        status: getStatus(studentsComplete, studentsStarted),
        detail: studentsComplete ? "Complete" : studentsStarted ? "In progress" : "Not started",
        href: `${base}/students`,
      },
      {
        number: 3,
        title: "Financial Aid Application",
        description: "",
        status: getStatus(scholarshipComplete, scholarshipStarted),
        detail: scholarshipComplete
          ? "Complete"
          : scholarshipStarted
            ? "In progress"
            : "Not started",
        href: `${base}/scholarship`,
      },
      {
        number: 4,
        title: "Liability Waiver",
        description: "",
        status: getStatus(liabilityComplete, liabilitySent),
        detail: liabilityComplete
          ? "Signed"
          : liabilitySent
            ? "Awaiting signature"
            : "Not started",
        href: `${base}/waiver`,
      },
      {
        number: 5,
        title: "Enrollment Agreement",
        description: "",
        status: getStatus(enrollmentComplete, enrollmentSent),
        detail: enrollmentComplete
          ? "Signed"
          : enrollmentSent
            ? "Awaiting signature"
            : "Not started",
        href: `${base}/agreement`,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      base,
      familyComplete,
      familyStarted,
      studentsComplete,
      studentsStarted,
      scholarshipComplete,
      scholarshipStarted,
      liabilityComplete,
      liabilitySent,
      enrollmentComplete,
      enrollmentSent,
    ]
  );

  const completedCount = steps.filter((s) => s.status === "complete").length;
  const allComplete = completedCount === steps.length;

  // Application stage flags (from first app for this year)
  const isSubmitted = yearApps.some((a) => (a as { isSubmitted?: boolean }).isSubmitted);
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
    completedCount,
    allComplete,
    loading,
    schoolYear,
    yearApps,
    stage,
    isSubmitted,
    isOffered,
    isAccepted,
  };
}

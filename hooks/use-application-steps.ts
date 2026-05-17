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
    /** Income verification flags + multi-file arrays (one slot can hold
     *  every page of a W-2 or pay-stub packet). Optional / nullable so
     *  legacy single-object rows still type-check during the schema
     *  transition — `hasFile` normalizes both shapes. */
    isW2?: boolean;
    isPayStubs?: boolean;
    w2?: Record<string, unknown>[] | Record<string, unknown> | null;
    paystub_1?: Record<string, unknown>[] | Record<string, unknown> | null;
    paystub_2?: Record<string, unknown>[] | Record<string, unknown> | null;
    paystub_3?: Record<string, unknown>[] | Record<string, unknown> | null;
    paystub_4?: Record<string, unknown>[] | Record<string, unknown> | null;
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
    /** Per-benefit documentation array — required upload of award letter
     *  / approval notice for each listed benefit. Replaces the old
     *  family-wide `other_benefits` blob. */
    benefit_documentation?: Record<string, unknown>[];
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

  // Family-payment row — drives the Payment Setup step. The flag we
  // read here (`isStripeSetup`) latches `true` when Stripe Checkout
  // completes (via the webhook handler). Lives on
  // `registration_families_payment` next to the PandaDoc envelope
  // state, parallel pattern to `is_enrollment_agreement_signed`.
  const { data: familyPaymentData } = useSWR<{
    isStripeSetup?: boolean;
    stripe_subscription_id?: string | null;
  } | null>(
    yearId ? `/api/family-payment?yearId=${yearId}` : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 10000 }
  );

  // Per-student packets for the year — needed because the
  // liability-waiver fields moved off the application row onto this
  // packet table. The sidenav reads the first packet's status to
  // decide whether the waiver step is complete / in-progress.
  // Returns `null` (not `[]`) until the fetch lands so we can tell
  // "loading" from "none yet" downstream.
  const { data: packetsData } = useSWR<
    | {
        registration_students_id?: number;
        liability_waiver_status?: string | null;
        liability_waiver_pandadoc_id?: string | null;
      }[]
    | null
  >(
    yearId ? `/api/student-registration?yearId=${yearId}` : null,
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

    // Helpers: a Xano file slot has a usable file when at least one
    // metadata object inside it carries a canonical `path`. Both helpers
    // accept either the legacy single-object shape or the new array shape
    // — w2/paystub_*/benefit_documentation moved from object → array
    // mid-cycle, so we have to handle both during the transition.
    const hasFileObject = (f: unknown): boolean =>
      !!f &&
      typeof f === "object" &&
      !Array.isArray(f) &&
      typeof (f as { path?: unknown }).path === "string" &&
      (f as { path: string }).path.length > 0;
    const hasFile = (v: unknown): boolean => {
      if (Array.isArray(v)) return v.some(hasFileObject);
      return hasFileObject(v);
    };

    // Household size + per-benefit documentation. Each listed benefit
    // must carry its own `benefit_documentation` upload — the old
    // family-wide `other_benefits` blob is gone.
    const incomeComplete =
      s.household_adults > 0 &&
      s.household_children > 0 &&
      (!s.government_benefits ||
        (benefits.length > 0 &&
          benefits.every(
            (b) =>
              b.type &&
              b.amount_monthly > 0 &&
              hasFile(b.benefit_documentation)
          )));

    // Per-member income verification: one of W-2 or pay stubs selected,
    // with the matching file slot(s) actually uploaded. Without this we
    // can't gate sections that depend on a verifiable income.
    const memberIncomeVerified = (m: (typeof members)[number]): boolean => {
      if (m.isW2) return hasFile(m.w2);
      if (m.isPayStubs) {
        return (
          hasFile(m.paystub_1) &&
          hasFile(m.paystub_2) &&
          hasFile(m.paystub_3) &&
          hasFile(m.paystub_4)
        );
      }
      return false;
    };

    // Contributing Members: identity + address + income amount + verified.
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
            m.estimated_annual_income > 0 &&
            memberIncomeVerified(m)
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
        registration_students_id?: number;
        enrollment_agreement_status?: string | null;
        enrollment_agreement_pandadoc_id?: string | null;
        isSubmitted?: boolean;
        isOffered?: boolean;
        isAccepted?: boolean;
      }
    | undefined;

  // Liability-waiver state lives on the per-student packet now.
  // Match the first application's student to its packet, then read
  // status + pandadoc_id from there.
  const firstPacket = (() => {
    if (!packetsData || !firstApp?.registration_students_id) return null;
    return (
      packetsData.find(
        (p) => p?.registration_students_id === firstApp.registration_students_id
      ) ?? null
    );
  })();

  const liabilityComplete =
    firstPacket?.liability_waiver_status === "completed";
  const liabilitySent = !!firstPacket?.liability_waiver_pandadoc_id;
  const enrollmentComplete =
    firstApp?.enrollment_agreement_status === "completed";
  const enrollmentSent = !!firstApp?.enrollment_agreement_pandadoc_id;

  // A section is ONLY considered "done" when the explicit bool on the
  // `registration_family_application_progress` row is true. The derived
  // `*Complete` checks (based on field presence) are kept around purely to
  // decide whether the in-progress state has been entered (see `*Started`
  // below), so an unchecked-but-filled-out section doesn't prematurely flip
  // the sidenav to green.
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
      isReEnrollment,
    ]
  );

  const completedCount = steps.filter((s) => s.status === "complete" && s.title !== "Submit Application").length;
  const allComplete = steps.filter((s) => s.title !== "Submit Application" && s.title !== "Initial Testing").every((s) => s.status === "complete");

  // Post-acceptance registration steps — driven exclusively by the section
  // bools on the `registration_student_registration_progress` bridge row,
  // EXCEPT for Payment Setup which reads from `registration_families_payment`
  // (parallel pattern to the existing enrollment-agreement / PandaDoc state
  // that also lives on the payment row).
  // No legacy fallbacks; the bool is the only signal that counts.
  const tuitionReviewed = regProgressData?.isTuition === true;
  const postEnrollmentSigned = regProgressData?.isEnrollment === true;
  const paymentSetupComplete = familyPaymentData?.isStripeSetup === true;
  const registrationComplete = regProgressData?.isRegistration === true;
  const volunteerAcknowledged = regProgressData?.isVolunteerHours === true;
  // Volunteer Hours is always navigable from the moment registration
  // opens — there's no preceding gate that needs to clear before the
  // family can read the acknowledgment. So the side nav always shows
  // the amber edit affordance (instead of the muted "locked" numbered
  // circle) until the parent confirms it.

  // "Started" signals are independent of the completion bools so an
  // in-progress section shows as yellow instead of gray.
  const postEnrollmentStarted = !!regProgressData?.enrollment_agreement_pandadoc_id;
  // Payment Setup unlocks once the enrollment agreement is signed —
  // we want a signed contract before billing kicks in. Stays "started"
  // even after the parent navigates away so the sidenav stays amber.
  const paymentSetupStarted = postEnrollmentSigned;
  // Each subsequent step unlocks once the prior section's bool is true.
  const registrationStarted = tuitionReviewed;
  // Force the "started" flag on so `getStatus` returns `in_progress`
  // (amber edit pencil) rather than `not_started` (muted numbered
  // circle). The family can land on this step at any time.
  const volunteerStarted = true;

  const allRegistrationSectionsComplete =
    tuitionReviewed &&
    postEnrollmentSigned &&
    paymentSetupComplete &&
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
        title: "Set Up Monthly Payment",
        description: "Set up your card on Stripe for monthly tuition billing.",
        status: getStatus(paymentSetupComplete, paymentSetupStarted),
        detail: paymentSetupComplete
          ? "Card on file"
          : paymentSetupStarted
            ? "In progress"
            : "Locked",
        href: `${base}/payment-setup`,
      },
      {
        number: 4,
        title: "Begin Registration Process",
        description: "Complete the final registration steps to confirm your student\u2019s seat.",
        status: getStatus(registrationComplete, true),
        detail: registrationComplete ? "Complete" : "In progress",
        href: `${base}/registration`,
      },
      {
        number: 5,
        title: "Volunteer Hours Acknowledgment",
        description: "Acknowledge the mandatory volunteer-hours commitment for the year.",
        status: getStatus(volunteerAcknowledged, volunteerStarted),
        detail: volunteerAcknowledged ? "Acknowledged" : "In progress",
        href: `${base}/volunteer-hours`,
      },
      {
        number: 6,
        title: "Submit Registration",
        description: "Review and submit your completed registration.",
        status: allRegistrationSectionsComplete ? "in_progress" as StepStatus : "not_started" as StepStatus,
        detail: allRegistrationSectionsComplete ? "Ready to submit" : "Locked",
        href: `#`, // No page — triggers modal from overview
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      base,
      tuitionReviewed,
      postEnrollmentSigned,
      paymentSetupComplete,
      paymentSetupStarted,
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

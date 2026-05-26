"use client";

import { useParams, usePathname, useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { useApplicationSteps, type StepStatus } from "@/hooks/use-application-steps";
import { useStudents } from "@/hooks/use-api";
import useSWR from "swr";
import { useFamilyProgress } from "@/hooks/use-family-progress";
import { useStudentRegistrationProgress } from "@/hooks/use-student-registration-progress";
import { PreSubmitReviewModal, type SectionStatus } from "@/components/pre-submit-review-modal";
import { EnrolledFamilyDashboard } from "@/components/enrolled-family-dashboard";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { ArrowRight, Clock, CheckCircle2, Lock } from "lucide-react";
import { LoadingScreen } from "@/components/loading-screen";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { toast } from "sonner";
import confetti from "canvas-confetti";

function StepCircle({ number, status }: { number: number; status: StepStatus }) {
  if (status === "complete") {
    return (
      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-green-500 text-white">
        <svg className="size-4" viewBox="0 0 20 20" fill="currentColor">
          <path
            fillRule="evenodd"
            d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
            clipRule="evenodd"
          />
        </svg>
      </div>
    );
  }
  if (status === "in_progress") {
    return (
      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-amber-500 text-white">
        <svg className="size-4" viewBox="0 0 20 20" fill="currentColor">
          <path d="M5.433 13.917l1.262-3.155A4 4 0 017.58 9.42l6.92-6.918a2.121 2.121 0 013 3l-6.92 6.918c-.383.383-.84.685-1.343.886l-3.154 1.262a.5.5 0 01-.65-.65z" />
          <path d="M3.5 5.75c0-.69.56-1.25 1.25-1.25H10A.75.75 0 0010 3H4.75A2.75 2.75 0 002 5.75v9.5A2.75 2.75 0 004.75 18h9.5A2.75 2.75 0 0017 15.25V10a.75.75 0 00-1.5 0v5.25c0 .69-.56 1.25-1.25 1.25h-9.5c-.69 0-1.25-.56-1.25-1.25v-9.5z" />
        </svg>
      </div>
    );
  }
  return (
    <div
      className="flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold bg-muted text-muted-foreground"
    >
      {number}
    </div>
  );
}

/* ── Post-acceptance step circle ── */
function AcceptanceStepCircle({
  number,
  status,
  disabled,
}: {
  number: number;
  status: "complete" | "pending" | "locked";
  disabled?: boolean;
}) {
  if (status === "complete") {
    return (
      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-green-500 text-white">
        <svg className="size-4" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
        </svg>
      </div>
    );
  }
  if (status === "locked" || disabled) {
    return (
      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Lock className="size-3.5" />
      </div>
    );
  }
  // Pending — show edit icon
  return (
    <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-amber-500 text-white">
      <svg className="size-4" viewBox="0 0 20 20" fill="currentColor">
        <path d="M5.433 13.917l1.262-3.155A4 4 0 017.58 9.42l6.92-6.918a2.121 2.121 0 013 3l-6.92 6.918c-.383.383-.84.685-1.343.886l-3.154 1.262a.5.5 0 01-.65-.65z" />
        <path d="M3.5 5.75c0-.69.56-1.25 1.25-1.25H10A.75.75 0 0010 3H4.75A2.75 2.75 0 002 5.75v9.5A2.75 2.75 0 004.75 18h9.5A2.75 2.75 0 0017 15.25V10a.75.75 0 00-1.5 0v5.25c0 .69-.56 1.25-1.25 1.25h-9.5c-.69 0-1.25-.56-1.25-1.25v-9.5z" />
      </svg>
    </div>
  );
}

/* ── Registration Pending View ── */
/** Shown after the parent submits their registration but before every
 *  student has been admin-confirmed (`registrationConfirmed` on the packet).
 *  Mirrors the card + table styling used on the enrolled-family dashboard
 *  and pre-submit review modal so the whole accepted-to-enrolled flow feels
 *  like one surface. */
function RegistrationPendingView({
  parentName,
  yearName,
  submittedDate,
  packets,
  students,
}: {
  parentName: string;
  yearName: string;
  submittedDate: number | null;
  packets: {
    id: number;
    registrationConfirmed?: boolean;
    registration_students_id: number;
  }[];
  students: { id: number; first_name: string; last_name: string }[];
}) {
  const studentLookup = (id: number) => students.find((s) => s.id === id);
  const confirmedCount = packets.filter((p) => p.registrationConfirmed).length;
  const pendingCount = packets.length - confirmedCount;

  return (
    <div className="flex min-h-[calc(100vh-7.5rem)] items-center justify-center px-4 bg-gray-50 dark:bg-background">
      <div className="w-full max-w-2xl py-8">
        {/* Heading — same logo + centered headline + subhead pattern used by
            the application-submitted banner and the accepted view. */}
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <div className="rounded-full border-[6px] border-white dark:border-background shadow-sm">
              <Image
                src="/logo.svg"
                alt="SailFuture Academy"
                width={64}
                height={64}
                className="size-16 rounded-full"
              />
            </div>
          </div>
          <h1 className="text-2xl font-semibold">
            Your {yearName} registration is in review.
          </h1>
          <p className="text-muted-foreground text-sm mt-3 max-w-lg mx-auto">
            {parentName ? `Thank you, ${parentName}. ` : "Thank you. "}
            We&rsquo;ve received your registration. Our admissions team is
            reviewing each student&rsquo;s packet — this page updates as each
            student is confirmed, and once everyone is confirmed you&rsquo;ll
            be taken to your family dashboard automatically.
          </p>
        </div>

        {/* Summary table — same outer-border + divide rows styling used on
            registration pages (bordered rounded container wrapping a Table
            with row dividers). */}
        <div className="rounded-xl bg-background p-1.5 shadow-sm border">
          <div className="overflow-hidden rounded-lg border">
            <div className="flex items-center justify-between border-b px-4 py-3 bg-muted/30">
              <div>
                <p className="text-sm font-medium">Registration received</p>
                {submittedDate ? (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Submitted on{" "}
                    {new Date(submittedDate).toLocaleDateString("en-US", {
                      month: "long",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </p>
                ) : null}
              </div>
              <span className="text-xs font-medium text-muted-foreground tabular-nums shrink-0">
                {confirmedCount}/{packets.length} confirmed
              </span>
            </div>

            {packets.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground text-center">
                No students found on this registration. If you believe this
                is an error, please contact our admissions team.
              </p>
            ) : (
              <Table className="text-sm">
                <TableBody>
                  {packets.map((p) => {
                    const student = studentLookup(p.registration_students_id);
                    const confirmed = !!p.registrationConfirmed;
                    return (
                      <TableRow key={p.id}>
                        <TableCell className="py-3 px-4">
                          <p className="font-medium">
                            {student
                              ? `${student.first_name} ${student.last_name}`
                              : `Student #${p.registration_students_id}`}
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {confirmed
                              ? "Confirmed by admissions"
                              : "Awaiting admissions review"}
                          </p>
                        </TableCell>
                        <TableCell className="py-3 px-4 text-right">
                          {confirmed ? (
                            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-green-700 dark:text-green-500">
                              <CheckCircle2 className="size-4" />
                              Confirmed
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-500">
                              <Clock className="size-4" />
                              Pending
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </div>
        </div>

        {pendingCount > 0 ? (
          <p className="text-xs text-muted-foreground text-center mt-4">
            We&rsquo;ll email the primary parent on file as soon as the
            remaining{" "}
            {pendingCount === 1
              ? "student is"
              : `${pendingCount} students are`}{" "}
            confirmed.
          </p>
        ) : null}

        <p className="text-xs text-muted-foreground text-center mt-6">
          Questions? Contact us at{" "}
          <a
            href="mailto:tward@sailfuture.org"
            className="text-primary underline underline-offset-2"
          >
            tward@sailfuture.org
          </a>{" "}
          or call{" "}
          <a
            href="tel:+17279001436"
            className="text-primary underline underline-offset-2"
          >
            (727) 900-1436
          </a>
          .
        </p>
      </div>
    </div>
  );
}

/* ── Accepted Stage View ── */
function AcceptedView({ firstName, yearId, registrationSteps }: { firstName: string; yearId: number; registrationSteps: { number: number; title: string; description: string; status: StepStatus; href: string }[]; allSectionsComplete: boolean }) {
  const router = useRouter();
  const [submitOpen, setSubmitOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Registration progress row drives the pre-submit modal sections. Same
  // pattern as the application-phase submit — parent clicks Submit, sees
  // which sections are done/not-done with Fix links, confirms when ready.
  const { progress: regProgress, submit: submitRegistration } =
    useStudentRegistrationProgress(yearId);
  const submitSections: SectionStatus[] = useMemo(
    () => [
      { section: "tuition", complete: !!regProgress?.isTuition },
      { section: "enrollment", complete: !!regProgress?.isEnrollment },
      { section: "registration", complete: !!regProgress?.isRegistration },
      { section: "volunteer", complete: !!regProgress?.isVolunteerHours },
    ],
    [regProgress]
  );

  return (
    <div className="flex min-h-[calc(100vh-7.5rem)] items-center justify-center px-4 bg-gray-50 dark:bg-background">
      <div className="w-full max-w-2xl py-8">
        {/* Heading */}
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <div className="flex size-20 items-center justify-center overflow-hidden rounded-full border-4 border-gray-200 dark:border-gray-700 shadow-md bg-white">
              <Image
                src="/logo.svg"
                alt="SailFuture Academy"
                width={80}
                height={80}
                className="size-20 object-cover"
              />
            </div>
          </div>
          <h1 className="text-2xl font-semibold">
            Congratulations{firstName ? `, ${firstName}` : ""} &mdash; your student has been accepted! Welcome to the SailFuture Academy.
          </h1>
          <p className="text-muted-foreground text-sm mt-3 max-w-lg mx-auto">
            On behalf of everyone at SailFuture Academy, <span className="font-semibold text-foreground">we are thrilled to congratulate you on your acceptance to SailFuture Academy and warmly welcome you to the 2025&ndash;2026 academic year!</span>
          </p>
          <p className="text-muted-foreground text-sm mt-3 max-w-lg mx-auto">
            We are excited to embark on this educational journey with you and your family and present a new and unique opportunity for growth, discovery, and adventure that goes far beyond the traditional boundaries of education. To secure your spot, all new students must complete the student registration form as soon as possible. <span className="font-semibold text-foreground">The deadline for registration is June 1st, 2026.</span> If the new student registration form is not completed by the deadline, your spot will be opened to our current waitlist.
          </p>
        </div>

        {/* Post-acceptance step table */}
        <div className="rounded-xl bg-background p-1.5 shadow-sm border">
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <tbody className="divide-y">
                {/* Steps 1–4 are the four registration sections (Tuition,
                    Enrollment, Registration, Volunteer Hours). Step 5 is
                    "Submit Registration" — rendered separately below as
                    the blue CTA row, so we exclude it here. Volunteer
                    Hours used to be excluded by mistake, which left it
                    without the amber/pencil edit affordance the other
                    sections render. */}
                {registrationSteps.filter((s) => s.number <= 4).map((step) => {
                  const isComplete = step.status === "complete";
                  return (
                    <tr
                      key={step.number}
                      className={`transition-colors cursor-pointer ${
                        isComplete
                          ? "hover:bg-muted/30"
                          : "hover:bg-muted/30"
                      }`}
                      onClick={() => router.push(step.href)}
                    >
                      <td className="px-4 py-4 w-12">
                        <AcceptanceStepCircle
                          number={step.number}
                          status={isComplete ? "complete" : "pending"}
                        />
                      </td>
                      <td className="px-2 py-4">
                        <p className="font-medium">{step.title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {step.description}
                        </p>
                      </td>
                      <td className="px-4 py-4 w-10 text-muted-foreground">
                        <div className="flex size-7 items-center justify-center rounded-md border border-border">
                          <ArrowRight className="size-3.5" />
                        </div>
                      </td>
                    </tr>
                  );
                })}

                {/* Submit Registration row — always clickable. The modal
                    itself surfaces which sections still need attention and
                    gates the confirm button, matching the application-phase
                    submit UX. */}
                <tr
                  className="transition-colors bg-blue-600 hover:bg-blue-700 cursor-pointer"
                  onClick={() => setSubmitOpen(true)}
                >
                  <td className="px-4 py-4 w-12">
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/20">
                      <ArrowRight className="size-4 text-white" />
                    </div>
                  </td>
                  <td className="px-2 py-4">
                    <p className="font-medium text-white">
                      Submit Registration
                      <span className="ml-1.5 text-white/70 text-xs font-normal">
                        ({submitSections.filter((s) => s.complete).length}/{submitSections.length})
                      </span>
                    </p>
                  </td>
                  <td className="px-4 py-4 w-10">
                    <div className="flex size-7 items-center justify-center rounded-md border border-white/30">
                      <ArrowRight className="size-3.5 text-white" />
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Pre-submit review modal — same component used for the
            application-phase submit. `phase="registration"` switches the
            title/button copy; `sections` comes from the registration
            progress row's four bools. */}
        <PreSubmitReviewModal
          open={submitOpen}
          onOpenChange={setSubmitOpen}
          sections={submitSections}
          basePath={`/apply/year/${yearId}`}
          submitting={submitting}
          phase="registration"
          onConfirm={async () => {
            if (submitting) return;
            setSubmitting(true);
            try {
              await submitRegistration();
              setSubmitOpen(false);
              toast.success("Registration submitted successfully!");
              // Stay on the year dashboard — the enrolled-family branch
              // takes over once `isSubmitted` is true.
            } catch {
              toast.error("Failed to submit registration. Please try again.");
            } finally {
              setSubmitting(false);
            }
          }}
        />

        {/* Contact info */}
        <p className="text-xs text-muted-foreground text-center mt-6">
          If you have any questions, please contact us at{" "}
          <a
            href="mailto:tward@sailfuture.org"
            className="text-primary underline underline-offset-2"
          >
            tward@sailfuture.org
          </a>{" "}
          or call{" "}
          <a
            href="tel:+17279001436"
            className="text-primary underline underline-offset-2"
          >
            (727) 900-1436
          </a>
          .
        </p>
      </div>
    </div>
  );
}

export default function YearOverviewPage() {
  const params = useParams();
  const router = useRouter();
  const pathname = usePathname();
  const yearId = Number(params.yearId);

  const { user } = useUser();
  const firstName = user?.firstName ?? "";

  const { steps, registrationSteps, registrationCompletedCount, allRegistrationSectionsComplete, allComplete, loading, stage, schoolYear } =
    useApplicationSteps(yearId);
  const { data: students } = useStudents();
  const studentsLoading = students === undefined;
  const yearName = schoolYear?.year_name ?? "next year";

  // URL policy by lifecycle phase:
  //   - Application (apply / review)                  → /apply/year/[yearId]
  //   - Registration (accepted, pending, etc.)        → /registration/year/[yearId]
  //   - Enrolled (submitted + every student confirmed) → /dashboard
  //
  // The redirect effect itself lives further down the component so it can
  // close over `regProgress`, `yearPackets`, and `isEnrolled` — see below
  // after those are declared.

  // Pre-submit review — opens as a modal when the user clicks "Submit Application".
  // Reads the 4 section completion booleans from
  // `registration_family_application_progress` and surfaces a Fix link for
  // any section that isn't yet marked complete.
  const {
    progress,
    loading: familyProgressLoading,
    submit: submitFamilyApplication,
    unsubmit: unsubmitFamilyApplication,
  } = useFamilyProgress(yearId);
  // Local state for the "Need to edit something?" warning modal —
  // shown when the parent wants to drop out of review and edit fields
  // again. Confirming flips `isSubmitted=false` + clears
  // `submitted_at`, then the page re-renders the editable apply view.
  const [unsubmitOpen, setUnsubmitOpen] = useState(false);
  const [unsubmitting, setUnsubmitting] = useState(false);
  const isSubmitted = !!progress?.isSubmitted;

  // Post-registration: when the parent clicks Submit Registration we flip
  // `isSubmitted: true` on the registration progress row. Submitted means
  // "the family completed their side" — it does NOT mean the enrollment
  // is final. Admin must then review each student and flip
  // `registrationConfirmed: true` on that student's packet row. Once every
  // student's packet is confirmed, the enrolled-family dashboard takes
  // over the page.
  const { progress: regProgress, loading: regProgressLoading } =
    useStudentRegistrationProgress(yearId);
  const isRegistrationSubmitted = !!regProgress?.isSubmitted;

  const { data: yearPackets } = useSWR<
    { id: number; registrationConfirmed?: boolean; registration_students_id: number }[]
  >(
    isRegistrationSubmitted
      ? `/api/student-registration?yearId=${yearId}`
      : null,
    (url: string) => fetch(url).then((r) => r.json()),
    // Live-poll the per-student packets while the parent waits on
    // admin to confirm each one. Without this the "Registration in
    // review" view stays stuck on the snapshot the page was loaded
    // with; the parent has to hard-reload to see "Confirmed by
    // admissions" flip on for each student.
    { revalidateOnFocus: true, refreshInterval: 30000, dedupingInterval: 10000 }
  );

  const allStudentsConfirmed =
    !!yearPackets &&
    yearPackets.length > 0 &&
    yearPackets.every((p) => p.registrationConfirmed === true);

  // "Enrolled" = family-level admin latch flipped + parent has
  // submitted + every student's packet has been admin-confirmed.
  // ALL THREE matter — `isRegistrationConfirmed` is the family-level
  // "officially enrolled" gate admin flips via the Family Registration
  // Confirmation card. Without checking it here, an admin unconfirm
  // doesn't bounce the parent out of the enrolled view, and the
  // redirect logic gets stuck in a loop between the root `/`,
  // `/registration`, and `/dashboard` (each disagrees on whether the
  // family is enrolled).
  const isRegistrationConfirmed =
    !!regProgress?.isRegistrationConfirmed;
  const isEnrolled =
    isRegistrationConfirmed &&
    isRegistrationSubmitted &&
    allStudentsConfirmed;

  // URL routing effect — see comment near the top of the component for
  // the lifecycle → URL mapping. Lives down here so it can read the
  // already-declared `regProgress`, `yearPackets`, and `isEnrolled`.
  //
  // Single-decision semantics: when the family is on the `accepted`
  // path we wait for BOTH `regProgress` and `yearPackets` to resolve
  // before picking a destination. The earlier code redirected
  // `/apply` → `/registration` as soon as `stage` flipped to
  // "accepted" — fine in isolation, but then `/registration` would
  // re-evaluate, find `isEnrolled === true`, and bounce again to
  // `/dashboard`. That's two visible flickers per accepted-family
  // landing (apply skeleton → registration skeleton → dashboard
  // skeleton). Waiting for the full data before any redirect lets us
  // go straight `/apply` → `/dashboard` in one hop.
  useEffect(() => {
    if (loading) return;
    const onApply = pathname.startsWith(`/apply/year/${yearId}`);
    const onRegistration = pathname.startsWith(`/registration/year/${yearId}`);

    // Hold redirects on the accepted path until enrollment status is
    // fully known. Eliminates the apply → registration → dashboard
    // double-hop for already-enrolled families.
    if (stage === "accepted") {
      // Always wait for regProgress before deciding.
      if (regProgress === null) return;

      // Only wait for `yearPackets` when registration was actually
      // submitted. Otherwise the SWR key in `useSWR(...)` above is
      // `null`, the fetch never fires, and `yearPackets` is `undefined`
      // forever — which would block this effect from ever redirecting
      // an accepted-but-not-submitted family off of `/apply`.
      if (isRegistrationSubmitted && yearPackets === undefined) return;

      if (isEnrolled) {
        router.replace("/dashboard");
        return;
      }
      if (onApply) {
        router.replace(`/registration/year/${yearId}`);
      }
      return;
    }

    if (onRegistration) {
      router.replace(`/apply/year/${yearId}`);
    }
  }, [
    loading,
    stage,
    pathname,
    yearId,
    router,
    regProgress,
    yearPackets,
    isEnrolled,
    isRegistrationSubmitted,
  ]);

  const submitSections: SectionStatus[] = useMemo(
    () => [
      { section: "family", complete: !!progress?.family_completed },
      { section: "students", complete: !!progress?.students_completed },
      { section: "financial_aid", complete: !!progress?.financial_aid_completed },
      { section: "testing", complete: !!progress?.testing_completed },
    ],
    [progress]
  );
  const [preSubmitOpen, setPreSubmitOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // When family is accepted, sync isAccepted=true on all family students
  const acceptanceSynced = useRef(false);
  useEffect(() => {
    if (stage !== "accepted" || acceptanceSynced.current || !students) return;
    acceptanceSynced.current = true;
    const unaccepted = (students as { id: number; isAccepted?: boolean }[])
      .filter((s) => !s.isAccepted);
    for (const student of unaccepted) {
      fetch(`/api/students/${student.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isAccepted: true }),
      }).catch(() => {});
    }
  }, [stage, students]);

  // Confetti for the moment a family is freshly accepted — fires only when
  // the family has truly just landed on the AcceptedView with zero
  // registration progress yet. Gated on the registration progress row
  // being loaded (regProgress !== null) so we don't fire during the
  // initial load when `isRegistrationSubmitted` defaults to false.
  const confettiFired = useRef(false);
  useEffect(() => {
    if (
      stage === "accepted" &&
      !confettiFired.current &&
      regProgress !== null &&
      registrationCompletedCount === 0 &&
      !isRegistrationSubmitted
    ) {
      confettiFired.current = true;

      // Navy blue + silver — SailFuture school colors.
      const SCHOOL_COLORS = ["#0D2446", "#1a3a6b", "#1e40af", "#c0c0c0", "#e5e7eb", "#9ca3af"];
      confetti({ particleCount: 80, spread: 70, origin: { x: 0.1, y: 0.6 }, colors: SCHOOL_COLORS });
      confetti({ particleCount: 80, spread: 70, origin: { x: 0.9, y: 0.6 }, colors: SCHOOL_COLORS });
      setTimeout(() => {
        confetti({ particleCount: 50, spread: 100, origin: { x: 0.5, y: 0.4 }, colors: SCHOOL_COLORS });
      }, 300);
    }
  }, [stage, regProgress, registrationCompletedCount, isRegistrationSubmitted]);

  // Keep the spinner up while we know a redirect is imminent so the
  // parent doesn't see the apply / accepted view flash briefly
  // before the URL changes. Two transitional cases:
  //
  //   1. Family is accepted but we're on `/apply` — the URL effect
  //      above will redirect to `/registration` (or `/dashboard` if
  //      already enrolled) once data lands. Show spinner through
  //      that window rather than the apply form.
  //   2. Family is NOT accepted but we're on `/registration` —
  //      symmetric case, will redirect back to `/apply`.
  //
  // The "stage=accepted + already enrolled" case is handled by
  // `isEnrolled` short-circuiting the whole page directly to the
  // dashboard further down; this guard only covers the URL-mismatch
  // case where we haven't decided yet but know we're going to move.
  const onApplyPath = pathname.startsWith(`/apply/year/${yearId}`);
  const onRegistrationPath = pathname.startsWith(
    `/registration/year/${yearId}`
  );

  // Comprehensive initial-load gate. `loading` (from useApplicationSteps)
  // only covers family + years + apps. The stage/view decision also
  // reads useFamilyProgress (familyAccepted / familySubmitted),
  // useStudentRegistrationProgress (isRegistrationConfirmed /
  // isRegistrationSubmitted), useStudents (RegistrationPendingView's
  // roster), and the per-year packets SWR (allStudentsConfirmed →
  // enrolled). If any of those is undefined on first paint, the page
  // renders with default-false data and lands on the WRONG view (e.g.
  // briefly AcceptedView with stale per-app `isAccepted=true` before
  // useFamilyProgress arrives and flips stage to "review"). Holding
  // the spinner until ALL data sources have settled at least once
  // eliminates that interim render.
  //
  // `yearPacketsPending` only fires when registration was submitted —
  // the SWR key is `null` otherwise, so `yearPackets === undefined`
  // means "not fetching" not "still loading."
  const yearPacketsPending =
    isRegistrationSubmitted && yearPackets === undefined;
  const initialDataLoading =
    loading ||
    familyProgressLoading ||
    regProgressLoading ||
    studentsLoading ||
    yearPacketsPending;

  // Stage-transition guard. SWR's polling fires each hook independently
  // and resolves them at slightly different times; between hook A
  // committing new data and hook B committing new data, the page can
  // briefly render with mixed-stage data (e.g. useApplications updated
  // but useFamilyProgress hasn't). That intermediate render is the
  // "flashed wrong page" the parent saw after admin revoked
  // acceptance. We track the previously-committed stage; when it
  // diverges from the freshly-computed stage we hold the spinner for
  // one render cycle so the URL effect (below) has a chance to fire
  // before any view tries to render the new stage on the wrong path.
  const prevStageRef = useRef(stage);
  const stageJustChanged =
    !initialDataLoading && prevStageRef.current !== stage;
  useEffect(() => {
    prevStageRef.current = stage;
  }, [stage]);

  const willRedirect =
    !initialDataLoading &&
    ((stage === "accepted" && onApplyPath) ||
      (stage !== "accepted" && onRegistrationPath));

  if (initialDataLoading || willRedirect || stageJustChanged) {
    return (
      <div className="flex min-h-[calc(100vh-7.5rem)] items-center justify-center px-4 bg-gray-50 dark:bg-background">
        <LoadingScreen />
      </div>
    );
  }

  /* ────────── Stage 2: Under Review ────────── */
  if (stage === "review") {
    return (
      <div className="flex min-h-[calc(100vh-7.5rem)] items-center justify-center px-4 bg-gray-50 dark:bg-background">
        <div className="w-full max-w-2xl py-8">
          <div className="text-center mb-8">
            <div className="flex justify-center mb-4">
              {/* Logo treatment matches the registration-in-review and
                  accepted views so the parent sees a consistent
                  visual across post-submit states. */}
              <div className="rounded-full border-[6px] border-white dark:border-background shadow-sm">
                <Image
                  src="/logo.svg"
                  alt="SailFuture Academy"
                  width={64}
                  height={64}
                  className="size-16 rounded-full"
                />
              </div>
            </div>
            <h1 className="text-2xl font-semibold">
              {firstName ? `${firstName}, your` : "Your"} application is under review.
            </h1>
            <p className="text-muted-foreground text-sm mt-3 max-w-lg mx-auto">
              A member of our admissions team is reviewing your student&apos;s application and will reach out to you directly to discuss next steps.
            </p>
          </div>

          {/* Contact info */}
          <div className="rounded-xl bg-background p-5 shadow-sm border text-center">
            <p className="text-sm font-medium mb-1">Have questions?</p>
            <p className="text-sm text-muted-foreground">
              Contact us at{" "}
              <a
                href="mailto:tward@sailfuture.org"
                className="text-primary underline underline-offset-2"
              >
                tward@sailfuture.org
              </a>{" "}
              or call{" "}
              <a
                href="tel:+17279001436"
                className="text-primary underline underline-offset-2"
              >
                (727) 900-1436
              </a>
              .
            </p>
          </div>

          {/* Need-to-edit affordance — opens a warning modal that
              unsubmits the application on confirm so the parent can
              go back into the apply flow and change something. */}
          <div className="mt-6 text-center">
            <p className="text-sm text-muted-foreground mb-2">
              Need to edit something?
            </p>
            <button
              type="button"
              onClick={() => setUnsubmitOpen(true)}
              className="inline-flex items-center justify-center rounded-md border bg-background px-4 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-muted/50"
            >
              Click here to edit your application
            </button>
          </div>
        </div>

        <AlertDialog
          open={unsubmitOpen}
          onOpenChange={(open) => {
            if (!unsubmitting) setUnsubmitOpen(open);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Unsubmit your application to edit?
              </AlertDialogTitle>
              <AlertDialogDescription>
                Your application will go back to the editable apply
                flow and the admissions team will no longer see it as
                ready to review. You can re-submit from the dashboard
                once your edits are saved. Continue?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={unsubmitting}>
                Keep submitted
              </AlertDialogCancel>
              <AlertDialogAction
                disabled={unsubmitting}
                className="bg-amber-600 hover:bg-amber-700 text-white"
                onClick={async (e) => {
                  e.preventDefault();
                  setUnsubmitting(true);
                  try {
                    await unsubmitFamilyApplication?.();
                    toast.success(
                      "Application unsubmitted — you can edit and re-submit from the dashboard."
                    );
                    setUnsubmitOpen(false);
                  } catch (err) {
                    console.error("Failed to unsubmit:", err);
                    toast.error(
                      err instanceof Error
                        ? err.message
                        : "Couldn't unsubmit — please try again."
                    );
                  } finally {
                    setUnsubmitting(false);
                  }
                }}
              >
                {unsubmitting ? "Unsubmitting…" : "Yes, let me edit"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  /* ────────── Accepted-stage substages ──────────
     The initial-loading gate above already waits for `regProgress` when
     `stage === "accepted"`, so by the time we get here the substage
     selectors (enrolled / submitted / accepted) can read live data. */

  /* Stage 5: Enrolled — registration submitted AND every student's packet
     has been admin-confirmed. The enrolled-family dashboard takes over. */
  if (stage === "accepted" && isEnrolled) {
    return (
      <EnrolledFamilyDashboard
        yearId={yearId}
        yearName={schoolYear?.year_name ?? "current"}
        submittedDate={regProgress?.submitted_date ?? null}
      />
    );
  }

  /* Stage 4: Registration submitted — pending admin review. Parent has
     submitted, but at least one student's packet hasn't been confirmed
     yet. Show a "stand by" banner. */
  if (stage === "accepted" && isRegistrationSubmitted) {
    const parentName =
      user?.fullName ||
      [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
      firstName ||
      "";
    return (
      <RegistrationPendingView
        parentName={parentName}
        yearName={schoolYear?.year_name ?? "current"}
        submittedDate={regProgress?.submitted_date ?? null}
        packets={yearPackets ?? []}
        students={(students ?? []) as { id: number; first_name: string; last_name: string }[]}
      />
    );
  }

  /* Stage 3: Accepted — registration steps in progress. */
  if (stage === "accepted") {
    return <AcceptedView firstName={firstName} yearId={yearId} registrationSteps={registrationSteps} allSectionsComplete={allRegistrationSectionsComplete} />;
  }

  /* ────────── Post-submit: Application is in review ──────────
     Once the parent hits Submit, `isSubmitted` flips to true on the
     `registration_family_application_progress` row. We replace the step
     table with a confirmation banner so the form can't be re-submitted or
     casually edited from here. */
  if (isSubmitted) {
    return (
      <div className="flex min-h-[calc(100vh-7.5rem)] items-center justify-center px-4 bg-gray-50 dark:bg-background">
        <div className="w-full max-w-2xl py-8">
          <div className="text-center mb-8">
            <div className="flex justify-center mb-4">
              <div className="rounded-full border-[6px] border-white dark:border-background shadow-sm">
                <Image
                  src="/logo.svg"
                  alt="SailFuture Academy"
                  width={64}
                  height={64}
                  className="size-16 rounded-full"
                />
              </div>
            </div>
            <h1 className="text-2xl font-semibold">
              Your application has been submitted.
            </h1>
            <p className="text-muted-foreground text-sm mt-3 max-w-lg mx-auto">
              Thank you{firstName ? `, ${firstName}` : ""}. We&rsquo;ve received
              your application for {yearName}. Please stand by while our
              admissions team reviews it — check back here for updates and next
              steps on your acceptance.
            </p>
          </div>

          <div className="rounded-xl bg-background p-6 shadow-sm border text-center">
            <div className="flex justify-center mb-3">
              <div className="flex size-12 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
                <CheckCircle2 className="size-6 text-green-600 dark:text-green-500" />
              </div>
            </div>
            <p className="text-sm font-medium">Application received</p>
            {progress?.submitted_at ? (
              <p className="text-xs text-muted-foreground mt-1">
                Submitted on{" "}
                {new Date(progress.submitted_at).toLocaleDateString("en-US", {
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })}
              </p>
            ) : null}
          </div>

          <p className="text-xs text-muted-foreground text-center mt-6">
            Questions? Contact us at{" "}
            <a
              href="mailto:tward@sailfuture.org"
              className="text-primary underline underline-offset-2"
            >
              tward@sailfuture.org
            </a>{" "}
            or call{" "}
            <a
              href="tel:+17279001436"
              className="text-primary underline underline-offset-2"
            >
              (727) 900-1436
            </a>
            .
          </p>
        </div>
      </div>
    );
  }

  /* ────────── Stage 1: Start the Application ────────── */
  return (
    <div className="flex min-h-[calc(100vh-7.5rem)] items-center justify-center px-4 bg-gray-50 dark:bg-background">
      <div className="w-full max-w-2xl py-8">
        {/* Heading */}
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <div className="rounded-full border-[6px] border-white dark:border-background shadow-sm">
              <Image
                src="/logo.svg"
                alt="SailFuture Academy"
                width={64}
                height={64}
                className="size-16 rounded-full"
              />
            </div>
          </div>
          <h1 className="text-2xl font-semibold">
            {firstName ? `${firstName}, let\u2019s get started` : "Let\u2019s get started"}
            <br />
            on your application for {yearName}.
          </h1>
          <p className="text-muted-foreground text-sm mt-3 max-w-lg mx-auto">
            SailFuture Academy accepts 30 students each academic year on a rolling basis. Complete the application below and our admissions team will follow up personally.
          </p>
        </div>

        {/* Step Table */}
        <div className="rounded-xl bg-background p-1.5 shadow-sm border">
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <tbody className="divide-y">
                {steps.filter((s) => s.title !== "Submit Application").map((step) => {
                  const isComplete = step.status === "complete";

                  return (
                    <tr
                      key={step.number}
                      className="transition-colors cursor-pointer hover:bg-muted/30"
                      onClick={() => router.push(step.href)}
                    >
                      <td className="px-4 py-4 w-12">
                        <StepCircle
                          number={step.number}
                          status={step.status}
                        />
                      </td>
                      <td className="px-2 py-4">
                        <p className="font-medium">{step.title}</p>
                      </td>
                      <td className="px-4 py-4 w-10 text-muted-foreground">
                        <div className="flex size-7 items-center justify-center rounded-md border border-border">
                          <ArrowRight className="size-3.5" />
                        </div>
                      </td>
                    </tr>
                  );
                })}

                {/* Submit Application row — always clickable; the modal tells
                    the user what's left if anything. */}
                <tr
                  className="bg-primary text-primary-foreground cursor-pointer transition-opacity hover:opacity-90"
                  onClick={() => setPreSubmitOpen(true)}
                >
                  <td className="px-4 py-4 w-12">
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-foreground/20 text-primary-foreground text-xs font-semibold">
                      <ArrowRight className="size-4" />
                    </div>
                  </td>
                  <td className="px-2 py-4">
                    <p className="font-semibold">Submit Application</p>
                  </td>
                  <td className="px-4 py-4 w-10">
                    <div className="flex size-7 items-center justify-center rounded-md border border-primary-foreground/30">
                      <ArrowRight className="size-3.5" />
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Contact info */}
        <p className="text-xs text-muted-foreground text-center mt-6">
          If you require assistance with your application, please contact us at{" "}
          <a
            href="mailto:tward@sailfuture.org"
            className="text-primary underline underline-offset-2"
          >
            tward@sailfuture.org
          </a>{" "}
          or call{" "}
          <a
            href="tel:+17279001436"
            className="text-primary underline underline-offset-2"
          >
            (727) 900-1436
          </a>
          .
        </p>
      </div>

      {/* Pre-submit review modal — opens when the Submit Application row is clicked.
          Shows per-section completion + missing items with jump links. */}
      <PreSubmitReviewModal
        open={preSubmitOpen}
        onOpenChange={setPreSubmitOpen}
        sections={submitSections}
        basePath={`/apply/year/${yearId}`}
        submitting={submitting}
        onConfirm={async () => {
          if (submitting) return;
          setSubmitting(true);
          try {
            await submitFamilyApplication();
            setPreSubmitOpen(false);
            // Stay on the dashboard; the "Application Submitted" banner
            // renders because `progress.isSubmitted` is now true.
          } catch {
            // Leave modal open so the user can retry.
          } finally {
            setSubmitting(false);
          }
        }}
      />
    </div>
  );
}

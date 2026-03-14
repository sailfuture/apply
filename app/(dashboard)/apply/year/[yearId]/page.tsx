"use client";

import { useParams, useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { useApplicationSteps, type StepStatus } from "@/hooks/use-application-steps";
import { ArrowRight, Clock, CheckCircle2, Lock } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import Image from "next/image";

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
      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
        <CheckCircle2 className="size-4 text-green-600 dark:text-green-400" />
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
  return (
    <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-semibold">
      {number}
    </div>
  );
}

export default function YearOverviewPage() {
  const params = useParams();
  const router = useRouter();
  const yearId = Number(params.yearId);

  const { user } = useUser();
  const firstName = user?.firstName ?? "";

  const { steps, allComplete, loading, stage, schoolYear } =
    useApplicationSteps(yearId);
  const yearName = schoolYear?.year_name ?? "next year";

  if (loading) {
    return (
      <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center px-4">
        <div className="w-full max-w-2xl py-8">
          <div className="text-center mb-8">
            <Skeleton className="size-16 rounded-full mx-auto mb-4" />
            <Skeleton className="h-7 w-80 mx-auto" />
            <Skeleton className="h-4 w-full max-w-lg mx-auto mt-3" />
            <Skeleton className="h-4 w-96 mx-auto mt-1" />
            <Skeleton className="h-4 w-full max-w-lg mx-auto mt-3" />
          </div>
          <div className="overflow-hidden rounded-lg border">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center px-4 py-4 border-b last:border-b-0">
                <Skeleton className="size-8 rounded-full shrink-0" />
                <div className="flex-1 px-4">
                  <Skeleton className="h-4 w-32" />
                </div>
                <Skeleton className="size-7 rounded-md" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  /* ────────── Stage 2: Under Review ────────── */
  if (stage === "review") {
    return (
      <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center px-4 bg-gray-50 dark:bg-background">
        <div className="w-full max-w-2xl py-8">
          <div className="text-center mb-8">
            <div className="flex justify-center mb-4">
              <div className="flex size-16 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
                <Clock className="size-8 text-amber-600 dark:text-amber-400" />
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
        </div>
      </div>
    );
  }

  /* ────────── Stage 3: Accepted ────────── */
  if (stage === "accepted") {
    // Post-acceptance steps: Review Scholarship Costs → Sign Enrollment Agreement → Begin Registration
    // Steps 1 & 2 are disabled (admin-driven). Step 3 unlocks when first two are complete.
    // For now, all three are disabled since this is admin-initiated.
    const scholarshipCostReviewed = false; // TODO: wire to real data when available
    const enrollmentSigned = false; // TODO: wire to real data when available
    const canBeginRegistration = scholarshipCostReviewed && enrollmentSigned;

    const acceptanceSteps = [
      {
        number: 1,
        title: "Review Scholarship Costs",
        description: "Review your financial aid award and tuition details.",
        status: scholarshipCostReviewed ? "complete" as const : "pending" as const,
        disabled: true,
      },
      {
        number: 2,
        title: "Sign Enrollment Agreement",
        description: "Review and sign the enrollment agreement for the upcoming year.",
        status: enrollmentSigned ? "complete" as const : "pending" as const,
        disabled: true,
      },
      {
        number: 3,
        title: "Begin Registration Process",
        description: "Complete the final registration steps to confirm your student\u2019s seat.",
        status: canBeginRegistration ? "pending" as const : "locked" as const,
        disabled: !canBeginRegistration,
      },
    ];

    return (
      <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center px-4 bg-gray-50 dark:bg-background">
        <div className="w-full max-w-2xl py-8">
          {/* Heading */}
          <div className="text-center mb-8">
            <div className="flex justify-center mb-4">
              <div className="flex size-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
                <CheckCircle2 className="size-8 text-green-600 dark:text-green-400" />
              </div>
            </div>
            <h1 className="text-2xl font-semibold">
              Congratulations{firstName ? `, ${firstName}` : ""} &mdash; your student has been accepted!
            </h1>
            <p className="text-muted-foreground text-sm mt-3 max-w-lg mx-auto">
              Your student has been offered one of 30 seats at SailFuture Academy for the 2026&ndash;2027 school year. Please complete the steps below to confirm enrollment.
            </p>
          </div>

          {/* Post-acceptance step table */}
          <div className="rounded-xl bg-background p-1.5 shadow-sm border">
            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-sm">
                <tbody className="divide-y">
                  {acceptanceSteps.map((step) => {
                    const isDisabled = step.disabled;
                    return (
                      <tr
                        key={step.number}
                        className={`transition-colors ${
                          isDisabled
                            ? "opacity-50 cursor-not-allowed"
                            : "cursor-pointer hover:bg-muted/30"
                        } ${
                          step.status === "complete"
                            ? "bg-green-50 dark:bg-green-950/20"
                            : ""
                        }`}
                      >
                        <td className="px-4 py-4 w-12">
                          <AcceptanceStepCircle
                            number={step.number}
                            status={step.status}
                            disabled={isDisabled}
                          />
                        </td>
                        <td className="px-2 py-4">
                          <p className="font-medium">{step.title}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {step.description}
                          </p>
                        </td>
                        <td className="px-4 py-4 w-10 text-muted-foreground">
                          {!isDisabled && (
                            <div className="flex size-7 items-center justify-center rounded-md border border-border">
                              <ArrowRight className="size-3.5" />
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

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

  /* ────────── Stage 1: Start the Application ────────── */
  return (
    <div className="flex min-h-screen items-center justify-center px-4 bg-gray-50 dark:bg-background">
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
                {steps.map((step) => {
                  const isComplete = step.status === "complete";

                  return (
                    <tr
                      key={step.number}
                      className={`transition-colors cursor-pointer ${
                        isComplete
                          ? "bg-green-50 dark:bg-green-950/20 hover:bg-green-100 dark:hover:bg-green-950/30"
                          : "hover:bg-muted/30"
                      }`}
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

                {/* Submit Application row */}
                <tr
                  className={`bg-primary text-primary-foreground transition-opacity ${
                    allComplete
                      ? "cursor-pointer hover:opacity-90"
                      : "opacity-10 cursor-not-allowed"
                  }`}
                  onClick={() => {
                    if (allComplete) router.push(`/apply/year/${yearId}/submit`);
                  }}
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
    </div>
  );
}

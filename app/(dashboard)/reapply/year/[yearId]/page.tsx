"use client";

import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Image from "next/image";
import { useUser } from "@clerk/nextjs";
import { useSchoolYears } from "@/hooks/use-api";
import { useReapplyFamilyProgress } from "@/hooks/use-reapply-family-progress";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { ReapplyPreSubmitModal } from "@/components/reapply-pre-submit-modal";

interface SchoolYear {
  id: number;
  year_name: string;
}

const STEPS: { segment: string; title: string; description: string; key: SectionKey }[] = [
  {
    segment: "family",
    title: "Confirm Family Details",
    description: "Review your parent and guardian information for the new year.",
    key: "isFamilyDetails",
  },
  {
    segment: "students",
    title: "Confirm Student Details",
    description: "Confirm enrollment for each student returning this year.",
    key: "isStudentDetails",
  },
  {
    segment: "scholarship",
    title: "Opportunity Scholarship",
    description: "Re-submit your Opportunity Scholarship application for the new year.",
    key: "isScholarship",
  },
  {
    segment: "transportation",
    title: "Transportation",
    description: "Confirm or update your bus transportation preferences.",
    key: "isTransportation",
  },
];

type SectionKey = "isFamilyDetails" | "isStudentDetails" | "isScholarship" | "isTransportation";

/**
 * Overview / "home" page for the re-application flow. Mirrors the apply
 * year overview's step table — title, four step rows, submit row at the
 * bottom — but reads from the reapply progress row.
 */
export default function ReapplyOverviewPage() {
  const params = useParams();
  const router = useRouter();
  const yearId = Number(params.yearId);
  const { user } = useUser();
  const firstName = user?.firstName ?? "";

  const { data: yearsData } = useSchoolYears();
  const yearName = useMemo(() => {
    if (!yearsData) return "";
    return (
      (yearsData as SchoolYear[]).find((y) => y.id === yearId)?.year_name ?? ""
    );
  }, [yearsData, yearId]);

  const { progress, loading } = useReapplyFamilyProgress(yearId);
  const [submitOpen, setSubmitOpen] = useState(false);

  const completedCount = STEPS.filter((s) => progress?.[s.key]).length;
  const allReady = completedCount === STEPS.length;
  const isSubmitted = !!progress?.isSubmitted;

  if (loading) {
    return (
      <div className="flex min-h-[calc(100vh-7.5rem)] items-center justify-center px-4 bg-gray-50 dark:bg-background">
        <div className="w-full max-w-2xl py-8">
          <Skeleton className="size-16 rounded-full mx-auto mb-4" />
          <Skeleton className="h-7 w-3/4 mx-auto" />
          <Skeleton className="h-4 w-2/3 mx-auto mt-3" />
          <Skeleton className="h-64 w-full rounded-xl mt-8" />
        </div>
      </div>
    );
  }

  // Already-submitted families see a confirmation banner instead of the
  // editable step list. Admin still has to review + confirm before they
  // move into the re-registration phase.
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
              Your {yearName} re-application is in review.
            </h1>
            <p className="text-muted-foreground text-sm mt-3 max-w-lg mx-auto">
              {firstName ? `Thank you, ${firstName}. ` : "Thank you. "}
              Our admissions team will follow up shortly. You can return to
              your dashboard at any time.
            </p>
          </div>
          <div className="rounded-xl bg-background p-6 shadow-sm border text-center">
            <div className="flex justify-center mb-3">
              <div className="flex size-12 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
                <CheckCircle2 className="size-6 text-green-600 dark:text-green-500" />
              </div>
            </div>
            <p className="text-sm font-medium">Re-application received</p>
          </div>
        </div>
      </div>
    );
  }

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
            {firstName
              ? `${firstName}, let's re-apply for ${yearName}.`
              : `Let's re-apply for ${yearName}.`}
          </h1>
          <p className="text-muted-foreground text-sm mt-3 max-w-lg mx-auto">
            Most of your information carries forward from last year. You only
            need to review what&rsquo;s changed and re-submit your
            Opportunity Scholarship application.
          </p>
        </div>

        <div className="rounded-xl bg-background p-1.5 shadow-sm border">
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <tbody className="divide-y">
                {STEPS.map((step, idx) => {
                  const isComplete = !!progress?.[step.key];
                  return (
                    <tr
                      key={step.segment}
                      className="transition-colors cursor-pointer hover:bg-muted/30"
                      onClick={() =>
                        router.push(`/reapply/year/${yearId}/${step.segment}`)
                      }
                    >
                      <td className="px-4 py-4 w-12">
                        <StepCircle number={idx + 1} complete={isComplete} />
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

                {/* Submit row */}
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
                      Submit Re-Application
                      <span className="ml-1.5 text-white/70 text-xs font-normal">
                        ({completedCount}/{STEPS.length})
                      </span>
                    </p>
                    {!allReady && (
                      <p className="text-xs text-white/70 mt-0.5">
                        Click to review what&rsquo;s left.
                      </p>
                    )}
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
      </div>

      <ReapplyPreSubmitModal
        open={submitOpen}
        onOpenChange={setSubmitOpen}
        yearId={yearId}
      />
    </div>
  );
}

function StepCircle({ number, complete }: { number: number; complete: boolean }) {
  if (complete) {
    return (
      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-green-500 text-white">
        <CheckCircle2 className="size-4" />
      </div>
    );
  }
  return (
    <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground text-xs font-semibold">
      {number}
    </div>
  );
}

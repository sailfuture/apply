"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useReapplyFamilyProgress } from "@/hooks/use-reapply-family-progress";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  yearId: number;
  /** Opens the pre-submit review modal owned by the layout. */
  onSubmitClick?: () => void;
}

interface StepDef {
  segment: string;
  label: string;
  isComplete: boolean;
}

/**
 * Sidenav for the re-application flow. Mirrors the apply-flow sidenav in
 * shape but tracks the four bools on `reapply_family_progress` instead of
 * the application progress row. The submit button at the bottom always
 * opens the pre-submit review modal regardless of section state — the
 * modal itself decides whether the family is ready to submit.
 */
export function ReapplySideNav({ yearId, onSubmitClick }: Props) {
  const pathname = usePathname();
  const { progress, loading } = useReapplyFamilyProgress(yearId);

  const base = `/reapply/year/${yearId}`;
  const currentSegment = pathname
    .replace(base, "")
    .replace(/^\//, "")
    .split("/")[0];

  const steps: StepDef[] = [
    {
      segment: "family",
      label: "Family Details",
      isComplete: !!progress?.isFamilyDetails,
    },
    {
      segment: "students",
      label: "Student Details",
      isComplete: !!progress?.isStudentDetails,
    },
    {
      segment: "scholarship",
      label: "Opportunity Scholarship",
      isComplete: !!progress?.isScholarship,
    },
    {
      segment: "transportation",
      label: "Transportation",
      isComplete: !!progress?.isTransportation,
    },
  ];

  const completedCount = steps.filter((s) => s.isComplete).length;

  return (
    <aside className="w-72 shrink-0 border-r bg-background hidden xl:block">
      <div className="sticky top-26 flex flex-col">
        <div className="px-3 py-4 border-b">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-3">
            Re-Application
          </p>
        </div>

        <nav className="flex flex-col py-2">
          {loading
            ? Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-3">
                  <Skeleton className="size-8 rounded-full" />
                  <Skeleton className="h-4 w-24" />
                </div>
              ))
            : steps.map((step, i) => {
                const href = `${base}/${step.segment}`;
                const isActive = currentSegment === step.segment;
                return (
                  <Link
                    key={step.segment}
                    href={href}
                    className={cn(
                      "flex w-full items-center gap-3 px-3 py-3 text-left text-sm transition-colors",
                      isActive
                        ? "bg-muted/40 hover:bg-muted/60"
                        : "hover:bg-muted/30"
                    )}
                  >
                    <StepCircle number={i + 1} complete={step.isComplete} active={isActive} />
                    <span className="truncate font-medium">{step.label}</span>
                  </Link>
                );
              })}
        </nav>

        <div className="px-3 mt-2">
          <button
            type="button"
            onClick={() => onSubmitClick?.()}
            className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-md cursor-pointer transition-colors"
          >
            <span className="font-medium">
              Submit Re-Application
              <span className="ml-1.5 text-white/70 text-xs font-normal">
                ({completedCount}/{steps.length})
              </span>
            </span>
          </button>
        </div>
      </div>
    </aside>
  );
}

function StepCircle({
  number,
  complete,
  active,
}: {
  number: number;
  complete: boolean;
  active: boolean;
}) {
  if (complete) {
    return (
      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-green-500 text-white">
        <CheckCircle2 className="size-4" />
      </div>
    );
  }
  return (
    <div
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
        active
          ? "bg-blue-600 text-white"
          : "bg-muted text-muted-foreground"
      )}
    >
      {number}
    </div>
  );
}

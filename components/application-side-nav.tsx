"use client";

import { usePathname, useRouter } from "next/navigation";
import { useApplicationSteps, type StepStatus } from "@/hooks/use-application-steps";
import { useApplicationFlow } from "@/contexts/application-flow-context";
import { Mail, Phone, HelpCircle, ArrowLeft } from "lucide-react";

/* Short labels for the side nav — keeps everything single-line */
const SHORT_LABELS: Record<string, string> = {
  "Your Family Information": "Family",
  "Student Enrollment Information": "Students",
  "Financial Aid Application": "Financial Aid",
  "Review Tuition & Scholarship Award": "Tuition",
  "Sign Enrollment Agreement": "Enrollment",
  "Begin Registration Process": "Registration",
  "Submit Registration": "Submit",
  "Submit Application": "Submit",
};

/* Registration page segments */
const REGISTRATION_SEGMENTS = new Set(["tuition", "enrollment-signing", "registration"]);

/* Segment → step number maps */
const APPLICATION_SEGMENT_MAP: Record<string, number> = {
  family: 1,
  students: 2,
  scholarship: 3,
  nwea: 3,
  sufs: 3,
  submit: -1,
};

const REGISTRATION_SEGMENT_MAP: Record<string, number> = {
  tuition: 1,
  "enrollment-signing": 2,
  registration: 3,
};

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
    <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground text-xs font-semibold">
      {number}
    </div>
  );
}

export function ApplicationSideNav({ yearId }: { yearId: number }) {
  const pathname = usePathname();
  const router = useRouter();
  const { hideChrome } = useApplicationFlow();
  const { steps, registrationSteps, stepsLoading } = useApplicationSteps(yearId);

  // Count completed registration steps (excluding submit)
  const regStepsExcludingSubmit = registrationSteps.filter((s) => s.title !== "Submit Registration");
  const regCompletedCount = regStepsExcludingSubmit.filter((s) => s.status === "complete").length;
  const regTotalCount = regStepsExcludingSubmit.length;

  const basePath = `/apply/year/${yearId}`;
  const isOverview = pathname === basePath || pathname === `${basePath}/`;

  if (isOverview || hideChrome) return null;

  const currentSegment = pathname.replace(basePath, "").replace(/^\//, "").split("/")[0] || "";

  // Determine which step set to show based on current page
  const isRegistrationPage = REGISTRATION_SEGMENTS.has(currentSegment);
  const activeSteps = isRegistrationPage ? registrationSteps : steps;
  const segmentMap = isRegistrationPage ? REGISTRATION_SEGMENT_MAP : APPLICATION_SEGMENT_MAP;
  const activeStepNumber = segmentMap[currentSegment] ?? -1;

  return (
    <aside className="hidden xl:block w-[220px] shrink-0">
      <div className="sticky top-20">
        {/* Steps */}
        <div className="rounded-xl bg-background p-1.5 shadow-sm border">
          <div className="overflow-hidden rounded-lg border">
            <div className="divide-y">
              {/* Dashboard row */}
              <button
                onClick={() => router.push(basePath)}
                className="flex w-full items-center gap-3 px-3 py-3 text-left text-sm transition-colors hover:bg-muted/30"
              >
                <div className="flex size-6 shrink-0 items-center justify-center rounded-full border-2 border-muted-foreground/30 text-muted-foreground">
                  <ArrowLeft className="size-3" />
                </div>
                <span className="truncate font-medium text-muted-foreground">Dashboard</span>
              </button>
              {stepsLoading
                ? Array.from({ length: activeSteps.length || 3 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3 px-3 py-3">
                      <div className="size-8 rounded-full bg-muted animate-pulse" />
                      <div className="h-4 w-20 rounded bg-muted animate-pulse" />
                    </div>
                  ))
                : activeSteps.map((step) => {
                    const isActive = step.number === activeStepNumber;
                    const isComplete = step.status === "complete";
                    const isSubmit = step.title === "Submit Registration" || step.title === "Submit Application";
                    const label = SHORT_LABELS[step.title] ?? step.title;

                    if (isSubmit) {
                      return (
                        <div
                          key={step.number}
                          className={`flex w-full items-center gap-3 px-3 py-3 text-left text-sm transition-colors ${
                            step.status === "not_started"
                              ? "bg-blue-600/40 cursor-not-allowed"
                              : "bg-blue-600 hover:bg-blue-700 cursor-pointer"
                          }`}
                        >
                          <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-white/20">
                            <svg className="size-3 text-white" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M3 10a.75.75 0 01.75-.75h10.638L10.23 5.29a.75.75 0 111.04-1.08l5.5 5.25a.75.75 0 010 1.08l-5.5 5.25a.75.75 0 11-1.04-1.08l4.158-3.96H3.75A.75.75 0 013 10z" clipRule="evenodd" />
                            </svg>
                          </div>
                          <span className="truncate font-medium text-white">
                            {label}
                            <span className="ml-1.5 text-white/70 text-xs font-normal">
                              ({activeSteps.filter((s) => s.status === "complete" && s.title !== "Submit Registration" && s.title !== "Submit Application").length}/{activeSteps.filter((s) => s.title !== "Submit Registration" && s.title !== "Submit Application").length})
                            </span>
                          </span>
                        </div>
                      );
                    }

                    return (
                      <button
                        key={step.number}
                        onClick={() => router.push(step.href)}
                        className={`flex w-full items-center gap-3 px-3 py-3 text-left text-sm transition-colors ${
                          isActive
                            ? "bg-muted/40 hover:bg-muted/60"
                            : "hover:bg-muted/30"
                        }`}
                      >
                        <StepCircle number={step.number} status={step.status} />
                        <span className={`truncate ${isActive ? "font-semibold text-foreground" : "font-medium text-muted-foreground"}`}>
                          {label}
                        </span>
                      </button>
                    );
                  })}
            </div>
          </div>
        </div>

        {/* Support Section */}
        <div className="mt-4 rounded-xl bg-background p-4 shadow-sm border">
          <p className="text-sm font-medium text-foreground mb-3">Need extra support?</p>
          <div className="space-y-1.5">
            <a
              href="mailto:admissions@sailfuture.org"
              className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
            >
              <Mail className="size-4 shrink-0" />
              <span>Email Support</span>
            </a>
            <a
              href="tel:+17279001436"
              className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
            >
              <Phone className="size-4 shrink-0" />
              <span>Call Us</span>
            </a>
            <a
              href="https://sailfutureacademy.org"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
            >
              <HelpCircle className="size-4 shrink-0" />
              <span>Help Center</span>
            </a>
          </div>
        </div>
      </div>
    </aside>
  );
}

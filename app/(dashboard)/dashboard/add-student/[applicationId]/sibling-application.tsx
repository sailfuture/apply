"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, CheckCircle2, Clock, Loader2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { NweaBookingDialog } from "@/components/nwea-booking-dialog";
import { FinancialAidStep } from "@/components/financial-aid-step";
import {
  ApplicationFlowProvider,
  useApplicationFlow,
} from "@/contexts/application-flow-context";
import { mutateApplications } from "@/hooks/use-api";
import { additionStage, isReturnedAddition } from "@/lib/midyear-additions";
import { SiblingRegistration, type SiblingBillingFields } from "./sibling-registration";
import { formatTimestampUs } from "@/lib/us-date";
import {
  NweaTestingCard,
  StudentDetailsCard,
  type BusStop,
  type StudentApplicationFields,
} from "./student-application-cards";

/**
 * Application for a sibling added mid-year by an already-enrolled,
 * non-residential family (`is_midyear_addition`, created by
 * `/api/student-additions`). The same three application steps a family
 * completes when applying — Student Details, Financial Aid, NWEA
 * testing — for this one student, then "Submit for Admissions Review".
 *
 * Financial Aid renders the real apply-flow step (`FinancialAidStep`)
 * in its mid-year mode: the family's Opportunity Scholarship and every
 * student's SUFS card exactly as a two-student application shows them,
 * with only the new student's Award ID editable and completion kept on
 * this application rather than the family's progress row.
 *
 * Nothing here touches the family's year-level progress — the rest of
 * the family stays enrolled throughout (see `lib/midyear-additions.ts`).
 * Once submitted the page is read-only until admin accepts the student.
 */

export interface SiblingApp
  extends StudentApplicationFields,
    SiblingBillingFields {
  id: number;
  registration_students_id: number;
  registration_school_years_id: number;
  addition_financial_aid_completed?: boolean;
  addition_submitted_at?: number | null;
}

type Step = "details" | "financial-aid" | "testing";

const STEPS: { key: Step; label: string }[] = [
  { key: "details", label: "Student Details" },
  { key: "financial-aid", label: "Financial Aid" },
  { key: "testing", label: "Initial Testing" },
];

export function SiblingApplication({
  initialApp,
  studentName,
  busStops,
  hasPacket,
}: {
  initialApp: SiblingApp;
  studentName: string;
  busStops: BusStop[];
  hasPacket: boolean;
}) {
  const [app, setApp] = useState<SiblingApp>(initialApp);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);

  function setField<K extends keyof StudentApplicationFields>(
    key: K,
    value: StudentApplicationFields[K]
  ) {
    setApp((prev) => ({ ...prev, [key]: value }));
  }

  const detailsComplete = useMemo(() => {
    const filled = (v: string) => !!v && v.trim().length > 0;
    return (
      filled(app.current_previous_school) &&
      filled(app.last_grade_completed) &&
      filled(app.current_grade) &&
      filled(app.describe_student_strengths) &&
      filled(app.describe_student_opportunities_for_growth) &&
      (!app.is_bus_transportation || filled(app.bus_stop))
    );
  }, [app]);
  const financialAidComplete = app.addition_financial_aid_completed === true;
  const testingComplete = !!(
    app.nwea_testing_scheduled || app.nwea_testing_complete
  );
  const stepComplete: Record<Step, boolean> = {
    details: detailsComplete,
    "financial-aid": financialAidComplete,
    testing: testingComplete,
  };

  // Land on the first unfinished step; the parent can jump around from
  // the step list after that.
  const [step, setStep] = useState<Step>(
    () => STEPS.find((s) => !stepComplete[s.key])?.key ?? "testing"
  );
  function goTo(next: Step) {
    setStep(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // Student Details + NWEA live on the application row and save through
  // the parent allowlist. The SUFS Award ID is NOT sent from here — the
  // Financial Aid step saves it on blur from its own copy.
  async function saveFields(): Promise<boolean> {
    const res = await fetch(`/api/applications/${app.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        current_previous_school: app.current_previous_school,
        last_grade_completed: app.last_grade_completed,
        current_grade: app.current_grade,
        describe_student_strengths: app.describe_student_strengths,
        describe_student_opportunities_for_growth:
          app.describe_student_opportunities_for_growth,
        is_bus_transportation: app.is_bus_transportation,
        bus_stop: app.is_bus_transportation ? app.bus_stop : "",
        nwea_testing_scheduled: !!app.nwea_testing_scheduled,
        nwea_testing_complete: !!app.nwea_testing_complete,
      }),
    });
    return res.ok;
  }

  async function handleSave(next?: Step) {
    if (saving || submitting) return;
    setSaving(true);
    try {
      if (!(await saveFields())) throw new Error("save failed");
      if (next) goTo(next);
      else toast.success("Progress saved.");
    } catch {
      toast.error("Couldn't save. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function setFinancialAidCompleted(completed: boolean) {
    const res = await fetch(`/api/student-additions/${app.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ financialAidCompleted: completed }),
    });
    if (!res.ok) {
      toast.error("Couldn't save. Please try again.");
      throw new Error(`financial aid ${res.status}`);
    }
    setApp((prev) => ({ ...prev, addition_financial_aid_completed: completed }));
  }

  async function handleSubmit() {
    if (saving || submitting) return;
    if (!detailsComplete || !financialAidComplete || !testingComplete) {
      toast.error("Please complete every step before submitting.");
      return;
    }
    setSubmitting(true);
    try {
      if (!(await saveFields())) throw new Error("save failed");
      const res = await fetch(`/api/student-additions/${app.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submit: true }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Couldn't submit. Please try again.");
      // Refresh the dashboard's applications cache before the parent
      // heads back, so the pending row already reads "In admissions
      // review" when they get there.
      await mutateApplications();
      setApp((prev) => ({
        ...prev,
        addition_submitted_at: body?.addition_submitted_at || Date.now(),
      }));
      window.scrollTo({ top: 0, behavior: "smooth" });
      toast.success("Application submitted.");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't submit. Please try again."
      );
    } finally {
      setSubmitting(false);
    }
  }

  const stage = additionStage(app, hasPacket);

  if (stage === "registration") {
    return (
      <PageShell>
        <div>
          <BackToDashboard />
          <h1 className="text-2xl font-semibold mt-4">
            Register {studentName}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {studentName} has been accepted. Sign their tuition, enrollment
            agreement and liability waiver, then complete and submit their
            registration packet.
          </p>
        </div>
        <SiblingRegistration app={app} studentName={studentName} />
      </PageShell>
    );
  }

  if (stage === "review") {
    return (
      <PageShell>
        <div>
          <BackToDashboard />
          <h1 className="text-2xl font-semibold mt-4">{studentName}</h1>
        </div>
        <Card className="overflow-hidden gap-0 py-0">
          <CardContent className="flex items-start gap-3 py-5 bg-white dark:bg-background">
            <Clock className="size-5 text-amber-500 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-medium">In admissions review</p>
              <p className="text-sm text-muted-foreground">
                You submitted {studentName}&rsquo;s application
                {app.addition_submitted_at
                  ? ` on ${formatTimestampUs(app.addition_submitted_at)}`
                  : ""}
                . Our admissions team is reviewing it and will email you
                with next steps. Your other students stay enrolled in the
                meantime.
              </p>
            </div>
          </CardContent>
        </Card>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <div>
        <BackToDashboard />
        <h1 className="text-2xl font-semibold mt-4">Apply for {studentName}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Complete these three steps, then submit {studentName}&rsquo;s
          application for admissions review. Your other students stay
          enrolled while it&rsquo;s reviewed.
        </p>
      </div>

      {isReturnedAddition(app) ? (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <Undo2 className="size-4 shrink-0 mt-0.5" />
          <span>
            Our admissions team sent this application back for a few
            changes — check your email for their note, update it, and submit
            it again.
          </span>
        </div>
      ) : null}

      <ol className="grid gap-2 sm:grid-cols-3">
        {STEPS.map((s, i) => {
          const active = s.key === step;
          const done = stepComplete[s.key];
          return (
            <li key={s.key}>
              <button
                type="button"
                onClick={() => goTo(s.key)}
                className={`flex w-full items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
                  active
                    ? "border-primary bg-primary/5 font-medium"
                    : "bg-white hover:bg-muted/30"
                }`}
              >
                {done ? (
                  <CheckCircle2 className="size-4 text-green-600 shrink-0" />
                ) : (
                  <span className="flex size-4 shrink-0 items-center justify-center rounded-full border text-[10px] text-muted-foreground">
                    {i + 1}
                  </span>
                )}
                <span className="truncate">{s.label}</span>
              </button>
            </li>
          );
        })}
      </ol>

      {step === "details" ? (
        <>
          <StudentDetailsCard app={app} setField={setField} busStops={busStops} />
          <div className="flex items-center justify-end gap-3">
            <Button
              variant="outline"
              className="bg-white"
              onClick={() => handleSave()}
              disabled={saving}
            >
              Save for Later
            </Button>
            <Button onClick={() => handleSave("financial-aid")} disabled={saving}>
              {saving ? "Saving…" : "Continue"}
              <ArrowRight className="size-4 ml-1.5" />
            </Button>
          </div>
        </>
      ) : null}

      {step === "financial-aid" ? (
        // Its own flow provider: the step registers its Complete-section
        // handler + options there, and FinancialAidFooter renders them
        // the way the apply layout's bottom bar does.
        <ApplicationFlowProvider>
          <DimWhenCompleted>
            <FinancialAidStep
              yearId={app.registration_school_years_id}
              addition={{
                applicationId: app.id,
                completed: financialAidComplete,
                onCompletedChange: setFinancialAidCompleted,
              }}
            />
          </DimWhenCompleted>
          <FinancialAidFooter
            onBack={() => goTo("details")}
            onContinue={() => goTo("testing")}
            canContinue={financialAidComplete}
          />
        </ApplicationFlowProvider>
      ) : null}

      {step === "testing" ? (
        <>
          <NweaTestingCard
            app={app}
            setField={setField}
            onSchedule={() => setScheduleDialogOpen(true)}
          />
          {!(detailsComplete && financialAidComplete) ? (
            <p className="text-sm text-muted-foreground">
              Still to finish before you can submit:{" "}
              {[
                !detailsComplete ? "Student Details" : null,
                !financialAidComplete ? "Financial Aid" : null,
              ]
                .filter(Boolean)
                .join(" and ")}
              .
            </p>
          ) : null}
          <div className="flex flex-wrap items-center justify-end gap-3">
            <Button
              variant="outline"
              className="bg-white mr-auto"
              onClick={() => goTo("financial-aid")}
              disabled={saving || submitting}
            >
              <ArrowLeft className="size-4 mr-1.5" />
              Back
            </Button>
            <Button
              variant="outline"
              className="bg-white"
              onClick={() => handleSave()}
              disabled={saving || submitting}
            >
              Save for Later
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={
                saving ||
                submitting ||
                !detailsComplete ||
                !financialAidComplete ||
                !testingComplete
              }
            >
              {submitting ? "Submitting…" : "Submit for Admissions Review"}
            </Button>
          </div>
        </>
      ) : null}

      <NweaBookingDialog
        open={scheduleDialogOpen}
        onOpenChange={setScheduleDialogOpen}
      />
    </PageShell>
  );
}

function PageShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col gap-6 p-6 mx-auto w-full max-w-4xl">
      {children}
    </div>
  );
}

function BackToDashboard() {
  const router = useRouter();
  return (
    <Button
      variant="outline"
      size="sm"
      className="bg-white w-fit"
      onClick={() => router.push("/dashboard")}
    >
      <ArrowLeft className="size-3.5 mr-1.5" />
      Back to dashboard
    </Button>
  );
}

/** Same lock treatment as the apply layout: a completed section is
 *  dimmed and fully non-interactive until it's unlocked. */
function DimWhenCompleted({ children }: { children: ReactNode }) {
  const { saveOptions } = useApplicationFlow();
  return (
    <div
      className={
        saveOptions.completed ? "opacity-50 pointer-events-none select-none" : ""
      }
      aria-disabled={saveOptions.completed || undefined}
    >
      {children}
    </div>
  );
}

/**
 * The Financial Aid step's actions — mirrors the apply layout's bottom
 * bar (Complete section / Completed, click to edit) plus this flow's
 * Back and Continue.
 */
function FinancialAidFooter({
  onBack,
  onContinue,
  canContinue,
}: {
  onBack: () => void;
  onContinue: () => void;
  canContinue: boolean;
}) {
  const { saveHandler, saveOptions, onBack: stepBack } = useApplicationFlow();
  const [pressing, setPressing] = useState(false);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const busy = pressing || !!saveOptions.saving;

  async function handleComplete() {
    if (!saveHandler) return;
    setPressing(true);
    try {
      await saveHandler();
    } catch {
      // Validation / save failed — the step already toasted why.
    } finally {
      setPressing(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 border-t pt-6">
        <Button
          variant="outline"
          className="bg-white"
          // Inside the full Opportunity Scholarship form, Back returns to
          // the path chooser first (the step registers that handler).
          onClick={() => (stepBack ? stepBack() : onBack())}
        >
          <ArrowLeft className="size-4 mr-1.5" />
          Back
        </Button>
        <div className="flex-1" />
        {saveOptions.completed ? (
          <Button
            variant="outline"
            className="bg-white"
            onClick={() => saveOptions.onUnlock && setUnlockOpen(true)}
          >
            <CheckCircle2 className="size-4 text-green-600 mr-1.5" />
            {saveOptions.completedLabel ?? "Section Completed"}
            <span className="ml-1.5 text-xs font-normal text-muted-foreground">
              (Click to Edit)
            </span>
          </Button>
        ) : saveOptions.label ? (
          <Button
            variant={saveOptions.disabled ? "outline" : "default"}
            onClick={saveHandler && !saveOptions.disabled ? handleComplete : undefined}
            disabled={saveHandler ? saveOptions.disabled || busy : false}
          >
            {busy ? (
              <>
                <Loader2 className="size-4 mr-1.5 animate-spin" />
                {saveOptions.saving ? "Saving..." : "Working..."}
              </>
            ) : (
              saveOptions.label
            )}
          </Button>
        ) : null}
        <Button onClick={onContinue} disabled={!canContinue}>
          Continue
          <ArrowRight className="size-4 ml-1.5" />
        </Button>
      </div>

      <AlertDialog open={unlockOpen} onOpenChange={setUnlockOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Edit financial aid?</AlertDialogTitle>
            <AlertDialogDescription>
              You&rsquo;ll need to mark this section complete again before
              submitting the application.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                saveOptions.onUnlock?.();
                setUnlockOpen(false);
              }}
            >
              Yes, Edit
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

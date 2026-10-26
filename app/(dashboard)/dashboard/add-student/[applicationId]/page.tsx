"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ServiceUnavailable } from "@/components/service-unavailable";
import { NweaBookingDialog } from "@/components/nwea-booking-dialog";
import { apiFetch } from "@/hooks/use-api";
import { ArrowLeft, ArrowRight, ExternalLink } from "lucide-react";
import { isMidYearAddition } from "@/lib/midyear-additions";
import { ResidentialPacketForm } from "./residential-packet-form";
import { SiblingApplication } from "./sibling-application";
import {
  NweaTestingCard,
  StudentDetailsCard,
  type BusStop,
  type SetField,
} from "./student-application-cards";

const STEP_UP_URL = "https://www.stepupforstudents.org/scholarships/logins/";

/**
 * Per-student mid-year flow for a student added from the enrolled-family
 * dashboard's "Add Student". Sibling additions (`is_midyear_addition`)
 * render `SiblingApplication` — application, admissions review, then
 * registration for that one student. Everything below describes the
 * residential / foster placement flow.
 *
 * Per-student mid-year registration flow for residential / foster
 * families. Reached from the enrolled-family dashboard's "Create New
 * Registration" button, which creates the student + a marked
 * (`is_residential_addition`) application and routes here with that
 * application's id.
 *
 * Scoped to ONE student's application — it never touches the family's
 * year-level progress rows, so completing it can't disturb the rest of
 * the family's enrolled state. Captures Student Details (school history,
 * strengths/growth, transport), the Step Up For Students (SUFS) Award ID,
 * and NWEA initial-testing scheduling. Submitting auto-accepts and
 * creates the registration packet right away (residential families
 * enroll placements directly — no admissions-review queue); admin's
 * final `registrationConfirmed` on the completed packet is what folds
 * the student into the enrolled roster. The Opportunity Scholarship and
 * tuition / enrollment-signing steps are skipped — funding for these
 * placements is external.
 */
interface AppRow {
  id: number;
  registration_students_id: number;
  registration_school_years_id: number;
  current_previous_school: string;
  last_grade_completed: string;
  current_grade: string;
  describe_student_strengths: string;
  describe_student_opportunities_for_growth: string;
  is_bus_transportation: boolean;
  bus_stop: string;
  sufs_award_id?: number;
  nwea_testing_scheduled?: boolean;
  nwea_testing_complete?: boolean;
  is_residential_addition?: boolean;
  is_midyear_addition?: boolean;
  addition_financial_aid_completed?: boolean;
  addition_submitted_at?: number | null;
}

interface StudentRow {
  id: number;
  first_name: string;
  last_name: string;
}


export default function AddStudentRegistrationPage() {
  const params = useParams();
  const router = useRouter();
  const appId = Number(params.applicationId);

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  // The load threw, or an endpoint answered non-2xx other than the 404
  // that means "not found". Rendered as the retry card; bumping
  // `loadAttempt` re-runs the load effect below.
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [app, setApp] = useState<AppRow | null>(null);
  const [student, setStudent] = useState<StudentRow | null>(null);
  const [busStops, setBusStops] = useState<BusStop[]>([]);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  /**
   * Whether this student already has a registration packet.
   *
   * This is the durable "has registration started?" signal, NOT the
   * application's `isAccepted`: `registration_application` has no
   * isAccepted / isSubmitted / isOffered / isDenied columns in Xano,
   * so writing them returns 200 and persists nothing. Reading them
   * back always gave undefined, which is why this page kept offering
   * "Create Registration Packet" after the packet had been made.
   * The packet row is real, so we ask about that instead.
   */
  const [hasPacket, setHasPacket] = useState(false);
  /** Packet form is showing (created just now, or Continue clicked). */
  const [showPacket, setShowPacket] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // `apiFetch` retries a 401 once after refreshing the Clerk
        // token (a cold load can race that refresh).
        const [appRes, studentsRes, busRes] = await Promise.all([
          apiFetch(`/api/applications/${appId}`),
          apiFetch(`/api/students`),
          apiFetch(`/api/bus-stops`),
        ]);
        if (appRes.status === 404) {
          if (!cancelled) setNotFound(true);
          return;
        }
        // Any other non-2xx is an outage, not a missing row — the catch
        // below renders the retry card instead of "not found".
        if (!appRes.ok) throw new Error(`API error ${appRes.status}`);
        const appData = await appRes.json();
        // Only mid-year additions belong in this flow. A normal
        // application landing here is a mistake — bounce to the
        // dashboard rather than letting the parent edit it out of band.
        if (!isMidYearAddition(appData)) {
          if (!cancelled) {
            router.replace("/dashboard");
          }
          return;
        }
        const students: StudentRow[] = studentsRes.ok
          ? await studentsRes.json()
          : [];
        const stops: BusStop[] = busRes.ok ? await busRes.json() : [];
        if (cancelled) return;
        setApp({
          ...appData,
          current_previous_school: appData.current_previous_school ?? "",
          last_grade_completed: appData.last_grade_completed ?? "",
          current_grade: appData.current_grade ?? "",
          describe_student_strengths: appData.describe_student_strengths ?? "",
          describe_student_opportunities_for_growth:
            appData.describe_student_opportunities_for_growth ?? "",
          is_bus_transportation: !!appData.is_bus_transportation,
          bus_stop: appData.bus_stop ?? "",
          sufs_award_id: appData.sufs_award_id ?? 0,
          nwea_testing_scheduled: !!appData.nwea_testing_scheduled,
          nwea_testing_complete: !!appData.nwea_testing_complete,
        });
        setStudent(
          students.find(
            (s) => s.id === Number(appData.registration_students_id)
          ) ?? null
        );
        setBusStops(stops);

        // Does a packet already exist for this student + year? Answers
        // "created" vs "not yet" durably, where the application's own
        // decision flags can't (see `hasPacket`). Best-effort: a failed
        // lookup leaves the page offering Create, which is recoverable
        // — the create path resolves an existing packet rather than
        // duplicating it.
        try {
          const pktRes = await apiFetch(
            `/api/student-registration?studentId=${Number(
              appData.registration_students_id
            )}`
          );
          if (pktRes.ok) {
            const pkt = await pktRes.json().catch(() => null);
            const match =
              pkt &&
              Number(pkt.registration_school_years_id) ===
                Number(appData.registration_school_years_id);
            if (!cancelled && match) setHasPacket(true);
          }
        } catch (err) {
          console.error("Packet lookup failed:", err);
        }
      } catch (err) {
        console.error("Failed to load registration:", err);
        if (!cancelled) setLoadFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [appId, router, loadAttempt]);

  function setField<K extends keyof AppRow>(key: K, value: AppRow[K]) {
    setApp((prev) => (prev ? { ...prev, [key]: value } : prev));
  }
  // The shared cards edit a subset of the row.
  const setCardField: SetField = (key, value) =>
    setApp((prev) => (prev ? { ...prev, [key]: value } : prev));

  const isComplete = useMemo(() => {
    if (!app) return false;
    const nonEmpty = (v: string) => !!v && v.trim().length > 0;
    if (!nonEmpty(app.current_previous_school)) return false;
    if (!nonEmpty(app.last_grade_completed)) return false;
    if (!nonEmpty(app.current_grade)) return false;
    if (!nonEmpty(app.describe_student_strengths)) return false;
    if (!nonEmpty(app.describe_student_opportunities_for_growth)) return false;
    if (app.is_bus_transportation && !nonEmpty(app.bus_stop)) return false;
    // NWEA initial testing must be scheduled. SUFS Award ID is optional —
    // the state may not have issued it by the time a placement arrives.
    if (!(app.nwea_testing_scheduled || app.nwea_testing_complete)) return false;
    return true;
  }, [app]);

  async function saveFields(): Promise<boolean> {
    if (!app) return false;
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
        sufs_award_id: app.sufs_award_id ?? 0,
        nwea_testing_scheduled: !!app.nwea_testing_scheduled,
        nwea_testing_complete: !!app.nwea_testing_complete,
      }),
    });
    return res.ok;
  }

  async function handleSave() {
    if (saving || submitting) return;
    setSaving(true);
    try {
      if (!(await saveFields())) throw new Error("save failed");
      toast.success("Progress saved.");
    } catch {
      toast.error("Couldn't save. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmit() {
    if (saving || submitting || !app) return;
    if (!isComplete) {
      toast.error("Please complete all required fields before submitting.");
      return;
    }
    setSubmitting(true);
    try {
      if (!(await saveFields())) throw new Error("save failed");
      const res = await fetch(`/api/residential-students/${app.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) throw new Error("submit failed");
      // Residential submissions create the packet server-side — stay
      // on this page and show it, instead of bouncing to the dashboard.
      setHasPacket(true);
      setShowPacket(true);
      toast.success("Registration packet created — complete it below.");
    } catch {
      toast.error("Couldn't submit. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const studentName = student
    ? `${student.first_name} ${student.last_name}`.trim()
    : "New Student";

  if (loading) {
    return (
      <div className="flex flex-1 flex-col gap-6 p-6 mx-auto w-full max-w-4xl">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-8 w-2/3" />
        <div className="rounded-lg border p-6 space-y-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i}>
              <Skeleton className="h-3 w-24 mb-2" />
              <Skeleton className="h-9 w-full rounded-md" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (loadFailed) {
    return (
      <ServiceUnavailable
        onRetry={() => {
          setLoadFailed(false);
          setLoading(true);
          setLoadAttempt((n) => n + 1);
        }}
      />
    );
  }

  if (notFound || !app) {
    return (
      <div className="flex flex-1 flex-col gap-4 p-6 mx-auto w-full max-w-4xl">
        <BackToDashboard />
        <div className="rounded-lg border bg-white px-6 py-12 text-center text-sm text-muted-foreground">
          We couldn&rsquo;t find this registration. It may have been removed.
        </div>
      </div>
    );
  }

  // A sibling added by a non-residential family goes through the full
  // application → admissions review path for this one student.
  if (app.is_midyear_addition === true) {
    return (
      <SiblingApplication
        initialApp={app}
        studentName={studentName}
        busStops={busStops}
        hasPacket={hasPacket}
      />
    );
  }

  // Packet open — the parent completes this student's registration.
  // Driven by `showPacket` (set on create, or by Continue below) rather
  // than an application flag, so it survives a reload.
  if (showPacket) {
    return (
      <div className="flex flex-1 flex-col gap-6 p-6 mx-auto w-full max-w-4xl">
        <Button
          variant="outline"
          size="sm"
          className="bg-white w-fit"
          onClick={() => setShowPacket(false)}
        >
          <ArrowLeft className="size-3.5 mr-1.5" />
          Back to student details
        </Button>
        <ResidentialPacketForm
          studentId={app.registration_students_id}
          yearId={app.registration_school_years_id}
          registrationTypeId={1}
          studentName={studentName}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-6 mx-auto w-full max-w-4xl">
      <div>
        <BackToDashboard />
        <h1 className="text-2xl font-semibold mt-4">
          Register {studentName}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Complete this student&rsquo;s information, then create their
          registration packet. They&rsquo;ll join your enrolled students once
          the packet is confirmed.
        </p>
      </div>

      <StudentDetailsCard app={app} setField={setCardField} busStops={busStops} />

      {/* Step Up For Students (SUFS) — capture the per-student Award ID.
          The Opportunity Scholarship is intentionally skipped for these
          externally-funded placements. */}
      <Card className="overflow-hidden gap-0 py-0">
        <CardHeader className="py-3 !pb-3 border-b">
          <CardTitle className="text-base">
            Step Up For Students (SUFS) Award
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 py-5 bg-white dark:bg-background">
          <p className="text-sm text-muted-foreground">
            If this student has a Step Up For Students scholarship, enter their
            9-digit Award ID. Don&rsquo;t have one yet? Apply through Step Up
            below.
          </p>
          <Button
            type="button"
            variant="outline"
            className="bg-white"
            onClick={() =>
              window.open(STEP_UP_URL, "_blank", "noopener,noreferrer")
            }
          >
            <ExternalLink className="size-4 mr-1.5 shrink-0" />
            Apply for the Step Up for Students Scholarship
          </Button>
          <Field>
            <FieldLabel className="text-xs">
              SUFS Award ID{" "}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </FieldLabel>
            <Input
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={9}
              placeholder="000000000"
              value={app.sufs_award_id || ""}
              onChange={(e) => {
                const digits = e.target.value.replace(/\D/g, "").slice(0, 9);
                setField("sufs_award_id", digits === "" ? 0 : Number(digits));
              }}
            />
            <p className="text-xs text-muted-foreground mt-1.5">
              Enter the 9-digit Award ID from your Step Up For Students parent
              portal (under your student&rsquo;s scholarship details).
            </p>
          </Field>
        </CardContent>
      </Card>

      {/* Initial Testing (NWEA) — standard scheduling flow: book a slot via
          the Google Calendar dialog, then confirm. */}
      <NweaTestingCard
        app={app}
        setField={setCardField}
        onSchedule={() => setScheduleDialogOpen(true)}
      />

      <div className="flex items-center justify-end gap-3">
        <Button variant="outline" onClick={handleSave} disabled={saving || submitting}>
          {saving ? "Saving…" : "Save for Later"}
        </Button>
        {/* Once the packet exists this becomes the way back into it —
            creating a second one isn't a thing that can happen, and
            offering "Create" again read as though the first attempt
            hadn't worked. */}
        {hasPacket ? (
          <Button onClick={() => setShowPacket(true)} disabled={saving}>
            Continue Registration
            <ArrowRight className="size-4 ml-1.5" />
          </Button>
        ) : (
          <Button onClick={handleSubmit} disabled={submitting || saving}>
            {submitting ? "Creating…" : "Create Registration Packet"}
          </Button>
        )}
      </div>

      {/* NWEA scheduling — embeds the Google Calendar booking flow. */}
      <NweaBookingDialog
        open={scheduleDialogOpen}
        onOpenChange={setScheduleDialogOpen}
      />
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

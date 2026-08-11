"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { NweaBookingDialog } from "@/components/nwea-booking-dialog";
import { ArrowLeft, ArrowRight, Calendar, ExternalLink } from "lucide-react";
import { ResidentialPacketForm } from "./residential-packet-form";

const STEP_UP_URL = "https://www.stepupforstudents.org/scholarships/logins/";

/**
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
  isSubmitted: boolean;
  isAccepted: boolean;
  is_residential_addition?: boolean;
}

interface StudentRow {
  id: number;
  first_name: string;
  last_name: string;
}

interface BusStop {
  id: number;
  name: string;
  address: string;
}

export default function AddStudentRegistrationPage() {
  const params = useParams();
  const router = useRouter();
  const appId = Number(params.applicationId);

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
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
        const [appRes, studentsRes, busRes] = await Promise.all([
          fetch(`/api/applications/${appId}`),
          fetch(`/api/students`),
          fetch(`/api/bus-stops`),
        ]);
        if (!appRes.ok) {
          if (!cancelled) setNotFound(true);
          return;
        }
        const appData = await appRes.json();
        // Only residential additions belong in this flow. A normal
        // application landing here is a mistake — bounce to the
        // dashboard rather than letting the parent edit it out of band.
        if (appData?.is_residential_addition !== true) {
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
          const pktRes = await fetch(
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
        if (!cancelled) setNotFound(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [appId, router]);

  function setField<K extends keyof AppRow>(key: K, value: AppRow[K]) {
    setApp((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

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

  const nweaScheduled = !!(
    app.nwea_testing_scheduled || app.nwea_testing_complete
  );

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

      <Card className="overflow-hidden gap-0 py-0">
        <CardHeader className="py-3 !pb-3 border-b">
          <CardTitle className="text-base">Student Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6 py-5 bg-white dark:bg-background">
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-[2fr_1fr_1fr]">
            <Field>
              <FieldLabel className="text-xs">
                Current / Previous School
              </FieldLabel>
              <Input
                className={!app.current_previous_school ? "border-2 border-red-400" : ""}
                placeholder="School name"
                value={app.current_previous_school}
                onChange={(e) => setField("current_previous_school", e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel className="text-xs">Current Grade</FieldLabel>
              <Input
                className={!app.last_grade_completed ? "border-2 border-red-400" : ""}
                placeholder="e.g. 7th"
                value={app.last_grade_completed}
                onChange={(e) => setField("last_grade_completed", e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel className="text-xs">Incoming Grade</FieldLabel>
              <Input
                className={!app.current_grade ? "border-2 border-red-400" : ""}
                placeholder="e.g. 8th"
                value={app.current_grade}
                onChange={(e) => setField("current_grade", e.target.value)}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel className="text-xs">
                Describe Student Strengths
              </FieldLabel>
              <textarea
                className={`flex min-h-[80px] w-full rounded-md border bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                  !app.describe_student_strengths
                    ? "border-2 border-red-400"
                    : "border-input"
                }`}
                placeholder="Student's strengths..."
                value={app.describe_student_strengths}
                onChange={(e) =>
                  setField("describe_student_strengths", e.target.value)
                }
              />
            </Field>
            <Field>
              <FieldLabel className="text-xs">
                Describe Student Opportunities for Growth
              </FieldLabel>
              <textarea
                className={`flex min-h-[80px] w-full rounded-md border bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                  !app.describe_student_opportunities_for_growth
                    ? "border-2 border-red-400"
                    : "border-input"
                }`}
                placeholder="Areas for growth..."
                value={app.describe_student_opportunities_for_growth}
                onChange={(e) =>
                  setField(
                    "describe_student_opportunities_for_growth",
                    e.target.value
                  )
                }
              />
            </Field>
          </div>

          <section className="border-t pt-5">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-medium">Transportation</h3>
              <Switch
                checked={app.is_bus_transportation}
                onCheckedChange={(v) => {
                  setField("is_bus_transportation", v);
                  if (!v) setField("bus_stop", "");
                }}
                aria-label="Bus transportation"
              />
            </div>
            {app.is_bus_transportation ? (
              <div className="mt-4">
                <Field>
                  <FieldLabel className="text-xs">
                    Bus Stop <span className="text-red-400">*</span>
                  </FieldLabel>
                  <select
                    className={`flex h-9 w-full items-center justify-between rounded-md border bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      !app.bus_stop ? "border-red-400" : "border-input"
                    }`}
                    value={app.bus_stop}
                    onChange={(e) => setField("bus_stop", e.target.value)}
                  >
                    <option value="">Select a bus stop</option>
                    {busStops.map((s) => (
                      <option key={s.id} value={s.name}>
                        {s.name}
                        {s.address ? ` — ${s.address}` : ""}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            ) : null}
          </section>
        </CardContent>
      </Card>

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
      <Card className="overflow-hidden gap-0 py-0">
        <CardHeader className="py-3 !pb-3 border-b">
          <CardTitle className="text-base">Initial Testing (NWEA)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 py-5 bg-white dark:bg-background">
          <p className="text-sm text-muted-foreground">
            All applying students complete an NWEA screening in Reading and Math
            at SailFuture Academy (about 60&ndash;90 minutes total). Schedule a
            time, then confirm below.
          </p>
          <Button
            type="button"
            className={`w-full ${
              nweaScheduled
                ? "bg-muted text-muted-foreground hover:bg-muted cursor-default"
                : ""
            }`}
            disabled={nweaScheduled}
            onClick={() => setScheduleDialogOpen(true)}
          >
            <Calendar className="size-4 mr-1.5 shrink-0" />
            {nweaScheduled
              ? "NWEA Testing Scheduled"
              : "Click to Schedule NWEA Testing"}
          </Button>
          <label
            className={`flex items-start gap-3 cursor-pointer rounded-md border px-4 py-3 transition-colors ${
              nweaScheduled ? "border-input" : "border-2 border-red-400"
            }`}
          >
            <input
              type="checkbox"
              className="size-5 mt-0.5 cursor-pointer rounded accent-primary"
              checked={nweaScheduled}
              onChange={(e) => {
                const v = e.target.checked;
                setField("nwea_testing_scheduled", v);
                setField("nwea_testing_complete", v);
              }}
            />
            <span className="text-sm font-medium">
              Yes, I&rsquo;ve scheduled NWEA testing for my child at SailFuture
              Academy.
            </span>
          </label>
        </CardContent>
      </Card>

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

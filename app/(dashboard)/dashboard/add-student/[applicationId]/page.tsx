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
import { ArrowLeft, Clock } from "lucide-react";
import { ResidentialPacketForm } from "./residential-packet-form";

/**
 * Per-student mid-year registration flow for residential / foster
 * families. Reached from the enrolled-family dashboard's "Create New
 * Registration" button, which creates the student + a marked
 * (`is_residential_addition`) application and routes here with that
 * application's id.
 *
 * Scoped to ONE student's application — it never touches the family's
 * year-level progress rows, so completing it can't disturb the rest of
 * the family's enrolled state. Captures the same Student Details the
 * apply wizard collects (school history, strengths/growth, transport),
 * then submits the application for admin review. No financial aid, no
 * tuition — funding for these placements is handled externally.
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
        });
        setStudent(
          students.find(
            (s) => s.id === Number(appData.registration_students_id)
          ) ?? null
        );
        setBusStops(stops);
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
      toast.success("Registration submitted for review.");
      router.push("/dashboard");
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

  // Accepted — the parent completes this student's registration packet.
  if (app.isAccepted) {
    return (
      <div className="flex flex-1 flex-col gap-6 p-6 mx-auto w-full max-w-4xl">
        <BackToDashboard />
        <ResidentialPacketForm
          studentId={app.registration_students_id}
          yearId={app.registration_school_years_id}
          registrationTypeId={1}
          studentName={studentName}
        />
      </div>
    );
  }

  // Submitted, awaiting admin review.
  if (app.isSubmitted) {
    return (
      <div className="flex flex-1 flex-col gap-4 p-6 mx-auto w-full max-w-4xl">
        <BackToDashboard />
        <StatusBanner
          tone="pending"
          icon={<Clock className="size-5" />}
          title={`${studentName}'s registration is in review.`}
          body="Our admissions team is reviewing the new student's information. You'll see them on your dashboard once they're confirmed."
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
          Complete this student&rsquo;s information and submit it for
          admissions review. They&rsquo;ll join your enrolled students once
          confirmed.
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

      <div className="flex items-center justify-end gap-3">
        <Button variant="outline" onClick={handleSave} disabled={saving || submitting}>
          {saving ? "Saving…" : "Save for Later"}
        </Button>
        <Button onClick={handleSubmit} disabled={submitting || saving}>
          {submitting ? "Submitting…" : "Submit for Review"}
        </Button>
      </div>
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

function StatusBanner({
  tone,
  icon,
  title,
  body,
}: {
  tone: "success" | "pending";
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  const cls =
    tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100"
      : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100";
  return (
    <div className={`rounded-xl border p-5 flex items-start gap-3 ${cls}`}>
      <div className="shrink-0 mt-0.5">{icon}</div>
      <div>
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-xs mt-1 opacity-80 max-w-xl">{body}</p>
      </div>
    </div>
  );
}

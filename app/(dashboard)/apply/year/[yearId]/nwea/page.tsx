"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { useApplicationFlow } from "@/contexts/application-flow-context";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Calendar } from "lucide-react";
import { GlobalSaveStatusPill } from "@/components/save-status-pill";

interface Student {
  id: number;
  first_name: string;
  last_name: string;
  photo?: string | { url: string } | null;
}

interface Application {
  id: number;
  registration_students_id: number;
  registration_school_years_id: number;
  test_scores: Record<string, unknown> | null;
  nwea_testing_complete: boolean;
  nwea_testing_scheduled?: boolean;
}

function getInitials(first: string, last: string): string {
  return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
}

function getPhotoUrl(photo: Student["photo"]): string | undefined {
  if (!photo) return undefined;
  if (typeof photo === "string") return photo.startsWith("http") ? photo : undefined;
  if (typeof photo === "object" && photo.url) return photo.url;
  return undefined;
}

const NWEA_BOOKING_URL = "https://calendar.app.google/FsBaobZrsRToxuGq9";

export default function InitialTestingStepPage() {
  const params = useParams();
  const yearId = Number(params.yearId);

  const { setPageTitle, updateSaveOptions, trackAutosave } = useApplicationFlow();

  const [students, setStudents] = useState<Student[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingAppId, setSavingAppId] = useState<number | null>(null);
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [studentsRes, appsRes] = await Promise.all([
        fetch("/api/students"),
        fetch("/api/applications"),
      ]);
      if (studentsRes.ok) setStudents(await studentsRes.json());
      if (appsRes.ok) {
        const allApps: Application[] = await appsRes.json();
        setApplications(
          allApps.filter((a) => a.registration_school_years_id === yearId)
        );
      }
    } catch (err) {
      console.error("Failed to fetch:", err);
    } finally {
      setLoading(false);
    }
  }, [yearId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    setPageTitle("Initial Testing");
    updateSaveOptions({ label: "Complete Initial Testing" });
  }, [setPageTitle, updateSaveOptions]);

  useEffect(() => {
    updateSaveOptions({ saving: savingAppId !== null });
  }, [savingAppId, updateSaveOptions]);

  async function toggleScheduled(appId: number, current: boolean) {
    const newVal = !current;
    // Optimistic update
    setApplications((prev) =>
      prev.map((a) =>
        a.id === appId
          ? { ...a, nwea_testing_complete: newVal, nwea_testing_scheduled: newVal }
          : a
      )
    );
    try {
      await trackAutosave(
        fetch(`/api/applications/${appId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nwea_testing_complete: newVal,
            nwea_testing_scheduled: newVal,
          }),
        }).then(async (r) => {
          if (!r.ok) throw new Error(`Save failed (${r.status})`);
          return r;
        })
      );
    } catch (err) {
      console.error("Failed to save:", err);
      // Revert
      setApplications((prev) =>
        prev.map((a) =>
          a.id === appId
            ? {
                ...a,
                nwea_testing_complete: current,
                nwea_testing_scheduled: current,
              }
            : a
        )
      );
    }
  }

  const enrolled = applications
    .map((app) => ({
      app,
      student: students.find((s) => s.id === app.registration_students_id),
    }))
    .filter((x): x is { app: Application; student: Student } => !!x.student);

  if (loading) {
    return (
      <div className="flex flex-1 flex-col gap-6 p-6 mx-auto w-full max-w-4xl">
        <Skeleton className="h-6 w-40" />
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="rounded-lg border p-6">
            <Skeleton className="h-5 w-36 mb-4" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {Array.from({ length: 2 }).map((_, j) => (
                <Skeleton key={j} className="h-24 w-full rounded-md" />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-1 flex-col gap-6 p-6 mx-auto w-full max-w-4xl">
        <div>
          <div className="flex items-center justify-between gap-3 pb-3 border-b">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Initial Testing
            </p>
            <GlobalSaveStatusPill />
          </div>
          <h1 className="text-2xl font-semibold mt-4">
            Schedule NWEA testing at SailFuture Academy.
          </h1>
          <p className="text-sm text-muted-foreground mt-2 max-w-3xl">
            All applying students must complete an NWEA screening in both
            Reading and Math. The assessment duration for each test ranges from
            15 to 30 minutes, for a total time between 60–90 minutes.
          </p>
          <p className="text-sm text-muted-foreground mt-2 max-w-3xl">
            Assessments are conducted on weekdays, from Tuesday to Friday,
            between 2:30 p.m. and 4 p.m. Please select a time slot within this
            period that is convenient for your student to take the test.
          </p>
        </div>

        {enrolled.length === 0 ? (
          <div className="flex min-h-[20vh] items-center justify-center rounded-lg border">
            <p className="text-muted-foreground text-sm">
              No students enrolled for this year. Add students first from the
              checklist.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {enrolled.map(({ app, student }) => {
              const hasUpload = !!app.test_scores;
              const scheduled = !!app.nwea_testing_scheduled || !!app.nwea_testing_complete;
              const photoUrl = getPhotoUrl(student.photo);
              const isComplete = hasUpload || scheduled;
              return (
                <Card key={student.id} className="overflow-hidden gap-0 py-0">
                  {/* Students-page card format — avatar + name + status icon only.
                      No trash icon, no chevron, always expanded, no status sub-head. */}
                  <CardHeader className="py-3 !pb-3 border-b">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Avatar className="size-10">
                          {photoUrl ? (
                            <AvatarImage
                              src={photoUrl}
                              alt={`${student.first_name} ${student.last_name}`}
                            />
                          ) : null}
                          <AvatarFallback className="bg-muted text-muted-foreground text-sm font-medium">
                            {getInitials(student.first_name, student.last_name)}
                          </AvatarFallback>
                        </Avatar>
                        <CardTitle className="text-lg">
                          {student.first_name} {student.last_name}
                        </CardTitle>
                      </div>
                      <div className="flex items-center gap-2">
                        {isComplete ? (
                          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-green-500 text-white">
                            <svg className="size-4" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                            </svg>
                          </div>
                        ) : (
                          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-amber-500 text-white">
                            <svg className="size-4" viewBox="0 0 20 20" fill="currentColor">
                              <path d="M5.433 13.917l1.262-3.155A4 4 0 017.58 9.42l6.92-6.918a2.121 2.121 0 013 3l-6.92 6.918c-.383.383-.84.685-1.343.886l-3.154 1.262a.5.5 0 01-.65-.65z" />
                              <path d="M3.5 5.75c0-.69.56-1.25 1.25-1.25H10A.75.75 0 0010 3H4.75A2.75 2.75 0 002 5.75v9.5A2.75 2.75 0 004.75 18h9.5A2.75 2.75 0 0017 15.25V10a.75.75 0 00-1.5 0v5.25c0 .69-.56 1.25-1.25 1.25h-9.5c-.69 0-1.25-.56-1.25-1.25v-9.5z" />
                            </svg>
                          </div>
                        )}
                      </div>
                    </div>
                  </CardHeader>

                  <CardContent className="space-y-4 py-5 bg-white dark:bg-background">
                    {/* Schedule — white outline button. Parents must come in
                        for initial testing; no self-upload option. */}
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full bg-white"
                      onClick={() => setScheduleDialogOpen(true)}
                    >
                      <Calendar className="size-4 mr-1.5 shrink-0" />
                      Click to Schedule NWEA Testing
                    </Button>

                    <label
                      className={`flex items-start gap-3 cursor-pointer rounded-md border px-4 py-3 transition-colors ${
                        scheduled ? "border-input" : "border-red-400"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="size-5 mt-0.5 cursor-pointer rounded accent-primary"
                        checked={scheduled}
                        disabled={savingAppId === app.id}
                        onChange={() => toggleScheduled(app.id, scheduled)}
                      />
                      <span className="text-sm font-medium">
                        Yes, I&apos;ve scheduled NWEA testing for my child at
                        the SailFuture Academy.
                      </span>
                    </label>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Schedule NWEA Testing Dialog — embeds the Google Calendar booking flow */}
      <Dialog open={scheduleDialogOpen} onOpenChange={setScheduleDialogOpen}>
        <DialogContent className="sm:max-w-[95vw] w-[95vw] h-[90vh] p-0 flex flex-col overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-2 shrink-0">
            <DialogTitle>Schedule NWEA Testing</DialogTitle>
            <DialogDescription>
              Select a date and time to complete NWEA testing at SailFuture
              Academy.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 m-6 mt-0 overflow-hidden rounded-lg border">
            <iframe
              src={NWEA_BOOKING_URL}
              className="h-full w-full border-0"
              title="Schedule NWEA Testing"
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

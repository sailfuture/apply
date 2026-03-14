"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { useApplicationFlow } from "@/contexts/application-flow-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";

interface Student {
  id: number;
  first_name: string;
  last_name: string;
}

interface Application {
  id: number;
  registration_students_id: number;
  registration_school_years_id: number;
  nwea_math: number;
  nwea_reading: number;
  test_scores: Record<string, unknown> | null;
  nwea_testing_complete: boolean;
}

const avatarColors = [
  "bg-blue-500", "bg-emerald-500", "bg-violet-500", "bg-amber-500",
  "bg-rose-500", "bg-cyan-500", "bg-indigo-500", "bg-teal-500",
];

function getInitials(first: string, last: string): string {
  return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
}

function getAvatarColor(id: number): string {
  return avatarColors[id % avatarColors.length];
}

export default function NweaStepPage() {
  const params = useParams();
  const router = useRouter();
  const yearId = Number(params.yearId);

  const {
    setPageTitle,
    registerSaveHandler,
    unregisterSaveHandler,
    updateSaveOptions,
  } = useApplicationFlow();

  const [students, setStudents] = useState<Student[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [yearName, setYearName] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingAppId, setSavingAppId] = useState<number | null>(null);

  const [scores, setScores] = useState<
    Record<number, { nwea_math: string; nwea_reading: string }>
  >({});

  const fetchData = useCallback(async () => {
    try {
      const [yearsRes, studentsRes, appsRes] = await Promise.all([
        fetch("/api/school-years"),
        fetch("/api/students"),
        fetch("/api/applications"),
      ]);
      if (yearsRes.ok) {
        const years = await yearsRes.json();
        const found = years.find((y: { id: number }) => y.id === yearId);
        if (found) setYearName(found.year_name);
      }
      if (studentsRes.ok) setStudents(await studentsRes.json());
      if (appsRes.ok) {
        const allApps: Application[] = await appsRes.json();
        const yearApps = allApps.filter(
          (a) => a.registration_school_years_id === yearId
        );
        setApplications(yearApps);

        const initialScores: Record<
          number,
          { nwea_math: string; nwea_reading: string }
        > = {};
        yearApps.forEach((app) => {
          initialScores[app.id] = {
            nwea_math: app.nwea_math ? String(app.nwea_math) : "",
            nwea_reading: app.nwea_reading ? String(app.nwea_reading) : "",
          };
        });
        setScores(initialScores);
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

  async function handleSaveScores(appId: number) {
    setSavingAppId(appId);
    const s = scores[appId];
    try {
      const res = await fetch(`/api/applications/${appId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nwea_math: s?.nwea_math ? Number(s.nwea_math) : 0,
          nwea_reading: s?.nwea_reading ? Number(s.nwea_reading) : 0,
        }),
      });
      if (res.ok) {
        const updated = await res.json();
        setApplications((prev) =>
          prev.map((a) => (a.id === appId ? { ...a, ...updated } : a))
        );
      }
    } catch (err) {
      console.error("Failed to save:", err);
    } finally {
      setSavingAppId(null);
    }
  }

  async function handleFileUpload(appId: number, file: File) {
    setSavingAppId(appId);
    try {
      const base64 = await fileToBase64(file);
      const res = await fetch(`/api/applications/${appId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          test_scores: {
            name: file.name,
            type: file.type,
            size: file.size,
            data: base64,
          },
        }),
      });
      if (res.ok) {
        const updated = await res.json();
        setApplications((prev) =>
          prev.map((a) => (a.id === appId ? { ...a, ...updated } : a))
        );
      }
    } catch (err) {
      console.error("Upload failed:", err);
    } finally {
      setSavingAppId(null);
    }
  }

  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
    });
  }

  const handleSaveScoresRef = useRef(handleSaveScores);
  handleSaveScoresRef.current = handleSaveScores;

  useEffect(() => {
    setPageTitle("NWEA Testing");
    registerSaveHandler(
      async () => {
        const apps = applicationsRef.current;
        await Promise.all(apps.map((app) => handleSaveScoresRef.current(app.id)));
      },
      { label: "Save" }
    );
    return () => unregisterSaveHandler();
  }, [setPageTitle, registerSaveHandler, unregisterSaveHandler]);

  const applicationsRef = useRef(applications);
  applicationsRef.current = applications;

  useEffect(() => {
    updateSaveOptions({ saving: savingAppId !== null });
  }, [savingAppId, updateSaveOptions]);

  const enrolled = applications
    .map((app) => ({
      app,
      student: students.find((s) => s.id === app.registration_students_id),
    }))
    .filter((x): x is { app: Application; student: Student } => !!x.student);

  if (loading) {
    return (
      <div className="flex flex-1 flex-col gap-6 p-6 mx-auto w-full max-w-4xl">
        <Skeleton className="h-6 w-40 mx-auto" />
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="rounded-lg border p-6">
            <Skeleton className="h-5 w-36 mb-4" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {Array.from({ length: 4 }).map((_, j) => (
                <div key={j}>
                  <Skeleton className="h-4 w-24 mb-2" />
                  <Skeleton className="h-10 w-full rounded-md" />
                </div>
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
        <div className="text-center">
          <h1 className="text-2xl font-semibold">
            NWEA Testing &amp; Records
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Enter NWEA scores, upload test records, or schedule testing for
            each enrolled student.
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
              const hasScores = app.nwea_math > 0 && app.nwea_reading > 0;
              const hasUpload = app.test_scores !== null;
              const status = hasScores
                ? "Scores Entered"
                : hasUpload
                  ? "Records Uploaded"
                  : "Pending";
              const statusColor =
                status === "Pending"
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-green-600 dark:text-green-400";

              return (
                <Card key={student.id}>
                  <CardHeader>
                    <div className="flex items-center gap-3">
                      <Avatar>
                        <AvatarFallback
                          className={`${getAvatarColor(student.id)} text-white text-xs font-medium`}
                        >
                          {getInitials(student.first_name, student.last_name)}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <CardTitle className="text-base">
                          {student.first_name} {student.last_name}
                        </CardTitle>
                        <CardDescription>
                          <span className={`text-xs font-medium ${statusColor}`}>
                            {status}
                          </span>
                        </CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <Tabs defaultValue="scores">
                      <TabsList className="mb-4">
                        <TabsTrigger value="scores">
                          Enter Scores
                        </TabsTrigger>
                        <TabsTrigger value="upload">
                          Upload Records
                        </TabsTrigger>
                        <TabsTrigger value="schedule">
                          Schedule Testing
                        </TabsTrigger>
                      </TabsList>

                      <TabsContent value="scores">
                        <div className="grid gap-4 sm:grid-cols-2 max-w-lg">
                          <Field>
                            <FieldLabel className="text-xs">
                              NWEA Math Score
                            </FieldLabel>
                            <Input
                              type="number"
                              placeholder="e.g. 215"
                              value={scores[app.id]?.nwea_math ?? ""}
                              onChange={(e) =>
                                setScores((prev) => ({
                                  ...prev,
                                  [app.id]: {
                                    ...prev[app.id],
                                    nwea_math: e.target.value,
                                  },
                                }))
                              }
                            />
                          </Field>
                          <Field>
                            <FieldLabel className="text-xs">
                              NWEA Reading Score
                            </FieldLabel>
                            <Input
                              type="number"
                              placeholder="e.g. 220"
                              value={scores[app.id]?.nwea_reading ?? ""}
                              onChange={(e) =>
                                setScores((prev) => ({
                                  ...prev,
                                  [app.id]: {
                                    ...prev[app.id],
                                    nwea_reading: e.target.value,
                                  },
                                }))
                              }
                            />
                          </Field>
                        </div>
                        <Button
                          size="sm"
                          className="mt-4"
                          disabled={savingAppId === app.id}
                          onClick={() => handleSaveScores(app.id)}
                        >
                          {savingAppId === app.id
                            ? "Saving..."
                            : "Save Scores"}
                        </Button>
                      </TabsContent>

                      <TabsContent value="upload">
                        <div className="space-y-3">
                          {hasUpload && (
                            <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-900/20 dark:text-green-400">
                              Test records have been uploaded.
                            </div>
                          )}
                          <Field>
                            <FieldLabel className="text-xs">
                              Upload test score document (PDF or image)
                            </FieldLabel>
                            <Input
                              type="file"
                              accept=".pdf,.jpg,.jpeg,.png"
                              disabled={savingAppId === app.id}
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) handleFileUpload(app.id, file);
                              }}
                            />
                          </Field>
                        </div>
                      </TabsContent>

                      <TabsContent value="schedule">
                        <div className="rounded-lg border p-4 space-y-3">
                          <p className="text-sm">
                            If your student does not have NWEA test scores,
                            you can schedule testing at SailFuture Academy.
                          </p>
                          <p className="text-sm text-muted-foreground">
                            Please contact the admissions office to schedule
                            an NWEA testing session:
                          </p>
                          <div className="text-sm">
                            <p className="font-medium">
                              SailFuture Academy Admissions
                            </p>
                            <p className="text-muted-foreground">
                              admissions@sailfuture.org
                            </p>
                          </div>
                          <label className="flex items-start gap-3 pt-2 cursor-pointer">
                            <input
                              type="checkbox"
                              className="size-5 mt-0.5 cursor-pointer rounded accent-primary"
                              checked={app.nwea_testing_complete}
                              disabled={savingAppId === app.id}
                              onChange={async () => {
                                const newVal = !app.nwea_testing_complete;
                                setApplications((prev) =>
                                  prev.map((a) =>
                                    a.id === app.id
                                      ? { ...a, nwea_testing_complete: newVal }
                                      : a
                                  )
                                );
                                try {
                                  await fetch(`/api/applications/${app.id}`, {
                                    method: "PATCH",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ nwea_testing_complete: newVal }),
                                  });
                                } catch (err) {
                                  console.error("Failed to save:", err);
                                  setApplications((prev) =>
                                    prev.map((a) =>
                                      a.id === app.id
                                        ? { ...a, nwea_testing_complete: !newVal }
                                        : a
                                    )
                                  );
                                }
                              }}
                            />
                            <span className="text-sm font-medium">
                              Yes, I&apos;ve scheduled NWEA testing for my child at the SailFuture Academy.
                            </span>
                          </label>
                        </div>
                      </TabsContent>
                    </Tabs>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

      </div>
    </>
  );
}


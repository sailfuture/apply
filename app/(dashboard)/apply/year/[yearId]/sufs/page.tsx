"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useApplicationFlow } from "@/contexts/application-flow-context";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

interface Student {
  id: number;
  first_name: string;
  last_name: string;
  date_of_birth: string;
}

interface Application {
  id: number;
  registration_students_id: number;
  registration_school_years_id: number;
  sufs_scholarship_type?: string;
}

interface SchoolYear {
  id: number;
  year_name: string;
  fes_eo_9: number;
  fes_eo_8: number;
  ftc_8: number;
  ftc_9: number;
  fes_ua_8_ese_1_3: number;
  fes_ua_9_ese_1_3: number;
  fes_ua_ese_4: number;
  fes_ua_ese_5: number;
}

const SUFS_OPTIONS: { value: string; label: string; yearKey: keyof SchoolYear }[] = [
  { value: "fes_eo_8", label: "FES-EO (Grade 8)", yearKey: "fes_eo_8" },
  { value: "fes_eo_9", label: "FES-EO (Grade 9)", yearKey: "fes_eo_9" },
  { value: "ftc_8", label: "FTC (Grade 8)", yearKey: "ftc_8" },
  { value: "ftc_9", label: "FTC (Grade 9)", yearKey: "ftc_9" },
  { value: "fes_ua_8_ese_1_3", label: "FES-UA ESE 1-3 (Grade 8)", yearKey: "fes_ua_8_ese_1_3" },
  { value: "fes_ua_9_ese_1_3", label: "FES-UA ESE 1-3 (Grade 9)", yearKey: "fes_ua_9_ese_1_3" },
  { value: "fes_ua_ese_4", label: "FES-UA ESE 4", yearKey: "fes_ua_ese_4" },
  { value: "fes_ua_ese_5", label: "FES-UA ESE 5", yearKey: "fes_ua_ese_5" },
  { value: "none", label: "Not Applicable", yearKey: "fes_eo_8" },
];

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
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

export default function SufsStepPage() {
  const params = useParams();
  const router = useRouter();
  const yearId = Number(params.yearId);

  const { setPageTitle } = useApplicationFlow();

  useEffect(() => {
    setPageTitle("SUFS Scholarship");
  }, [setPageTitle]);

  const [students, setStudents] = useState<Student[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [schoolYear, setSchoolYear] = useState<SchoolYear | null>(null);
  const [yearName, setYearName] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingAppId, setSavingAppId] = useState<number | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [yearsRes, studentsRes, appsRes] = await Promise.all([
        fetch("/api/school-years"),
        fetch("/api/students"),
        fetch("/api/applications"),
      ]);
      if (yearsRes.ok) {
        const years: SchoolYear[] = await yearsRes.json();
        const found = years.find((y) => y.id === yearId);
        if (found) {
          setSchoolYear(found);
          setYearName((found as unknown as { year_name: string }).year_name);
        }
      }
      if (studentsRes.ok) setStudents(await studentsRes.json());
      if (appsRes.ok) {
        const allApps: Application[] = await appsRes.json();
        setApplications(allApps.filter((a) => a.registration_school_years_id === yearId));
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

  async function handleSufsChange(appId: number, value: string) {
    setSavingAppId(appId);
    try {
      const res = await fetch(`/api/applications/${appId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sufs_scholarship_type: value }),
      });
      if (res.ok) {
        const updated = await res.json();
        setApplications((prev) =>
          prev.map((a) => (a.id === appId ? { ...a, ...updated } : a))
        );
      }
    } catch (err) {
      console.error("Failed to update:", err);
    } finally {
      setSavingAppId(null);
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
        <Skeleton className="h-6 w-40 mx-auto" />
        <div className="rounded-lg border p-6">
          <Skeleton className="h-5 w-36 mb-4" />
          <div className="space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i}>
                <Skeleton className="h-4 w-24 mb-2" />
                <Skeleton className="h-10 w-full rounded-md" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-1 flex-col gap-6 p-6 mx-auto w-full max-w-4xl">
        <div className="text-center">
          <h1 className="text-2xl font-semibold">
            Step Up for Students Scholarship
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Select the SUFS scholarship type for each enrolled student.
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
              const selectedOption = SUFS_OPTIONS.find(
                (o) => o.value === app.sufs_scholarship_type
              );
              const amount =
                selectedOption && selectedOption.value !== "none" && schoolYear
                  ? (schoolYear[selectedOption.yearKey] as number) ?? 0
                  : 0;

              return (
                <Card key={student.id}>
                  <CardContent className="pt-6">
                    <div className="flex items-start gap-4">
                      <Avatar>
                        <AvatarFallback
                          className={`${getAvatarColor(student.id)} text-white text-xs font-medium`}
                        >
                          {getInitials(student.first_name, student.last_name)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 space-y-3">
                        <p className="font-medium">
                          {student.first_name} {student.last_name}
                        </p>
                        <Field className="max-w-md">
                          <FieldLabel className="text-xs">
                            Scholarship Type
                          </FieldLabel>
                          <Select
                            value={app.sufs_scholarship_type || ""}
                            disabled={savingAppId === app.id}
                            onValueChange={(v) =>
                              handleSufsChange(app.id, v)
                            }
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select scholarship type" />
                            </SelectTrigger>
                            <SelectContent>
                              {SUFS_OPTIONS.map((opt) => (
                                <SelectItem key={opt.value} value={opt.value}>
                                  {opt.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {amount > 0 && (
                            <p className="text-sm text-green-600 dark:text-green-400">
                              Award: {formatCurrency(amount)}
                            </p>
                          )}
                        </Field>
                      </div>
                    </div>
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


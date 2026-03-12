"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Student {
  id: number;
  first_name: string;
  last_name: string;
  date_of_birth: string;
  gender: string;
  ethnicity: string;
}

interface SchoolYear {
  id: number;
  year_name: string;
  start_date: string | null;
  end_date: string | null;
  tuition: number;
  annual_fees: number;
  transportation_fees: number;
  isActive: boolean;
  isPast: boolean;
  isNextYear: boolean;
  isFuture: boolean;
  application_deadline: string | null;
  opportunity_scholarship_deadline: string | null;
}

function isDeadlinePassed(deadline: string | null): boolean {
  if (!deadline) return false;
  const now = new Date();
  const dl = new Date(deadline + "T23:59:59");
  return now > dl;
}

interface Application {
  id: number;
  registration_students_id: number;
  registration_families_id: number;
  registration_application_status_id: number;
  registration_school_years_id: number;
  sufs_award_id: number;
  is_bus_transportation: boolean;
  bus_stop: string;
  current_previous_school: string;
  describe_student_strengths: string;
  describe_student_opportunities_for_growth: string;
  last_grade_completed: string;
  current_grade: string;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDate(date: string | null): string {
  if (!date) return "TBD";
  return new Date(date + "T00:00:00").toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function getYearTypeBadge(year: SchoolYear) {
  if (year.isActive) {
    return {
      label: "Active",
      className:
        "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    };
  }
  if (year.isNextYear) {
    return {
      label: "Next Year",
      className:
        "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
    };
  }
  if (year.isPast) {
    return {
      label: "Past",
      className:
        "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400",
    };
  }
  return null;
}

export default function ApplyPage() {
  const params = useParams();
  const router = useRouter();
  const studentId = Number(params.studentId);

  const [student, setStudent] = useState<Student | null>(null);
  const [schoolYears, setSchoolYears] = useState<SchoolYear[]>([]);
  const [selectedYearId, setSelectedYearId] = useState<number | null>(null);
  const [application, setApplication] = useState<Application | null>(null);
  const [statusName, setStatusName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [sufsAwardId, setSufsAwardId] = useState(0);
  const [busTransportation, setBusTransportation] = useState("No");
  const [previousSchool, setPreviousSchool] = useState("");
  const [strengths, setStrengths] = useState("");
  const [growthAreas, setGrowthAreas] = useState("");

  const loadInitialData = useCallback(async () => {
    try {
      const [studentRes, yearsRes, appsRes, statusesRes] = await Promise.all([
        fetch("/api/students"),
        fetch("/api/school-years"),
        fetch(`/api/applications?studentId=${studentId}`),
        fetch("/api/application-statuses"),
      ]);

      if (studentRes.ok) {
        const students: Student[] = await studentRes.json();
        const found = students.find((s) => s.id === studentId);
        if (found) setStudent(found);
      }

      if (yearsRes.ok) {
        const allYears: SchoolYear[] = await yearsRes.json();
        setSchoolYears(allYears.filter((y) => !y.isFuture));
      }

      const statusMap: Record<number, string> = {};
      if (statusesRes.ok) {
        const statuses: { id: number; status_name: string }[] =
          await statusesRes.json();
        statuses.forEach((s) => (statusMap[s.id] = s.status_name));
      }

      if (appsRes.ok) {
        const apps: Application[] = await appsRes.json();
        const draft = apps.find(
          (a) => statusMap[a.registration_application_status_id] === "Draft"
        );
        const existing = draft ?? apps[0];

        if (existing) {
          setApplication(existing);
          setSelectedYearId(existing.registration_school_years_id);
          setSufsAwardId(existing.sufs_award_id ?? 0);
          setBusTransportation(existing.is_bus_transportation ? "Yes" : "No");
          setPreviousSchool(existing.current_previous_school || "");
          setStrengths(existing.describe_student_strengths || "");
          setGrowthAreas(
            existing.describe_student_opportunities_for_growth || ""
          );
          setStatusName(
            statusMap[existing.registration_application_status_id] ?? ""
          );
        }
      }
    } catch (err) {
      console.error("Failed to load data:", err);
    } finally {
      setLoading(false);
    }
  }, [studentId]);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  async function handleSelectYear(yearId: number) {
    if (application) return;
    setSelectedYearId(yearId);
    setSaving(true);

    try {
      const res = await fetch("/api/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          registration_students_id: studentId,
          registration_school_years_id: yearId,
        }),
      });

      if (res.ok) {
        const app: Application = await res.json();
        setApplication(app);
        setStatusName("Draft");
      }
    } catch (err) {
      console.error("Failed to create application:", err);
    } finally {
      setSaving(false);
    }
  }

  async function handleSave() {
    if (!application) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/applications/${application.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sufs_award_id: sufsAwardId,
          is_bus_transportation: busTransportation === "Yes",
          current_previous_school: previousSchool,
          describe_student_strengths: strengths,
          describe_student_opportunities_for_growth: growthAreas,
        }),
      });
      if (res.ok) {
        const updated = await res.json();
        setApplication(updated);
      }
    } catch (err) {
      console.error("Failed to save:", err);
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmit() {
    if (!application) return;
    setSubmitting(true);

    try {
      const statusesRes = await fetch("/api/application-statuses");
      if (!statusesRes.ok) return;
      const statuses: { id: number; status_name: string }[] =
        await statusesRes.json();
      const submitted = statuses.find((s) => s.status_name === "Submitted");
      if (!submitted) return;

      const res = await fetch(`/api/applications/${application.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sufs_award_id: sufsAwardId,
          is_bus_transportation: busTransportation === "Yes",
          current_previous_school: previousSchool,
          describe_student_strengths: strengths,
          describe_student_opportunities_for_growth: growthAreas,
          registration_application_status_id: submitted.id,
        }),
      });

      if (res.ok) {
        setStatusName("Submitted");
        const updated = await res.json();
        setApplication(updated);
      }
    } catch (err) {
      console.error("Failed to submit:", err);
    } finally {
      setSubmitting(false);
    }
  }

  const selectedYear = schoolYears.find((y) => y.id === selectedYearId);
  const hasApplication = !!application;

  const isActiveYear = selectedYear?.isActive ?? false;
  const isPastYear = selectedYear?.isPast ?? false;
  const appDeadlinePassed = isDeadlinePassed(
    selectedYear?.application_deadline ?? null
  );

  // Read-only when: deadline passed, past year, or non-active year with non-Draft status
  const isReadonly = appDeadlinePassed
    ? true
    : isPastYear
      ? true
      : isActiveYear
        ? false
        : statusName !== "" && statusName !== "Draft";

  if (loading) {
    return (
      <>
        <PageHeader studentName="" />
        <div className="flex min-h-[60vh] items-center justify-center">
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </>
    );
  }

  if (!student) {
    return (
      <>
        <PageHeader studentName="" />
        <div className="flex min-h-[60vh] items-center justify-center">
          <p className="text-muted-foreground">Student not found.</p>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        studentName={`${student.first_name} ${student.last_name}`}
      />
      <div className="mx-auto w-full max-w-3xl space-y-6 px-4 pb-12 pt-2">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">
              Application for {student.first_name} {student.last_name}
            </h1>
            <p className="text-muted-foreground text-sm">
              Complete all sections below and submit when ready.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {selectedYear && (() => {
              const badge = getYearTypeBadge(selectedYear);
              return badge ? (
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${badge.className}`}
                >
                  {badge.label}
                </span>
              ) : null;
            })()}
            {statusName && statusName !== "Draft" && (
              <span className="rounded-full bg-green-100 px-3 py-1 text-sm font-medium text-green-800 dark:bg-green-900/30 dark:text-green-400">
                {statusName}
              </span>
            )}
          </div>
        </div>

        {appDeadlinePassed && hasApplication && !isPastYear && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 dark:border-red-900/50 dark:bg-red-900/20">
            <p className="text-sm text-red-700 dark:text-red-300">
              The application deadline for this school year has passed. This
              application is view-only.
            </p>
          </div>
        )}

        {isPastYear && hasApplication && (
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-800 dark:bg-gray-900/20">
            <p className="text-sm text-gray-700 dark:text-gray-300">
              This application is for a past school year and cannot be edited.
            </p>
          </div>
        )}

        {/* School Year */}
        <Card>
          <CardHeader>
            <CardTitle>School Year</CardTitle>
            <CardDescription>
              {hasApplication
                ? "The school year for this application."
                : "Select the school year you are applying for."}
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {schoolYears.length === 0 ? (
              <p className="text-muted-foreground p-6 text-sm">
                No school years available. Please contact the school.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b">
                      <th className="text-muted-foreground px-4 py-3 text-left text-xs font-medium uppercase tracking-wider">
                        Year
                      </th>
                      <th className="text-muted-foreground hidden px-4 py-3 text-left text-xs font-medium uppercase tracking-wider sm:table-cell">
                        Dates
                      </th>
                      <th className="text-muted-foreground px-4 py-3 text-right text-xs font-medium uppercase tracking-wider">
                        Tuition
                      </th>
                      <th className="text-muted-foreground hidden px-4 py-3 text-right text-xs font-medium uppercase tracking-wider md:table-cell">
                        Fees
                      </th>
                      <th className="text-muted-foreground hidden px-4 py-3 text-right text-xs font-medium uppercase tracking-wider md:table-cell">
                        Transport
                      </th>
                      <th className="text-muted-foreground px-4 py-3 text-left text-xs font-medium uppercase tracking-wider">
                        Status
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium">
                        <span className="sr-only">Action</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {schoolYears.map((year) => {
                      const badge = getYearTypeBadge(year);
                      const isSelected = selectedYearId === year.id;
                      const yearDeadlinePassed = isDeadlinePassed(
                        year.application_deadline
                      );

                      return (
                        <tr
                          key={year.id}
                          className={`transition-colors ${
                            isSelected
                              ? "bg-primary/5"
                              : yearDeadlinePassed
                                ? "opacity-60"
                                : "hover:bg-muted/50"
                          }`}
                        >
                          <td className="px-4 py-3">
                            <p className="text-sm font-medium">
                              {year.year_name}
                            </p>
                          </td>
                          <td className="text-muted-foreground hidden px-4 py-3 text-sm sm:table-cell">
                            {formatDate(year.start_date)} &mdash;{" "}
                            {formatDate(year.end_date)}
                          </td>
                          <td className="px-4 py-3 text-right text-sm font-medium">
                            {formatCurrency(year.tuition)}
                          </td>
                          <td className="text-muted-foreground hidden px-4 py-3 text-right text-sm md:table-cell">
                            {formatCurrency(year.annual_fees)}
                          </td>
                          <td className="text-muted-foreground hidden px-4 py-3 text-right text-sm md:table-cell">
                            {formatCurrency(year.transportation_fees)}
                          </td>
                          <td className="px-4 py-3">
                            {yearDeadlinePassed ? (
                              <span className="inline-flex rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-800 dark:bg-red-900/30 dark:text-red-400">
                                Closed
                              </span>
                            ) : badge ? (
                              <span
                                className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${badge.className}`}
                              >
                                {badge.label}
                              </span>
                            ) : null}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {isSelected && hasApplication ? (
                              <span className="text-primary text-xs font-medium">
                                Selected
                              </span>
                            ) : !hasApplication && !yearDeadlinePassed ? (
                              <Button
                                size="sm"
                                variant={isSelected ? "default" : "outline"}
                                disabled={saving}
                                onClick={() => handleSelectYear(year.id)}
                              >
                                {saving && isSelected
                                  ? "Creating..."
                                  : "Select"}
                              </Button>
                            ) : !hasApplication && yearDeadlinePassed ? (
                              <span className="text-muted-foreground text-xs">
                                Deadline passed
                              </span>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Student Information (read-only summary) */}
        <Card>
          <CardHeader>
            <CardTitle>Student Information</CardTitle>
            <CardDescription>
              Profile details for this student.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
              <div>
                <p className="text-muted-foreground text-xs">Name</p>
                <p className="font-medium">
                  {student.first_name} {student.last_name}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Date of Birth</p>
                <p className="font-medium">
                  {student.date_of_birth
                    ? formatDate(student.date_of_birth)
                    : "Not set"}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Gender</p>
                <p className="font-medium">{student.gender || "—"}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Ethnicity</p>
                <p className="font-medium">{student.ethnicity || "—"}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Step Up for Students Scholarship */}
        <Card
          className={!hasApplication ? "pointer-events-none opacity-50" : ""}
        >
          <CardHeader>
            <CardTitle>Step Up for Students Scholarship</CardTitle>
            <CardDescription>
              Enter the student&apos;s Step Up for Students scholarship award ID if applicable.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="max-w-sm grid gap-2">
              <Label htmlFor="sufs_award_id">SUFS Award ID</Label>
              <Input
                id="sufs_award_id"
                type="number"
                placeholder="0"
                value={sufsAwardId || ""}
                onChange={(e) => setSufsAwardId(Number(e.target.value) || 0)}
                disabled={isReadonly || !hasApplication}
              />
            </div>
          </CardContent>
        </Card>

        {/* Student Details */}
        <Card
          className={!hasApplication ? "pointer-events-none opacity-50" : ""}
        >
          <CardHeader>
            <CardTitle>Student Details</CardTitle>
            <CardDescription>
              School and transportation information.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="bus">Bus Transportation</Label>
                <Select
                  value={busTransportation}
                  onValueChange={setBusTransportation}
                  disabled={isReadonly || !hasApplication}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Will the student use bus transportation?" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Yes">Yes</SelectItem>
                    <SelectItem value="No">No</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="prev_school">Current or Previous School</Label>
                <Input
                  id="prev_school"
                  placeholder="e.g. Tampa Bay High School"
                  value={previousSchool}
                  onChange={(e) => setPreviousSchool(e.target.value)}
                  disabled={isReadonly || !hasApplication}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* About the Student */}
        <Card
          className={!hasApplication ? "pointer-events-none opacity-50" : ""}
        >
          <CardHeader>
            <CardTitle>About the Student</CardTitle>
            <CardDescription>
              Help us understand {student.first_name}&apos;s strengths and areas
              for growth.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="strengths">
                  Describe Student&apos;s Strengths
                </Label>
                <Textarea
                  id="strengths"
                  placeholder="What are the student's strengths, talents, and interests?"
                  value={strengths}
                  onChange={(e) => setStrengths(e.target.value)}
                  disabled={isReadonly || !hasApplication}
                  rows={4}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="growth">
                  Describe Opportunities for Growth
                </Label>
                <Textarea
                  id="growth"
                  placeholder="What areas would you like to see the student grow in?"
                  value={growthAreas}
                  onChange={(e) => setGrowthAreas(e.target.value)}
                  disabled={isReadonly || !hasApplication}
                  rows={4}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="flex items-center justify-between">
          <Button variant="outline" onClick={() => router.push("/family")}>
            Back to Family
          </Button>

          {hasApplication && !isReadonly && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? "Saving..." : "Save Draft"}
              </Button>
              {statusName !== "Submitted" && (
                <Button onClick={handleSubmit} disabled={submitting}>
                  {submitting ? "Submitting..." : "Submit Application"}
                </Button>
              )}
            </div>
          )}

          {hasApplication && isActiveYear && statusName === "Submitted" && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? "Saving..." : "Update Application"}
              </Button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function PageHeader({ studentName }: { studentName: string }) {
  return (
    <header className="flex h-16 shrink-0 items-center gap-2">
      <div className="flex items-center gap-2 px-4">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mr-2 data-vertical:h-4 data-vertical:self-auto"
        />
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem className="hidden md:block">
              <BreadcrumbLink href="/">Dashboard</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator className="hidden md:block" />
            <BreadcrumbItem className="hidden md:block">
              <BreadcrumbLink href="/family">Family</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator className="hidden md:block" />
            <BreadcrumbItem>
              <BreadcrumbPage>
                {studentName ? `Apply — ${studentName}` : "Apply"}
              </BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </div>
    </header>
  );
}

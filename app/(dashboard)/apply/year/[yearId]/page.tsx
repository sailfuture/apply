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
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";

interface SchoolYear {
  id: number;
  year_name: string;
  start_date: string | null;
  end_date: string | null;
  tuition: number;
  annual_fees: number;
  transportation_fees: number;
  fes_eo_9: number;
  fes_eo_8: number;
  ftc_8: number;
  ftc_9: number;
  fes_ua_8_ese_1_3: number;
  fes_ua_9_ese_1_3: number;
  fes_ua_ese_4: number;
  fes_ua_ese_5: number;
  opportunity_scholarship_award: number;
  isActive: boolean;
  isPast: boolean;
  isNextYear: boolean;
  isFuture: boolean;
  application_deadline: string | null;
  scholarship_deadline: string | null;
}

function isDeadlinePassed(deadline: string | null): boolean {
  if (!deadline) return false;
  const now = new Date();
  const dl = new Date(deadline + "T23:59:59");
  return now > dl;
}

interface Student {
  id: number;
  first_name: string;
  last_name: string;
  date_of_birth: string;
  gender: string;
  ethnicity: string;
}

interface Application {
  id: number;
  registration_students_id: number;
  registration_families_id: number;
  registration_application_status_id: number;
  registration_school_years_id: number;
  sufs_award_id: number;
  sufs_scholarship_type: string;
  annual_fee_waived: boolean;
  bus_transportation: string;
  current_previous_school: string;
}

const SUFS_TYPES: Record<string, string> = {
  fes_eo_8: "FES-EO (Grade 8)",
  fes_eo_9: "FES-EO (Grade 9)",
  ftc_8: "FTC (Grade 8)",
  ftc_9: "FTC (Grade 9)",
  fes_ua_8_ese_1_3: "FES-UA ESE 1-3 (Grade 8)",
  fes_ua_9_ese_1_3: "FES-UA ESE 1-3 (Grade 9)",
  fes_ua_ese_4: "FES-UA ESE 4",
  fes_ua_ese_5: "FES-UA ESE 5",
};

function getSufsAmount(type: string, year: SchoolYear): number {
  const key = type as keyof SchoolYear;
  if (key && key in year) {
    const val = year[key];
    if (typeof val === "number") return val;
  }
  return 0;
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

function formatDateShort(date: string | null): string {
  if (!date) return "TBD";
  return new Date(date + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getInitials(first: string, last: string): string {
  return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
}

const avatarColors = [
  "bg-blue-500",
  "bg-emerald-500",
  "bg-violet-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-cyan-500",
  "bg-indigo-500",
  "bg-teal-500",
];

function getAvatarColor(id: number): string {
  return avatarColors[id % avatarColors.length];
}

function formatAge(dob: string): string {
  const birth = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (
    monthDiff < 0 ||
    (monthDiff === 0 && today.getDate() < birth.getDate())
  ) {
    age--;
  }
  return `${age}`;
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

const statusColors: Record<string, string> = {
  Draft: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400",
  Submitted:
    "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  "Under Review":
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  Accepted:
    "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  Denied: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  Waitlisted:
    "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
};

export default function YearDetailPage() {
  const params = useParams();
  const router = useRouter();
  const yearId = Number(params.yearId);

  const [schoolYear, setSchoolYear] = useState<SchoolYear | null>(null);
  const [allYears, setAllYears] = useState<SchoolYear[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [statuses, setStatuses] = useState<Record<number, string>>({});
  const [scholarshipExists, setScholarshipExists] = useState(false);
  const [loading, setLoading] = useState(true);
  const [familyId, setFamilyId] = useState<number | null>(null);

  const [addingStudentId, setAddingStudentId] = useState<number | null>(null);

  const [startSheetOpen, setStartSheetOpen] = useState(false);
  const [priorScholarships, setPriorScholarships] = useState<
    { id: number; year_name: string; registration_school_years_id: number }[]
  >([]);
  const [duplicating, setDuplicating] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const familyRes = await fetch("/api/families");
      let fId: number | null = null;
      if (familyRes.ok) {
        const fam = await familyRes.json();
        if (fam?.id) {
          fId = fam.id;
          setFamilyId(fId);
        }
      }

      const fetches: Promise<Response>[] = [
        fetch("/api/school-years"),
        fetch("/api/students"),
        fetch("/api/applications"),
        fetch("/api/application-statuses"),
      ];
      if (fId) {
        fetches.push(
          fetch(`/api/scholarship?familyId=${fId}&yearId=${yearId}`)
        );
      }

      const [yearsRes, studentsRes, appsRes, statusesRes, scholarshipRes] =
        await Promise.all(fetches);

      if (yearsRes.ok) {
        const years: SchoolYear[] = await yearsRes.json();
        setAllYears(years);
        const found = years.find((y) => y.id === yearId);
        if (found) setSchoolYear(found);
      }

      if (studentsRes.ok) setStudents(await studentsRes.json());

      if (appsRes.ok) {
        const allApps: Application[] = await appsRes.json();
        setApplications(
          allApps.filter((a) => a.registration_school_years_id === yearId)
        );
      }

      if (statusesRes.ok) {
        const statusList: { id: number; status_name: string }[] =
          await statusesRes.json();
        const map: Record<number, string> = {};
        statusList.forEach((s) => (map[s.id] = s.status_name));
        setStatuses(map);
      }

      if (scholarshipRes?.ok) {
        const data = await scholarshipRes.json();
        if (data && data.id) setScholarshipExists(true);
      }
    } catch (err) {
      console.error("Failed to fetch data:", err);
    } finally {
      setLoading(false);
    }
  }, [yearId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  function getStudent(studentId: number): Student | undefined {
    return students.find((s) => s.id === studentId);
  }

  function getStatusName(statusId: number): string {
    return statuses[statusId] ?? "Unknown";
  }

  // Students that have an application for this year
  const studentsWithApps = applications
    .map((app) => ({
      app,
      student: getStudent(app.registration_students_id),
    }))
    .filter(
      (item): item is { app: Application; student: Student } =>
        !!item.student
    );

  // Students that don't yet have an application for this year
  const studentsWithoutApps = students.filter(
    (s) =>
      !applications.some((a) => a.registration_students_id === s.id)
  );

  async function handleStartScholarship() {
    if (!familyId) return;

    const res = await fetch(`/api/scholarship?familyId=${familyId}`);
    if (res.ok) {
      const allScholarships: {
        id: number;
        registration_school_years_id: number;
      }[] = await res.json();

      const otherYearScholarships = allScholarships
        .filter((s) => s.registration_school_years_id !== yearId)
        .map((s) => {
          const yr = allYears.find((y) => y.id === s.registration_school_years_id);
          return {
            id: s.id,
            year_name: yr?.year_name ?? `Year #${s.registration_school_years_id}`,
            registration_school_years_id: s.registration_school_years_id,
          };
        });

      setPriorScholarships(otherYearScholarships);
    }

    setStartSheetOpen(true);
  }

  async function handleDuplicate(sourceScholarshipId: number) {
    if (!familyId) return;
    setDuplicating(true);
    try {
      const res = await fetch("/api/scholarship/duplicate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_scholarship_id: sourceScholarshipId,
          registration_families_id: familyId,
          registration_school_years_id: yearId,
        }),
      });
      if (res.ok) {
        setStartSheetOpen(false);
        router.push(`/apply/year/${yearId}/scholarship`);
      }
    } catch (err) {
      console.error("Duplicate failed:", err);
    } finally {
      setDuplicating(false);
    }
  }

  function handleStartFresh() {
    setStartSheetOpen(false);
    router.push(`/apply/year/${yearId}/scholarship`);
  }

  async function handleAddStudent(studentId: number) {
    setAddingStudentId(studentId);
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
        const newApp = await res.json();
        setApplications((prev) => [...prev, newApp]);
      }
    } catch (err) {
      console.error("Failed to add student:", err);
    } finally {
      setAddingStudentId(null);
    }
  }

  if (loading) {
    return (
      <>
        <PageHeader yearName="" />
        <div className="flex min-h-[60vh] items-center justify-center">
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </>
    );
  }

  if (!schoolYear) {
    return (
      <>
        <PageHeader yearName="" />
        <div className="flex min-h-[60vh] items-center justify-center">
          <p className="text-muted-foreground">School year not found.</p>
        </div>
      </>
    );
  }

  const badge = getYearTypeBadge(schoolYear);
  const appDeadlinePassed = isDeadlinePassed(schoolYear.application_deadline);
  const scholarshipDeadlinePassed = isDeadlinePassed(
    schoolYear.scholarship_deadline
  );

  return (
    <>
      <PageHeader yearName={schoolYear.year_name} />
      <div className="flex flex-1 flex-col gap-6 p-4 pt-0">
        {/* Year Overview */}
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold">
                {schoolYear.year_name}
              </h1>
              {badge && (
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${badge.className}`}
                >
                  {badge.label}
                </span>
              )}
            </div>
            <p className="text-muted-foreground text-sm">
              {formatDate(schoolYear.start_date)} &mdash;{" "}
              {formatDate(schoolYear.end_date)}
            </p>
          </div>
        </div>

        {/* Year Details Card */}
        <Card>
          <CardHeader>
            <CardTitle>Year Details</CardTitle>
            <CardDescription>
              Tuition, fees, and deadline information for this school year.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3 lg:grid-cols-5">
              <div>
                <p className="text-muted-foreground text-xs">Tuition</p>
                <p className="font-medium">
                  {formatCurrency(schoolYear.tuition)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Annual Fees</p>
                <p className="font-medium">
                  {formatCurrency(schoolYear.annual_fees)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Transportation</p>
                <p className="font-medium">
                  {formatCurrency(schoolYear.transportation_fees)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">
                  Application Deadline
                </p>
                <p
                  className={`font-medium ${appDeadlinePassed ? "text-red-600 dark:text-red-400" : ""}`}
                >
                  {schoolYear.application_deadline
                    ? formatDate(schoolYear.application_deadline)
                    : "No deadline"}
                  {appDeadlinePassed && (
                    <span className="ml-1.5 text-[10px] font-normal uppercase">
                      Closed
                    </span>
                  )}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">
                  Scholarship Deadline
                </p>
                <p
                  className={`font-medium ${scholarshipDeadlinePassed ? "text-red-600 dark:text-red-400" : ""}`}
                >
                  {schoolYear.scholarship_deadline
                    ? formatDate(schoolYear.scholarship_deadline)
                    : "No deadline"}
                  {scholarshipDeadlinePassed && (
                    <span className="ml-1.5 text-[10px] font-normal uppercase">
                      Closed
                    </span>
                  )}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Opportunity Scholarship */}
        <Card>
          <CardHeader>
            <CardTitle>Opportunity Scholarship</CardTitle>
            <CardDescription>
              Family scholarship submission for {schoolYear.year_name}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span
                  className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    scholarshipExists
                      ? "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400"
                      : "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400"
                  }`}
                >
                  {scholarshipExists ? "In Progress" : "Not Started"}
                </span>
                <p className="text-muted-foreground text-sm">
                  {scholarshipDeadlinePassed
                    ? "The scholarship deadline has passed for this year."
                    : scholarshipExists
                      ? "Your scholarship application is in progress."
                      : "No scholarship application has been started for this year."}
                </p>
              </div>
              {scholarshipDeadlinePassed ? (
                scholarshipExists ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      router.push(`/apply/year/${yearId}/scholarship`)
                    }
                  >
                    View Application
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" disabled>
                    Deadline Passed
                  </Button>
                )
              ) : !schoolYear.isPast ? (
                scholarshipExists ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      router.push(`/apply/year/${yearId}/scholarship`)
                    }
                  >
                    Continue Application
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleStartScholarship}
                  >
                    Start Application
                  </Button>
                )
              ) : null}
            </div>
          </CardContent>
        </Card>

        {/* Annual Cost Breakdown */}
        {studentsWithApps.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Annual Cost Breakdown</CardTitle>
              <CardDescription>
                Estimated costs based on student preferences and scholarship
                awards for {schoolYear.year_name}.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg border">
                <table className="w-full">
                  <thead>
                    <tr className="border-b">
                      <th className="text-muted-foreground px-4 py-3 text-left text-xs font-medium uppercase tracking-wider">
                        Description
                      </th>
                      <th className="text-muted-foreground px-4 py-3 text-right text-xs font-medium uppercase tracking-wider">
                        Amount
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {/* Costs & Fees */}
                    <tr className="bg-muted/20">
                      <td
                        colSpan={2}
                        className="px-4 py-2 text-xs font-semibold uppercase tracking-wider"
                      >
                        Costs &amp; Fees
                      </td>
                    </tr>
                    {studentsWithApps.map(({ app, student }) => {
                      const hasTransport =
                        app.bus_transportation?.toLowerCase() === "yes";
                      const name = `${student.first_name} ${student.last_name}`;

                      return (
                        <CostFeeRows
                          key={student.id}
                          studentName={name}
                          tuition={schoolYear.tuition}
                          annualFee={schoolYear.annual_fees}
                          annualFeeWaived={app.annual_fee_waived}
                          transportationFee={schoolYear.transportation_fees}
                          hasTransport={hasTransport}
                        />
                      );
                    })}

                    {/* Scholarships & Deductions */}
                    <tr className="bg-muted/20">
                      <td
                        colSpan={2}
                        className="px-4 py-2 text-xs font-semibold uppercase tracking-wider"
                      >
                        Scholarships &amp; Deductions
                      </td>
                    </tr>
                    {studentsWithApps.map(({ app, student }) => {
                      const sufsAmt = app.sufs_scholarship_type
                        ? getSufsAmount(
                            app.sufs_scholarship_type,
                            schoolYear
                          )
                        : 0;
                      const name = `${student.first_name} ${student.last_name}`;
                      const hasSufs =
                        !!app.sufs_scholarship_type &&
                        app.sufs_scholarship_type !== "none";

                      return (
                        <tr key={student.id}>
                          <td className="px-4 py-2 text-sm">
                            <div className="flex items-center gap-2">
                              <div>
                                <span className="font-medium">{name}</span>
                                <span className="text-muted-foreground">
                                  {" — "}
                                  {hasSufs
                                    ? (SUFS_TYPES[
                                        app.sufs_scholarship_type
                                      ] ?? "SUFS Scholarship")
                                    : "Step Up for Students Scholarship"}
                                </span>
                              </div>
                              {!hasSufs && (
                                <span
                                  className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
                                  title="No SUFS scholarship type selected"
                                >
                                  <svg
                                    className="size-3"
                                    viewBox="0 0 20 20"
                                    fill="currentColor"
                                  >
                                    <path
                                      fillRule="evenodd"
                                      d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 6a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 6zm0 9a1 1 0 100-2 1 1 0 000 2z"
                                      clipRule="evenodd"
                                    />
                                  </svg>
                                  Missing
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-2 text-right text-sm">
                            {sufsAmt > 0 ? (
                              <span className="text-green-600 dark:text-green-400">
                                -{formatCurrency(sufsAmt)}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">$0</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}

                    <tr>
                      <td className="px-4 py-2 text-sm">
                        <div className="flex items-center gap-2">
                          <div>
                            <span className="font-medium">
                              SailFuture Opportunity Scholarship Award
                            </span>
                          </div>
                          {!scholarshipExists && (
                            <span
                              className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
                              title="No opportunity scholarship application"
                            >
                              <svg
                                className="size-3"
                                viewBox="0 0 20 20"
                                fill="currentColor"
                              >
                                <path
                                  fillRule="evenodd"
                                  d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 6a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 6zm0 9a1 1 0 100-2 1 1 0 000 2z"
                                  clipRule="evenodd"
                                />
                              </svg>
                              Not Started
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2 text-right text-sm">
                        <div className="flex items-center justify-end gap-2">
                          {scholarshipExists &&
                          schoolYear.opportunity_scholarship_award > 0 ? (
                            <span className="font-medium text-green-600 dark:text-green-400">
                              -{formatCurrency(schoolYear.opportunity_scholarship_award)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">$0</span>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() =>
                              router.push(
                                `/apply/year/${yearId}/scholarship`
                              )
                            }
                          >
                            {scholarshipExists ? "View" : "Apply"} &rarr;
                          </Button>
                        </div>
                      </td>
                    </tr>

                    {/* Total */}
                    <tr className="bg-muted/30 font-semibold">
                      <td className="px-4 py-3 text-sm">
                        Estimated Annual Total
                      </td>
                      <td className="px-4 py-3 text-right text-sm">
                        {(() => {
                          let total = 0;
                          studentsWithApps.forEach(({ app }) => {
                            total += schoolYear.tuition ?? 0;

                            if (app.sufs_scholarship_type) {
                              total -= getSufsAmount(
                                app.sufs_scholarship_type,
                                schoolYear
                              );
                            }

                            if (!app.annual_fee_waived) {
                              total += schoolYear.annual_fees ?? 0;
                            }

                            if (
                              app.bus_transportation?.toLowerCase() === "yes"
                            ) {
                              total += schoolYear.transportation_fees ?? 0;
                            }
                          });

                          if (
                            scholarshipExists &&
                            schoolYear.opportunity_scholarship_award > 0
                          ) {
                            total -= schoolYear.opportunity_scholarship_award;
                          }

                          return formatCurrency(Math.max(total, 0));
                        })()}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Student Applications */}
        <div>
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Student Applications</h2>
              <p className="text-muted-foreground text-sm">
                Select which students to include in this year&apos;s
                application.
              </p>
            </div>
          </div>

          {students.length === 0 ? (
            <div className="flex min-h-[20vh] items-center justify-center rounded-lg border">
              <p className="text-muted-foreground text-sm">
                No students in your family yet. Add students from the{" "}
                <button
                  type="button"
                  onClick={() => router.push("/family")}
                  className="text-primary underline"
                >
                  Family
                </button>{" "}
                page.
              </p>
            </div>
          ) : (
            <div className="rounded-lg border">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-muted-foreground px-4 py-3 text-left text-xs font-medium uppercase tracking-wider">
                      Student
                    </th>
                    <th className="text-muted-foreground hidden px-4 py-3 text-left text-xs font-medium uppercase tracking-wider sm:table-cell">
                      Date of Birth
                    </th>
                    <th className="text-muted-foreground hidden px-4 py-3 text-left text-xs font-medium uppercase tracking-wider md:table-cell">
                      Age
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
                  {students.map((student) => {
                    const appMatch = applications.find(
                      (a) => a.registration_students_id === student.id
                    );
                    const isEnrolled = !!appMatch;
                    const canApply =
                      !schoolYear.isPast && !appDeadlinePassed;
                    const status = isEnrolled
                      ? getStatusName(
                          appMatch.registration_application_status_id
                        )
                      : null;
                    const colorClass = status
                      ? statusColors[status] ??
                        "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400"
                      : "";

                    return (
                      <tr
                        key={student.id}
                        onClick={() =>
                          isEnrolled &&
                          router.push(`/apply/${student.id}`)
                        }
                        className={`transition-colors ${
                          isEnrolled
                            ? "hover:bg-muted/50 cursor-pointer"
                            : ""
                        }`}
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <Avatar size="default">
                              <AvatarFallback
                                className={`${getAvatarColor(student.id)} text-xs font-medium text-white`}
                              >
                                {getInitials(
                                  student.first_name,
                                  student.last_name
                                )}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <p className="text-sm font-medium">
                                {student.first_name} {student.last_name}
                              </p>
                              {student.ethnicity && (
                                <p className="text-muted-foreground text-xs">
                                  {student.ethnicity}
                                </p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="text-muted-foreground hidden px-4 py-3 text-sm sm:table-cell">
                          {student.date_of_birth
                            ? formatDateShort(student.date_of_birth)
                            : "—"}
                        </td>
                        <td className="text-muted-foreground hidden px-4 py-3 text-sm md:table-cell">
                          {student.date_of_birth
                            ? formatAge(student.date_of_birth)
                            : "—"}
                        </td>
                        <td className="px-4 py-3">
                          {isEnrolled ? (
                            <span
                              className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${colorClass}`}
                            >
                              {status}
                            </span>
                          ) : appDeadlinePassed ? (
                            <span className="text-muted-foreground text-xs">
                              Deadline passed
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-xs">
                              Not added
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {isEnrolled ? (
                            <span className="text-muted-foreground text-xs">
                              View &rarr;
                            </span>
                          ) : canApply ? (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 px-3 text-xs"
                              disabled={addingStudentId === student.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleAddStudent(student.id);
                              }}
                            >
                              {addingStudentId === student.id
                                ? "Adding..."
                                : "Add to Application"}
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Start Scholarship Sheet */}
      <Sheet open={startSheetOpen} onOpenChange={setStartSheetOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Start Scholarship Application</SheetTitle>
            <SheetDescription>
              Choose how you&apos;d like to begin your opportunity scholarship
              application for {schoolYear?.year_name}.
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-4 p-4">
            <Button onClick={handleStartFresh} variant="default">
              Start from Scratch
            </Button>

            {priorScholarships.length > 0 && (
              <>
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-background text-muted-foreground px-2">
                      or copy from a previous year
                    </span>
                  </div>
                </div>

                <div className="space-y-2">
                  {priorScholarships.map((ps) => (
                    <Button
                      key={ps.id}
                      variant="outline"
                      className="w-full justify-start"
                      disabled={duplicating}
                      onClick={() => handleDuplicate(ps.id)}
                    >
                      {duplicating
                        ? "Copying..."
                        : `Copy from ${ps.year_name}`}
                    </Button>
                  ))}
                </div>
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

function CostFeeRows({
  studentName,
  tuition,
  annualFee,
  annualFeeWaived,
  transportationFee,
  hasTransport,
}: {
  studentName: string;
  tuition: number;
  annualFee: number;
  annualFeeWaived: boolean;
  transportationFee: number;
  hasTransport: boolean;
}) {
  return (
    <>
      <tr>
        <td className="px-4 py-2 text-sm">
          <span className="font-medium">{studentName}</span>
          <span className="text-muted-foreground"> — Tuition</span>
        </td>
        <td className="px-4 py-2 text-right text-sm">
          {tuition ? formatCurrency(tuition) : "—"}
        </td>
      </tr>

      <tr>
        <td className="px-4 py-2 text-sm">
          <span className="font-medium">{studentName}</span>
          <span className="text-muted-foreground"> — Annual Fee</span>
        </td>
        <td className="px-4 py-2 text-right text-sm">
          {annualFeeWaived ? (
            <span className="text-green-600 dark:text-green-400 italic">
              Waived
            </span>
          ) : annualFee ? (
            formatCurrency(annualFee)
          ) : (
            "—"
          )}
        </td>
      </tr>

      <tr>
        <td className="px-4 py-2 text-sm">
          <span className="font-medium">{studentName}</span>
          <span className="text-muted-foreground"> — Transportation Fee</span>
        </td>
        <td className="px-4 py-2 text-right text-sm">
          {hasTransport && transportationFee ? (
            formatCurrency(transportationFee)
          ) : (
            <span className="text-muted-foreground">$0</span>
          )}
        </td>
      </tr>
    </>
  );
}

function PageHeader({ yearName }: { yearName: string }) {
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
              <BreadcrumbLink href="/apply">Applications</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator className="hidden md:block" />
            <BreadcrumbItem>
              <BreadcrumbPage>
                {yearName || "School Year"}
              </BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </div>
    </header>
  );
}

"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import { useParams, useRouter } from "next/navigation";
import { useApplicationFlow } from "@/contexts/application-flow-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Field, FieldLabel } from "@/components/ui/field";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
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
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Trash2, FileUp, X, Loader2, CheckCircle2 } from "lucide-react";
import {
  FileUpload,
  FileUploadDropzone,
  FileUploadItem,
  FileUploadItemDelete,
  FileUploadItemMetadata,
  FileUploadItemPreview,
  FileUploadList,
} from "@/components/ui/file-upload";

interface Parent {
  id: number;
  first_name: string;
  last_name: string;
  address_line_1: string;
  address_line_2: string;
  city: string;
  state: string;
  zipcode: string;
}

interface Student {
  id: number;
  first_name: string;
  last_name: string;
  date_of_birth: string;
  gender: string;
  ethnicity: string;
  photo: string | null;
}

interface Application {
  id: number;
  registration_students_id: number;
  registration_school_years_id: number;
  registration_parents_id: number;
  sufs_award_id: number;
  is_bus_transportation: boolean;
  bus_stop: string;
  current_previous_school: string;
  describe_student_strengths: string;
  describe_student_opportunities_for_growth: string;
  last_grade_completed: string;
  current_grade: string;
  nwea_testing_complete: boolean;
  test_scores: Record<string, unknown> | null;
}

interface BusStop {
  id: number;
  name: string;
  pick_up_time: number;
  drop_off_time: number;
  address: string;
}

function formatAge(dob: string): string {
  const birth = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate()))
    age--;
  return `${age}`;
}

function formatDob(dob: string): string {
  if (!dob) return "—";
  return new Date(dob + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
  });
}

export default function StudentsStepPage() {
  const params = useParams();
  const router = useRouter();
  const yearId = Number(params.yearId);

  const {
    setPageTitle,
    registerSaveHandler,
    unregisterSaveHandler,
    updateSaveOptions,
    registerBackGuard,
    unregisterBackGuard,
  } = useApplicationFlow();

  const [parents, setParents] = useState<Parent[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [busStops, setBusStops] = useState<BusStop[]>([]);
  const [yearName, setYearName] = useState("");
  const [loading, setLoading] = useState(true);
  const [addingStudentId, setAddingStudentId] = useState<number | null>(null);
  const [collapsedCards, setCollapsedCards] = useState<Set<number>>(new Set());
  const [savedApplications, setSavedApplications] = useState<Application[]>([]);
  const [pendingNavPath, setPendingNavPath] = useState<string | null>(null);

  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addError, setAddError] = useState("");

  const [createSheetOpen, setCreateSheetOpen] = useState(false);
  const [newFirst, setNewFirst] = useState("");
  const [newLast, setNewLast] = useState("");
  const [newDob, setNewDob] = useState("");
  const [newGender, setNewGender] = useState("");
  const [newEthnicity, setNewEthnicity] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const [uploadingPhotoId, setUploadingPhotoId] = useState<number | null>(null);
  const [savingAppId, setSavingAppId] = useState<number | null>(null);
  const [pendingDeleteStudent, setPendingDeleteStudent] = useState<{ appId: number; name: string } | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const photoTargetStudentId = useRef<number | null>(null);

  async function handlePhotoUpload(studentId: number, file: File) {
    setUploadingPhotoId(studentId);
    try {
      const base64 = await fileToBase64(file);
      const res = await fetch(`/api/students/${studentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photo: base64 }),
      });
      if (res.ok) {
        const updated = await res.json();
        setStudents((prev) =>
          prev.map((s) => (s.id === studentId ? { ...s, photo: updated.photo } : s))
        );
      }
    } catch (err) {
      console.error("Failed to upload photo:", err);
    } finally {
      setUploadingPhotoId(null);
    }
  }

  const fetchData = useCallback(async () => {
    try {
      const [familyRes, yearsRes, studentsRes, appsRes, busRes] =
        await Promise.all([
          fetch("/api/families"),
          fetch("/api/school-years"),
          fetch("/api/students"),
          fetch("/api/applications"),
          fetch("/api/bus-stops"),
        ]);
      if (familyRes.ok) {
        const fam = await familyRes.json();
        setParents(fam.parents ?? []);
      }
      if (yearsRes.ok) {
        const years = await yearsRes.json();
        const found = years.find((y: { id: number }) => y.id === yearId);
        if (found) setYearName(found.year_name);
      }
      let loadedStudents: Student[] = [];
      if (studentsRes.ok) {
        loadedStudents = await studentsRes.json();
        setStudents(loadedStudents);
      }
      if (appsRes.ok) {
        const allApps: Application[] = await appsRes.json();
        const yearApps = allApps.filter((a) => a.registration_school_years_id === yearId);
        setApplications(yearApps);
        setSavedApplications(yearApps);
        // Auto-collapse complete student cards
        const completeIds = new Set<number>();
        for (const app of yearApps) {
          if (isAppComplete(app)) {
            const student = loadedStudents.find((s) => s.id === app.registration_students_id);
            if (student) completeIds.add(student.id);
          }
        }
        if (completeIds.size > 0) setCollapsedCards(completeIds);
      }
      if (busRes.ok) setBusStops(await busRes.json());
    } catch (err) {
      console.error("Failed to fetch:", err);
    } finally {
      setLoading(false);
    }
  }, [yearId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function handleAddToYear(studentId: number) {
    setAddingStudentId(studentId);
    setAddError("");
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
        setSavedApplications((prev) => [...prev, newApp]);
      } else {
        const body = await res.json().catch(() => null);
        setAddError(body?.error ?? `Failed to add student (${res.status})`);
      }
    } catch {
      setAddError("Network error — please try again");
    } finally {
      setAddingStudentId(null);
    }
  }

  async function handleRemoveStudent(appId: number) {
    try {
      const res = await fetch(`/api/applications/${appId}`, { method: "DELETE" });
      if (res.ok) {
        setApplications((prev) => prev.filter((a) => a.id !== appId));
        setSavedApplications((prev) => prev.filter((a) => a.id !== appId));
      }
    } catch (err) {
      console.error("Failed to remove student:", err);
    }
    setPendingDeleteStudent(null);
  }

  function isAppComplete(app: Application): boolean {
    if (!app.current_previous_school) return false;
    if (!app.last_grade_completed) return false;
    if (!app.current_grade) return false;
    if (!app.describe_student_strengths) return false;
    if (!app.describe_student_opportunities_for_growth) return false;
    if (app.is_bus_transportation && (!app.registration_parents_id || !app.bus_stop)) return false;
    return true;
  }

  function toggleCard(studentId: number) {
    setCollapsedCards((prev) => {
      const next = new Set(prev);
      if (next.has(studentId)) next.delete(studentId);
      else next.add(studentId);
      return next;
    });
  }

  const trackedFields: (keyof Application)[] = [
    "sufs_award_id", "is_bus_transportation", "bus_stop",
    "registration_parents_id", "current_previous_school",
    "last_grade_completed", "current_grade",
    "describe_student_strengths", "describe_student_opportunities_for_growth",
  ];

  const isDirty = applications.some((app) => {
    const saved = savedApplications.find((s) => s.id === app.id);
    if (!saved) return false;
    return trackedFields.some((f) => app[f] !== saved[f]);
  });

  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

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

  const [savingAll, setSavingAll] = useState(false);

  async function handleSaveAllApps() {
    setSavingAll(true);
    try {
      await Promise.all(
        applications.map((app) =>
          fetch(`/api/applications/${app.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sufs_award_id: app.sufs_award_id,
              is_bus_transportation: app.is_bus_transportation,
              bus_stop: app.bus_stop,
              registration_parents_id: app.registration_parents_id,
              current_previous_school: app.current_previous_school,
              last_grade_completed: app.last_grade_completed,
              current_grade: app.current_grade,
              describe_student_strengths: app.describe_student_strengths,
              describe_student_opportunities_for_growth:
                app.describe_student_opportunities_for_growth,
            }),
          })
        )
      );
      setSavedApplications(applications.map((a) => ({ ...a })));
      toast.success("Section saved successfully");
    } catch (err) {
      console.error("Failed to save:", err);
      toast.error("Failed to save — please try again");
    } finally {
      setSavingAll(false);
    }
  }

  const handleSaveAllAppsRef = useRef(handleSaveAllApps);
  handleSaveAllAppsRef.current = handleSaveAllApps;

  useEffect(() => {
    setPageTitle("Students & Information");
    registerSaveHandler(() => handleSaveAllAppsRef.current(), { label: "Save" });
    return () => {
      unregisterSaveHandler();
      unregisterBackGuard();
    };
  }, [setPageTitle, registerSaveHandler, unregisterSaveHandler, unregisterBackGuard]);

  useEffect(() => {
    updateSaveOptions({ saving: savingAll });
  }, [savingAll, updateSaveOptions]);

  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;

  useEffect(() => {
    registerBackGuard(() => {
      if (isDirtyRef.current) {
        setPendingNavPath(`/apply/year/${yearId}`);
        return false;
      }
      return true;
    });
  }, [registerBackGuard, yearId]);

  async function handleCreateStudent(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setCreateError("");
    try {
      const res = await fetch("/api/students", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          first_name: newFirst,
          last_name: newLast,
          date_of_birth: newDob || null,
          gender: newGender,
          ethnicity: newEthnicity,
        }),
      });
      if (res.ok) {
        setCreateSheetOpen(false);
        setNewFirst("");
        setNewLast("");
        setNewDob("");
        setNewGender("");
        setNewEthnicity("");
        await fetchData();
      } else {
        const body = await res.json().catch(() => null);
        setCreateError(body?.error ?? "Failed to add student");
      }
    } catch {
      setCreateError("Network error — please try again");
    } finally {
      setCreating(false);
    }
  }

  const enrolled = applications
    .map((app) => ({
      app,
      student: students.find((s) => s.id === app.registration_students_id),
    }))
    .filter(
      (x): x is { app: Application; student: Student } => !!x.student
    );

  const notEnrolled = students.filter(
    (s) => !applications.some((a) => a.registration_students_id === s.id)
  );

  if (loading) {
    return (
      <div className="flex flex-1 flex-col gap-6 p-6 mx-auto w-full max-w-4xl">
        <div className="flex items-center justify-between">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-9 w-32 rounded-md" />
        </div>
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="rounded-lg border p-6">
            <div className="flex items-center justify-between mb-4">
              <Skeleton className="h-5 w-36" />
              <Skeleton className="h-5 w-5 rounded" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {Array.from({ length: 8 }).map((_, j) => (
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
        <div className="flex items-center justify-between">
          <div className="flex-1 text-center">
            <h1 className="text-2xl font-semibold">
              Students &amp; Information
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Manage enrolled students, transportation, scholarships, and
              testing.
            </p>
          </div>
          {isDirty && (
            <span className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
              <svg className="size-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 6a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 6zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
              </svg>
              Unsaved changes
            </span>
          )}
        </div>

        {enrolled.length === 0 ? (
          <div className="flex min-h-[20vh] items-center justify-center rounded-lg border">
            <p className="text-muted-foreground text-sm">
              No students enrolled yet. Click &quot;Add Student&quot; to get
              started.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {enrolled.map(({ app, student }, idx) => (
              <Card key={student.id} className="overflow-hidden gap-0 py-0">
                <CardHeader
                  className={`py-3 !pb-3 cursor-pointer ${collapsedCards.has(student.id) ? "" : "border-b"}`}
                  onClick={() => toggleCard(student.id)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        className="relative group rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        disabled={uploadingPhotoId === student.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          photoTargetStudentId.current = student.id;
                          photoInputRef.current?.click();
                        }}
                      >
                        <Avatar className="size-10">
                          {student.photo ? (
                            <AvatarImage
                              src={student.photo}
                              alt={`${student.first_name} ${student.last_name}`}
                            />
                          ) : null}
                          <AvatarFallback className="bg-muted text-muted-foreground text-sm font-medium">
                            {student.first_name.charAt(0)}
                            {student.last_name.charAt(0)}
                          </AvatarFallback>
                        </Avatar>
                        <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity">
                          <svg className="size-4" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M1 8a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 018.07 3h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0016.07 6H17a2 2 0 012 2v7a2 2 0 01-2 2H3a2 2 0 01-2-2V8z" />
                            <path d="M10 14a3 3 0 100-6 3 3 0 000 6z" />
                          </svg>
                        </span>
                      </button>
                      <CardTitle className="text-lg">
                        {student.first_name} {student.last_name}
                      </CardTitle>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant={idx === enrolled.length - 1 ? "default" : "outline"}
                        size="sm"
                        onClick={(e) => { e.stopPropagation(); setAddDialogOpen(true); }}
                        disabled={idx !== enrolled.length - 1}
                      >
                        Add Another Student
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        className="size-8 text-muted-foreground hover:text-red-600"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPendingDeleteStudent({ appId: app.id, name: `${student.first_name} ${student.last_name}` });
                        }}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                      <span className={`inline-flex items-center justify-center size-7 rounded-md border border-input text-muted-foreground transition-all hover:bg-muted ${collapsedCards.has(student.id) ? "" : "rotate-180"}`}>
                        <svg className="size-4" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                        </svg>
                      </span>
                    </div>
                  </div>
                </CardHeader>
                {!collapsedCards.has(student.id) && (
                <CardContent className="space-y-6 py-5 bg-gray-50 dark:bg-muted/50">
                  {/* Student Information */}
                  <section>
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                      Student Information
                    </h3>
                    <div className="grid gap-x-8 gap-y-2 sm:grid-cols-2 lg:grid-cols-3 pb-4 mb-4 border-b">
                      <div>
                        <p className="text-xs text-muted-foreground">
                          Date of Birth
                        </p>
                        <p className="text-sm font-medium">
                          {student.date_of_birth
                            ? `${formatDob(student.date_of_birth)} (Age ${formatAge(student.date_of_birth)})`
                            : "—"}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Gender</p>
                        <p className="text-sm font-medium">
                          {student.gender || "—"}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">
                          Ethnicity
                        </p>
                        <p className="text-sm font-medium">
                          {student.ethnicity || "—"}
                        </p>
                      </div>
                    </div>
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                      School Details
                    </h3>
                    <div className="grid gap-4 grid-cols-1 sm:grid-cols-[2fr_1fr_1fr]">
                      <Field>
                        <FieldLabel className="text-xs">
                          Current / Previous School
                        </FieldLabel>
                        <Input
                          className={!app.current_previous_school ? "border-red-400" : ""}
                          placeholder="School name"
                          value={app.current_previous_school || ""}
                          onChange={(e) =>
                            setApplications((prev) =>
                              prev.map((a) =>
                                a.id === app.id
                                  ? { ...a, current_previous_school: e.target.value }
                                  : a
                              )
                            )
                          }
                        />
                      </Field>
                      <Field>
                        <FieldLabel className="text-xs">
                          Last Grade Completed
                        </FieldLabel>
                        <Input
                          className={!app.last_grade_completed ? "border-red-400" : ""}
                          placeholder="e.g. 7th"
                          value={app.last_grade_completed || ""}
                          onChange={(e) =>
                            setApplications((prev) =>
                              prev.map((a) =>
                                a.id === app.id
                                  ? { ...a, last_grade_completed: e.target.value }
                                  : a
                              )
                            )
                          }
                        />
                      </Field>
                      <Field>
                        <FieldLabel className="text-xs">
                          Current Grade
                        </FieldLabel>
                        <Input
                          className={!app.current_grade ? "border-red-400" : ""}
                          placeholder="e.g. 8th"
                          value={app.current_grade || ""}
                          onChange={(e) =>
                            setApplications((prev) =>
                              prev.map((a) =>
                                a.id === app.id
                                  ? { ...a, current_grade: e.target.value }
                                  : a
                              )
                            )
                          }
                        />
                      </Field>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2 mt-4">
                      <Field>
                        <FieldLabel className="text-xs">
                          Describe Student Strengths
                        </FieldLabel>
                        <textarea
                          className={`flex min-h-[80px] w-full rounded-md border bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${!app.describe_student_strengths ? "border-red-400" : "border-input"}`}
                          placeholder="Student's strengths..."
                          value={app.describe_student_strengths || ""}
                          onChange={(e) =>
                            setApplications((prev) =>
                              prev.map((a) =>
                                a.id === app.id
                                  ? { ...a, describe_student_strengths: e.target.value }
                                  : a
                              )
                            )
                          }
                        />
                      </Field>
                      <Field>
                        <FieldLabel className="text-xs">
                          Describe Student Opportunities for Growth
                        </FieldLabel>
                        <textarea
                          className={`flex min-h-[80px] w-full rounded-md border bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${!app.describe_student_opportunities_for_growth ? "border-red-400" : "border-input"}`}
                          placeholder="Areas for growth..."
                          value={app.describe_student_opportunities_for_growth || ""}
                          onChange={(e) =>
                            setApplications((prev) =>
                              prev.map((a) =>
                                a.id === app.id
                                  ? { ...a, describe_student_opportunities_for_growth: e.target.value }
                                  : a
                              )
                            )
                          }
                        />
                      </Field>
                    </div>
                  </section>

                  <Separator />

                  {/* Step Up for Students Scholarship */}
                  <section>
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                      Step Up for Students Scholarship
                    </h3>
                    <div className="max-w-xs">
                      <Field>
                        <FieldLabel className="text-xs">SUFS Award ID</FieldLabel>
                        <Input
                          inputMode="numeric"
                          pattern="[0-9]*"
                          maxLength={6}
                          placeholder="000000"
                          className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                          value={app.sufs_award_id || ""}
                          onChange={(e) => {
                            const raw = e.target.value.replace(/\D/g, "").slice(0, 6);
                            setApplications((prev) =>
                              prev.map((a) =>
                                a.id === app.id
                                  ? { ...a, sufs_award_id: Number(raw) || 0 }
                                  : a
                              )
                            );
                          }}
                        />
                      </Field>
                    </div>
                  </section>

                  <Separator />

                  {/* Transportation */}
                  <section>
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                      Transportation
                    </h3>
                    <div className="space-y-4">
                      <div className="flex items-center gap-3">
                        <Switch
                          checked={app.is_bus_transportation}
                          onCheckedChange={(checked: boolean) =>
                            setApplications((prev) =>
                              prev.map((a) =>
                                a.id === app.id
                                  ? {
                                      ...a,
                                      is_bus_transportation: checked,
                                      ...(checked ? {} : { bus_stop: "", registration_parents_id: 0 }),
                                    }
                                  : a
                              )
                            )
                          }
                        />
                        <Label className="text-sm">
                          Will your student be riding the bus next academic
                          year?
                        </Label>
                      </div>
                      {app.is_bus_transportation && (() => {
                        const selectedParent = parents.find(
                          (p) => p.id === app.registration_parents_id
                        );
                        const fullAddress = selectedParent
                          ? [
                              selectedParent.address_line_1,
                              selectedParent.address_line_2,
                              selectedParent.city,
                              selectedParent.state,
                              selectedParent.zipcode,
                            ]
                              .filter(Boolean)
                              .join(", ")
                          : "";
                        return (
                          <div className="space-y-4">
                            <Field>
                              <FieldLabel className="text-xs">
                                Student Home Parent/Guardian
                              </FieldLabel>
                              <Select
                                value={
                                  app.registration_parents_id
                                    ? String(app.registration_parents_id)
                                    : ""
                                }
                                onValueChange={(v) => {
                                  const num = Number(v);
                                  setApplications((prev) =>
                                    prev.map((a) =>
                                      a.id === app.id
                                        ? { ...a, registration_parents_id: num }
                                        : a
                                    )
                                  );
                                }}
                              >
                                <SelectTrigger className={!app.registration_parents_id ? "border-red-400" : ""}>
                                  <SelectValue placeholder="Select parent/guardian" />
                                </SelectTrigger>
                                <SelectContent>
                                  {parents.map((p) => (
                                    <SelectItem
                                      key={p.id}
                                      value={String(p.id)}
                                    >
                                      {p.first_name} {p.last_name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </Field>
                            {selectedParent && (
                              <Field>
                                <FieldLabel className="text-xs">
                                  Student Home Address
                                </FieldLabel>
                                <Input
                                  value={fullAddress || "No address on file"}
                                  disabled
                                  className="bg-muted"
                                />
                              </Field>
                            )}
                            <Field>
                              <FieldLabel className="text-xs">
                                Bus Stop
                              </FieldLabel>
                              <Select
                                value={app.bus_stop || ""}
                                onValueChange={(v) =>
                                  setApplications((prev) =>
                                    prev.map((a) =>
                                      a.id === app.id
                                        ? { ...a, bus_stop: v }
                                        : a
                                    )
                                  )
                                }
                              >
                                <SelectTrigger className={!app.bus_stop ? "border-red-400" : ""}>
                                  <SelectValue placeholder="Select bus stop" />
                                </SelectTrigger>
                                <SelectContent>
                                  {busStops.map((bs) => (
                                    <SelectItem
                                      key={bs.id}
                                      value={bs.name}
                                    >
                                      <span className="truncate">
                                        {bs.name}
                                        {bs.address
                                          ? ` — ${bs.address}`
                                          : ""}
                                      </span>
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              {(() => {
                                const selectedStop = busStops.find(
                                  (bs) => bs.name === app.bus_stop
                                );
                                if (!selectedStop) return null;
                                const fmt = (t: number) => {
                                  const h = Math.floor(t / 100);
                                  const m = t % 100;
                                  const p = h >= 12 ? "PM" : "AM";
                                  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
                                  return `${h12}:${String(m).padStart(2, "0")} ${p}`;
                                };
                                return (
                                  <p className="text-xs text-muted-foreground mt-1.5">
                                    Pick up {fmt(selectedStop.pick_up_time)} · Drop off {fmt(selectedStop.drop_off_time)}
                                  </p>
                                );
                              })()}
                            </Field>
                          </div>
                        );
                      })()}
                    </div>
                  </section>

                  <Separator />

                  {/* NWEA Testing & Records */}
                  <section>
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                      NWEA Testing &amp; Records
                    </h3>
                    <div className="space-y-4">
                      <div className="space-y-2 text-sm text-muted-foreground">
                        <p>
                          All applying students must complete an NWEA screening in both Reading and Math. The assessment duration for each test ranges from 15 to 30 minutes, for a total time between 60–90 minutes.
                        </p>
                        <p>
                          Assessments are conducted on weekdays, from Tuesday to Friday, between 2:30 p.m. and 4 p.m. Please select a time slot within this period that is convenient for your student to take the test.
                        </p>
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <Field>
                          <FieldLabel className="text-xs">
                            Schedule an NWEA screening session
                          </FieldLabel>
                          <button
                            type="button"
                            className="flex w-full cursor-pointer items-center gap-3 rounded-md border border-dashed border-input bg-background px-4 py-3 text-left transition-colors hover:bg-muted/50"
                            onClick={() => setScheduleDialogOpen(true)}
                          >
                            <svg className="size-5 shrink-0 text-muted-foreground" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M5.75 2a.75.75 0 01.75.75V4h7V2.75a.75.75 0 011.5 0V4h.25A2.75 2.75 0 0118 6.75v8.5A2.75 2.75 0 0115.25 18H4.75A2.75 2.75 0 012 15.25v-8.5A2.75 2.75 0 014.75 4H5V2.75A.75.75 0 015.75 2zm-1 5.5c-.69 0-1.25.56-1.25 1.25v6.5c0 .69.56 1.25 1.25 1.25h10.5c.69 0 1.25-.56 1.25-1.25v-6.5c0-.69-.56-1.25-1.25-1.25H4.75z" clipRule="evenodd" />
                            </svg>
                            <div className="flex-1">
                              <p className="text-sm font-medium">Schedule NWEA Testing</p>
                              <p className="text-xs text-muted-foreground">Don&apos;t have recent test scores? Schedule a session.</p>
                            </div>
                          </button>
                        </Field>
                        <Field>
                          <FieldLabel className="text-xs">
                            Upload NWEA test scores from the past academic year
                          </FieldLabel>
                          <NweaFileUpload
                            existingFile={app.test_scores}
                            uploading={savingAppId === app.id}
                            onUpload={(file) => handleFileUpload(app.id, file)}
                            onRemove={() => {
                              setApplications((prev) =>
                                prev.map((a) =>
                                  a.id === app.id ? { ...a, test_scores: null } : a
                                )
                              );
                              fetch(`/api/applications/${app.id}`, {
                                method: "PATCH",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ test_scores: null }),
                              });
                            }}
                          />
                        </Field>
                      </div>
                    </div>
                  </section>
                </CardContent>
                )}
              </Card>
            ))}
          </div>
        )}

      </div>

      {/* Add Student Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Student to Application</DialogTitle>
            <DialogDescription>
              Select a student from your family to enroll for {yearName}, or
              create a new student.
            </DialogDescription>
          </DialogHeader>

          {addError && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
              {addError}
            </div>
          )}

          {notEnrolled.length > 0 ? (
            <div className="divide-y rounded-lg border">
              {notEnrolled.map((student) => (
                <div
                  key={student.id}
                  className="flex items-center justify-between px-4 py-3"
                >
                  <div>
                    <p className="text-sm font-medium">
                      {student.first_name} {student.last_name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {student.date_of_birth
                        ? `${formatDob(student.date_of_birth)} · Age ${formatAge(student.date_of_birth)}`
                        : "No date of birth"}
                      {student.gender ? ` · ${student.gender}` : ""}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    disabled={addingStudentId === student.id}
                    onClick={() => handleAddToYear(student.id)}
                  >
                    {addingStudentId === student.id ? "Adding..." : "Add"}
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border px-4 py-6 text-center">
              <p className="text-sm text-muted-foreground">
                All students in your family are already enrolled.
              </p>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => {
                setAddDialogOpen(false);
                setCreateError("");
                setCreateSheetOpen(true);
              }}
            >
              Create New Student
            </Button>
            <Button variant="ghost" onClick={() => setAddDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create New Student Sheet */}
      <Sheet open={createSheetOpen} onOpenChange={setCreateSheetOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Create New Student</SheetTitle>
            <SheetDescription>
              Add a new student to your family.
            </SheetDescription>
          </SheetHeader>
          <form
            onSubmit={handleCreateStudent}
            className="flex flex-col gap-4 p-4"
          >
            <Field>
              <FieldLabel>First Name</FieldLabel>
              <Input
                value={newFirst}
                onChange={(e) => setNewFirst(e.target.value)}
                required
              />
            </Field>
            <Field>
              <FieldLabel>Last Name</FieldLabel>
              <Input
                value={newLast}
                onChange={(e) => setNewLast(e.target.value)}
                required
              />
            </Field>
            <Field>
              <FieldLabel>Date of Birth</FieldLabel>
              <Input
                type="date"
                value={newDob}
                onChange={(e) => setNewDob(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel>Gender</FieldLabel>
              <Select value={newGender} onValueChange={setNewGender}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select gender" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Male">Male</SelectItem>
                  <SelectItem value="Female">Female</SelectItem>
                  <SelectItem value="Non-binary">Non-binary</SelectItem>
                  <SelectItem value="Prefer not to say">
                    Prefer not to say
                  </SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>Ethnicity</FieldLabel>
              <Select value={newEthnicity} onValueChange={setNewEthnicity}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select ethnicity" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="American Indian or Alaska Native">
                    American Indian or Alaska Native
                  </SelectItem>
                  <SelectItem value="Asian">Asian</SelectItem>
                  <SelectItem value="Black or African American">
                    Black or African American
                  </SelectItem>
                  <SelectItem value="Hispanic or Latino">
                    Hispanic or Latino
                  </SelectItem>
                  <SelectItem value="Native Hawaiian or Pacific Islander">
                    Native Hawaiian or Pacific Islander
                  </SelectItem>
                  <SelectItem value="White">White</SelectItem>
                  <SelectItem value="Two or More Races">
                    Two or More Races
                  </SelectItem>
                  <SelectItem value="Prefer not to say">
                    Prefer not to say
                  </SelectItem>
                </SelectContent>
              </Select>
            </Field>
            {createError && (
              <p className="text-sm text-red-600 dark:text-red-400">
                {createError}
              </p>
            )}
            <Button type="submit" disabled={creating} className="mt-2">
              {creating ? "Adding..." : "Add Student"}
            </Button>
          </form>
        </SheetContent>
      </Sheet>

      {/* Hidden photo file input */}
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          const studentId = photoTargetStudentId.current;
          if (file && studentId) {
            handlePhotoUpload(studentId, file);
          }
          e.target.value = "";
        }}
      />

      {/* Schedule NWEA Testing Dialog */}
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
              src="https://calendar.app.google/FsBaobZrsRToxuGq9"
              className="h-full w-full border-0"
              title="Schedule NWEA Testing"
            />
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!pendingDeleteStudent} onOpenChange={(open) => { if (!open) setPendingDeleteStudent(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove {pendingDeleteStudent?.name} from this year&apos;s application. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => pendingDeleteStudent && handleRemoveStudent(pendingDeleteStudent.appId)}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!pendingNavPath} onOpenChange={(open) => { if (!open) setPendingNavPath(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved Changes</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes. Would you like to save before leaving?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              variant="outline"
              onClick={() => {
                const path = pendingNavPath;
                setPendingNavPath(null);
                if (path) router.push(path);
              }}
            >
              Discard
            </Button>
            <AlertDialogAction
              onClick={async () => {
                await handleSaveAllApps();
                const path = pendingNavPath;
                setPendingNavPath(null);
                if (path) router.push(path);
              }}
            >
              Save &amp; Leave
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function NweaFileUpload({
  existingFile,
  uploading,
  onUpload,
  onRemove,
}: {
  existingFile: Record<string, unknown> | null;
  uploading: boolean;
  onUpload: (file: File) => void;
  onRemove: () => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const hasFile = existingFile && Object.keys(existingFile).length > 0;
  const [confirmRemove, setConfirmRemove] = useState(false);

  function handleFilesChange(newFiles: File[]) {
    setFiles(newFiles);
    if (newFiles.length === 0) {
      if (hasFile) setConfirmRemove(true);
      return;
    }
    onUpload(newFiles[0]);
  }

  if (hasFile && files.length === 0) {
    const name = (existingFile as Record<string, unknown>).name as string | undefined;
    return (
      <>
        <div className="flex items-center gap-3 rounded-md border border-input bg-background px-4 py-3">
          <CheckCircle2 className="size-5 text-green-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{name || "Uploaded file"}</p>
            <p className="text-xs text-muted-foreground">Uploaded successfully</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0"
            onClick={() => setConfirmRemove(true)}
          >
            <X className="size-4" />
          </Button>
        </div>
        <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove uploaded file?</AlertDialogTitle>
              <AlertDialogDescription>
                This will remove the uploaded test scores. You can upload a new file afterwards.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => { setConfirmRemove(false); onRemove(); }}>
                Remove
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    );
  }

  return (
    <FileUpload
      maxFiles={1}
      maxSize={10 * 1024 * 1024}
      accept=".pdf,.jpg,.jpeg,.png"
      className="w-full"
      value={files}
      onValueChange={handleFilesChange}
      disabled={uploading}
    >
      <FileUploadDropzone className="flex-row gap-3 px-4 py-3 cursor-pointer">
        {uploading ? (
          <Loader2 className="size-5 text-muted-foreground animate-spin" />
        ) : (
          <FileUp className="size-5 text-muted-foreground" />
        )}
        <div className="flex-1 text-left">
          <p className="text-sm font-medium">
            {uploading ? "Uploading..." : "Drop test scores here or click to upload"}
          </p>
          <p className="text-xs text-muted-foreground">PDF, JPG, or PNG (max 10MB)</p>
        </div>
      </FileUploadDropzone>
      <FileUploadList>
        {files.map((file, i) => (
          <FileUploadItem key={i} value={file}>
            <FileUploadItemPreview />
            <FileUploadItemMetadata />
            <FileUploadItemDelete asChild>
              <Button variant="ghost" size="icon" className="size-7">
                <X className="size-4" />
              </Button>
            </FileUploadItemDelete>
          </FileUploadItem>
        ))}
      </FileUploadList>
    </FileUpload>
  );
}


"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import { useParams, useRouter } from "next/navigation";
import Image from "next/image";
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
import { Trash2, FileUp, X, Loader2, CheckCircle2, Plus, ExternalLink, HelpCircle } from "lucide-react";
import { GlobalSaveStatusPill } from "@/components/save-status-pill";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSWRConfig } from "swr";
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
  photo: string | { url: string } | null;
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

function getPhotoUrl(photo: string | { url: string } | null): string | undefined {
  if (!photo) return undefined;
  if (typeof photo === "string") return photo;
  if (typeof photo === "object" && photo.url) return photo.url;
  return undefined;
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
    trackAutosave,
  } = useApplicationFlow();
  const { mutate } = useSWRConfig();

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
        // Keep all student cards open on initial load — don't auto-collapse
        // completed ones. Users can manually collapse via the chevron.
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
        // Ensure the new student's card starts expanded
        setCollapsedCards((prev) => {
          const next = new Set(prev);
          next.delete(studentId);
          return next;
        });
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

  function handleRemoveStudent(appId: number) {
    setApplications((prev) => prev.filter((a) => a.id !== appId));
    setSavedApplications((prev) => prev.filter((a) => a.id !== appId));
    setPendingDeleteStudent(null);
    fetch(`/api/applications/${appId}`, { method: "DELETE" })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.text();
          console.error("Delete failed:", res.status, res.statusText, body);
        }
      })
      .catch((err) => console.error("Failed to remove student:", err));
  }

  function isAppComplete(app: Application): boolean {
    // Student Details completion — only the school-history fields on this page.
    // SUFS lives on the Financial Aid step. Transportation + NWEA moved out.
    if (!app.current_previous_school) return false;
    if (!app.last_grade_completed) return false;
    if (!app.current_grade) return false;
    if (!app.describe_student_strengths) return false;
    if (!app.describe_student_opportunities_for_growth) return false;
    return true;
  }

  function StudentStatusIcon({ complete }: { complete: boolean }) {
    if (complete) {
      return (
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-green-500 text-white">
          <svg className="size-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
          </svg>
        </div>
      );
    }
    return (
      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-amber-500 text-white">
        <svg className="size-4" viewBox="0 0 20 20" fill="currentColor">
          <path d="M5.433 13.917l1.262-3.155A4 4 0 017.58 9.42l6.92-6.918a2.121 2.121 0 013 3l-6.92 6.918c-.383.383-.84.685-1.343.886l-3.154 1.262a.5.5 0 01-.65-.65z" />
          <path d="M3.5 5.75c0-.69.56-1.25 1.25-1.25H10A.75.75 0 0010 3H4.75A2.75 2.75 0 002 5.75v9.5A2.75 2.75 0 004.75 18h9.5A2.75 2.75 0 0017 15.25V10a.75.75 0 00-1.5 0v5.25c0 .69-.56 1.25-1.25 1.25h-9.5c-.69 0-1.25-.56-1.25-1.25v-9.5z" />
        </svg>
      </div>
    );
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
    "current_previous_school",
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

  // Auto-save a single application field on blur
  async function autoSaveAppField(appId: number, field: string, value: unknown) {
    try {
      await fetch(`/api/applications/${appId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
    } catch (err) {
      console.error(`Auto-save failed for ${field}:`, err);
    }
  }

  const [savingAll, setSavingAll] = useState(false);

  async function handleSaveAllApps() {
    setSavingAll(true);
    try {
      const results = await trackAutosave(
        Promise.all(
          applications.map(async (app) => {
            const res = await fetch(`/api/applications/${app.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                // SUFS + transportation moved off this page — don't overwrite them here.
                current_previous_school: app.current_previous_school,
                last_grade_completed: app.last_grade_completed,
                current_grade: app.current_grade,
                describe_student_strengths: app.describe_student_strengths,
                describe_student_opportunities_for_growth:
                  app.describe_student_opportunities_for_growth,
              }),
            });
            if (!res.ok) {
              const body = await res.json().catch(() => null);
              console.error(`Failed to save application ${app.id}:`, res.status, body);
              throw new Error(`Save failed (${res.status})`);
            }
            return res;
          })
        )
      );
      if (results.some((r) => !r.ok)) {
        throw new Error("Some applications failed to save");
      }
      setSavedApplications(applications.map((a) => ({ ...a })));
      mutate("/api/applications");
    } catch (err) {
      console.error("Failed to save:", err);
      toast.error("Failed to save — please try again");
      throw err;
    } finally {
      setSavingAll(false);
    }
  }

  const handleSaveAllAppsRef = useRef(handleSaveAllApps);
  handleSaveAllAppsRef.current = handleSaveAllApps;

  const [studentsLocked, setStudentsLocked] = useState(false);

  const handleCompleteStudentsRef = useRef<() => Promise<void>>(() => Promise.resolve());
  handleCompleteStudentsRef.current = async () => {
    if (applications.length === 0) {
      toast.error("Please add at least one student before completing this section.");
      throw new Error("Validation failed");
    }
    // Validate using the same function as the status icon
    const incomplete = applications.filter((app) => !isAppComplete(app));
    if (incomplete.length > 0) {
      const student = students.find((s) => s.id === incomplete[0].registration_students_id);
      const name = student ? `${student.first_name} ${student.last_name}` : "Student";
      toast.error(`${name}: Please fill out all required fields.`);
      // Open the incomplete card
      if (student) {
        setCollapsedCards((prev) => {
          const next = new Set(prev);
          next.delete(student.id);
          return next;
        });
      }
      throw new Error("Validation failed");
    }
    // Save
    await handleSaveAllAppsRef.current();
    setStudentsLocked(true);
    toast.success("Students section completed.");
  };

  useEffect(() => {
    setPageTitle("Student Details");
    registerSaveHandler(() => handleCompleteStudentsRef.current(), { label: "Complete Students Section" });
    return () => {
      unregisterSaveHandler();
      unregisterBackGuard();
    };
  }, [setPageTitle, registerSaveHandler, unregisterSaveHandler, unregisterBackGuard]);

  useEffect(() => {
    if (studentsLocked) {
      updateSaveOptions({
        completed: true,
        completedLabel: "Students Section Completed",
        onUnlock: () => setStudentsLocked(false),
      });
    } else {
      updateSaveOptions({ label: "Complete Students Section" });
    }
  }, [studentsLocked, updateSaveOptions]);

  // Auto-save on changes (debounced)
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!isDirty || savingAll) return;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      handleSaveAllAppsRef.current();
    }, 2000);
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, [isDirty, savingAll]); // eslint-disable-line react-hooks/exhaustive-deps

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
        <div>
          <div className="flex items-center justify-between gap-3 pb-3 border-b">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Students
            </p>
            <GlobalSaveStatusPill />
          </div>
          <h1 className="text-2xl font-semibold mt-4">
            Add each student applying and complete their academic and
            background information to continue.
          </h1>
        </div>

        {enrolled.length === 0 ? (
          <div className="flex min-h-[20vh] flex-col items-center justify-center gap-4 rounded-lg border px-4 py-8">
            <p className="text-muted-foreground text-sm">
              No students enrolled yet. Add a student to get started.
            </p>
            <Button onClick={() => setAddDialogOpen(true)}>
              <Plus className="size-4 mr-1.5" />
              Add Student
            </Button>
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
                          {getPhotoUrl(student.photo) ? (
                            <AvatarImage
                              src={getPhotoUrl(student.photo)}
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
                      <StudentStatusIcon complete={isAppComplete(app)} />
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
                <CardContent className="space-y-6 py-5 bg-white dark:bg-background">
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
                </CardContent>
                )}
              </Card>
            ))}
            <Button
              variant="outline"
              className="w-full"
              onClick={() => setAddDialogOpen(true)}
            >
              <Plus className="size-4 mr-1.5" />
              Add Another Student
            </Button>
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


      {/* Step Up for Students Dialog removed — SUFS moved to Financial Aid page */}

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
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={() => pendingDeleteStudent && handleRemoveStudent(pendingDeleteStudent.appId)}
            >
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



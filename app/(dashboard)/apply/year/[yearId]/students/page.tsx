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
import { Trash2, FileUp, X, Loader2, CheckCircle2, Plus, ExternalLink, HelpCircle, Pencil } from "lucide-react";
import { GlobalSaveStatusPill } from "@/components/save-status-pill";
import { useFamilyProgress } from "@/hooks/use-family-progress";
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
  /** Snapshot of the formatted parent address the family used to pick
   *  the bus stop. Empty string when transportation is off or no
   *  guardian address was selected. Persisted alongside `bus_stop`
   *  so the routing team has the literal pickup address. */
  primary_home: string;
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

// Fields the Students step persists onto the application row.
// Drives both the dirty-diff comparison and the autosave PATCH body
// — only these keys ever ride along with a save from this page.
// Transportation lives alongside school-history because the apply-flow
// folded the standalone transportation step back into this one.
const TRACKED_FIELDS: (keyof Application)[] = [
  "current_previous_school",
  "last_grade_completed",
  "current_grade",
  "describe_student_strengths",
  "describe_student_opportunities_for_growth",
  "is_bus_transportation",
  "bus_stop",
  "primary_home",
];

// Diff a single app against its saved snapshot. Returns the subset
// of tracked fields that actually changed — the autosave PATCH body
// is exactly this object, so we never send unchanged fields. Edits
// to one student therefore never trigger writes against another
// student's row, and unchanged fields never appear in a PATCH body
// (which avoids re-firing any Xano-side hooks on the application row
// for no-op writes).
function getDirtyFields(
  app: Application,
  saved: Application | undefined
): Partial<Application> {
  if (!saved) return {};
  const dirty: Record<string, unknown> = {};
  for (const f of TRACKED_FIELDS) {
    if (app[f] !== saved[f]) dirty[f] = app[f];
  }
  return dirty as Partial<Application>;
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
  // UI-only — keyed by application id, holds which parent's address
  // the family used to pick a stop. Not persisted (the actual stop
  // is what gets saved on the application row); just a hint that
  // grounds the dropdown for parents with two guardian addresses.
  const [busAddressByApp, setBusAddressByApp] = useState<
    Record<number, number>
  >({});
  const [yearName, setYearName] = useState("");
  const [loading, setLoading] = useState(true);
  const [addingStudentId, setAddingStudentId] = useState<number | null>(null);
  const [savedApplications, setSavedApplications] = useState<Application[]>([]);
  const [pendingNavPath, setPendingNavPath] = useState<string | null>(null);
  // Skeleton placeholder for a brand-new student that's mid-auto-add.
  // Set the moment the create sheet succeeds; cleared as soon as the
  // student appears in the `enrolled` list (i.e. the application POST
  // finished and the optimistic push landed). Renders a card with the
  // student's name + skeleton inputs in the spot where the real card
  // will materialize, so the page doesn't feel blank during the round
  // trip to the applications endpoint.
  const [pendingNewStudent, setPendingNewStudent] = useState<{
    id: number;
    first_name: string;
    last_name: string;
  } | null>(null);

  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addError, setAddError] = useState("");

  const [createSheetOpen, setCreateSheetOpen] = useState(false);
  // When set, the Create Student Sheet is in edit mode and PATCHes this id
  // instead of POSTing a new record.
  const [editingStudentId, setEditingStudentId] = useState<number | null>(null);
  const [newFirst, setNewFirst] = useState("");
  const [newLast, setNewLast] = useState("");
  const [newDob, setNewDob] = useState("");
  const [newGender, setNewGender] = useState("");
  const [newEthnicity, setNewEthnicity] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  function resetStudentForm() {
    setNewFirst("");
    setNewLast("");
    setNewDob("");
    setNewGender("");
    setNewEthnicity("");
    setCreateError("");
    setEditingStudentId(null);
  }

  function openEditStudentSheet(student: Student) {
    setEditingStudentId(student.id);
    setNewFirst(student.first_name ?? "");
    setNewLast(student.last_name ?? "");
    // Xano stores dates as "YYYY-MM-DD" strings already; guard against the
    // occasional legacy full-ISO value by taking the first 10 chars.
    setNewDob(student.date_of_birth ? String(student.date_of_birth).slice(0, 10) : "");
    setNewGender(student.gender ?? "");
    setNewEthnicity(student.ethnicity ?? "");
    setCreateError("");
    setAddDialogOpen(false);
    setCreateSheetOpen(true);
  }

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
        // `/api/families` returns `null` (not an empty object) when the
        // family record can't be loaded — JSON.parse keeps that as
        // `null` rather than throwing, so a naive `fam.parents` blows
        // up with "Cannot read properties of null". Optional-chain the
        // read so the page just falls through to an empty parents
        // list when the endpoint hands us null.
        const fam = await familyRes.json();
        setParents(fam?.parents ?? []);
      }
      if (yearsRes.ok) {
        const years = await yearsRes.json();
        const found = years.find((y: { id: number }) => y.id === yearId);
        if (found) setYearName(found.year_name);
      }
      let loadedStudents: Student[] = [];
      if (studentsRes.ok) {
        loadedStudents = await studentsRes.json();
        // Sort students by id ASC (creation order). Xano doesn't
        // guarantee a deterministic order on filtered GETs, so the
        // newly-added student would otherwise float to the top and
        // disrupt the parent's mental model ("the kid I just added
        // is at the bottom"). Sorting client-side keeps the page
        // stable regardless of Xano's response order.
        loadedStudents = loadedStudents
          .slice()
          .sort((a, b) => a.id - b.id);
        setStudents(loadedStudents);
      }
      if (appsRes.ok) {
        const allApps: Application[] = await appsRes.json();
        const yearApps = allApps
          .filter((a) => a.registration_school_years_id === yearId)
          // Normalize string fields the local interface treats as
          // required-strings — Xano returns null for blank text columns
          // on rows that predate the addition of `primary_home`, and
          // null leaks through `app.primary_home` reads as a falsy
          // string that triggers React's controlled-input warning.
          .map((a) => ({
            ...a,
            primary_home: a.primary_home ?? "",
            bus_stop: a.bus_stop ?? "",
          }))
          // Match the students sort: id ASC = creation order, so a
          // freshly-added student lands at the bottom of the list,
          // not the top.
          .sort((a, b) => a.id - b.id);
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

  // Hydrate the parent-address radio state from each application's
  // saved `primary_home` string so a returning user doesn't have to
  // re-pick the address before the bus-stop dropdown unlocks. Match
  // by formatted-address string equality — same shape we write on
  // selection, so equality round-trips cleanly. Runs after both
  // applications + parents land so we know which radios to check.
  useEffect(() => {
    if (parents.length === 0 || applications.length === 0) return;
    setBusAddressByApp((prev) => {
      const next = { ...prev };
      for (const app of applications) {
        if (next[app.id]) continue;
        if (!app.primary_home) continue;
        const match = parents.find((p) => {
          const line2 = p.address_line_2 ? `, ${p.address_line_2}` : "";
          const full = `${p.address_line_1}${line2}, ${p.city} ${p.state} ${p.zipcode}`;
          return full === app.primary_home;
        });
        if (match) next[app.id] = match.id;
      }
      return next;
    });
  }, [parents, applications]);

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

        // Adding a student invalidates any previously-completed section
        // whose validation depends on per-student data. Flip those bools
        // proactively, here in the same async path as the add — putting
        // this in a useEffect on `applications` was racing the layout's
        // pointer-events-none wrapper, which blocked the parent from
        // editing the brand-new student's empty fields. Doing it inline
        // means the unlock is part of the same network round trip the
        // user just initiated. Family is intentionally NOT touched —
        // adding a student doesn't change the parents.
        const ap = flowRef.current.applyProgress.progress;
        if (ap) {
          const patch: Record<string, boolean> = {};
          if (ap.students_completed) patch.students_completed = false;
          if (ap.financial_aid_completed) patch.financial_aid_completed = false;
          if (ap.testing_completed) patch.testing_completed = false;
          if (Object.keys(patch).length > 0) {
            try {
              await fetch(`/api/family-progress?yearId=${yearId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(patch),
              });
              // Force the SWR cache to re-fetch so the layout's bottom-bar
              // immediately reflects the new "in progress" state.
              mutate(`/api/family-progress?yearId=${yearId}`);
              const labels = Object.keys(patch)
                .map((k) =>
                  k === "students_completed"
                    ? "Students"
                    : k === "financial_aid_completed"
                      ? "Financial Aid"
                      : k === "testing_completed"
                        ? "Initial Testing"
                        : k
                )
                .join(", ");
              toast.message(
                `${labels} reopened — please review the new student's details.`
              );
            } catch (err) {
              console.error("Failed to reopen sections after add:", err);
            }
          }
        }
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
    // Student Details completion — school-history fields + transportation
    // (transportation now lives on this step). NWEA still lives on its
    // own step; SUFS lives on Financial Aid. Trim before checking so
    // whitespace-only values don't pass as complete.
    const nonEmpty = (v: string | null | undefined) => !!v && v.trim().length > 0;
    if (!nonEmpty(app.current_previous_school)) return false;
    if (!nonEmpty(app.last_grade_completed)) return false;
    if (!nonEmpty(app.current_grade)) return false;
    if (!nonEmpty(app.describe_student_strengths)) return false;
    if (!nonEmpty(app.describe_student_opportunities_for_growth)) return false;
    // Transportation: if the family opted in, they must pick a stop.
    // Off = trivially complete (it's an explicit "no thanks").
    if (app.is_bus_transportation && !nonEmpty(app.bus_stop)) return false;
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

  const isDirty = applications.some((app) => {
    const saved = savedApplications.find((s) => s.id === app.id);
    return Object.keys(getDirtyFields(app, saved)).length > 0;
  });

  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  const [savingAll, setSavingAll] = useState(false);

  // PATCH a single application, sending only the fields that
  // actually changed. Used by both the per-app debounced autosave
  // and the explicit Complete-Section save-all — keeping the network
  // primitive in one place ensures both flows scope writes to the
  // dirty diff.
  const saveSingleApp = useCallback(
    async (appId: number): Promise<boolean> => {
      const app = applications.find((a) => a.id === appId);
      if (!app) return true;
      const saved = savedApplications.find((s) => s.id === appId);
      const dirty = getDirtyFields(app, saved);
      if (Object.keys(dirty).length === 0) return true;
      try {
        const res = await fetch(`/api/applications/${appId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(dirty),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          console.error(`Failed to save application ${appId}:`, res.status, body);
          return false;
        }
        setSavedApplications((prev) =>
          prev.map((s) => (s.id === appId ? { ...app } : s))
        );
        return true;
      } catch (err) {
        console.error(`Failed to save application ${appId}:`, err);
        return false;
      }
    },
    [applications, savedApplications]
  );
  const saveSingleAppRef = useRef(saveSingleApp);
  saveSingleAppRef.current = saveSingleApp;

  async function handleSaveAllApps() {
    setSavingAll(true);
    try {
      const results = await trackAutosave(
        Promise.all(
          applications.map((a) => saveSingleAppRef.current(a.id))
        )
      );
      if (results.some((ok) => !ok)) {
        throw new Error("Some applications failed to save");
      }
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

  // Single progress source: apply + reapply share the same
  // `registration_family_application_progress` row, distinguished by
  // its `type` field. The reapply-side branching (a parallel
  // `useReapplyFamilyProgress` hook + `isStudentDetails` bool) is
  // gone — re-enrollment families write to `students_completed`
  // like everyone else.
  const applyProgress = useFamilyProgress(yearId);
  const studentsLocked = !!applyProgress.progress?.students_completed;
  // Stabilize the setter via a ref — the progress hook returns a
  // fresh object literal each render, so listing it in useCallback
  // deps would cause the consumer useEffect to re-fire indefinitely.
  const flowRef = useRef({ applyProgress });
  flowRef.current = { applyProgress };
  const setStudentsLocked = useCallback((value: boolean) => {
    return flowRef.current.applyProgress.setSection("students_completed", value);
  }, []);

  const handleCompleteStudentsRef = useRef<() => Promise<void>>(() => Promise.resolve());
  handleCompleteStudentsRef.current = async () => {
    const visible = applications
      .map((app) => ({ app, student: students.find((s) => s.id === app.registration_students_id) }))
      .filter((x): x is { app: Application; student: Student } => !!x.student);

    if (visible.length === 0) {
      toast.error("Please add at least one student before completing this section.");
      throw new Error("Validation failed");
    }

    const incomplete = visible.filter(({ app }) => !isAppComplete(app));
    if (incomplete.length > 0) {
      const { student } = incomplete[0];
      toast.error(`${student.first_name} ${student.last_name}: Please fill out all required fields.`);
      throw new Error("Validation failed");
    }
    await handleSaveAllAppsRef.current();
    await setStudentsLocked(true);
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
        onUnlock: () => void setStudentsLocked(false),
      });
    } else {
      // Explicitly clear `completed` + `onUnlock` so the layout's
      // dim + click-block wrapper releases on unlock. Otherwise the
      // shallow merge in `updateSaveOptions` carries the stale
      // `completed: true` forward and the page stays locked-looking.
      updateSaveOptions({
        completed: false,
        onUnlock: undefined,
        label: "Complete Students Section",
      });
    }
  }, [studentsLocked, updateSaveOptions, setStudentsLocked]);

  // Auto-revoke for the Students section is now handled inline inside
  // `handleAddToYear` (the single point where a new student joins the
  // application). Doing it via a useEffect on `applications` race'd the
  // layout's pointer-events-none wrapper — there was a render where
  // the section was still "completed" / interactions blocked while the
  // parent was trying to edit the brand-new student's empty fields.
  // The inline approach unlocks the section atomically with the add.

  // Per-app debounced autosave. Each app gets its own 2s timer
  // keyed on `app.id`, so typing in one student's card only schedules
  // (and eventually PATCHes) that student's row — edits to one app
  // never trigger writes against any other app. The save itself
  // (`saveSingleApp`) only sends the diff against `savedApplications`,
  // so a PATCH body never carries unchanged fields.
  const autoSaveTimersRef = useRef<
    Map<number, ReturnType<typeof setTimeout>>
  >(new Map());
  useEffect(() => {
    if (savingAll) return;
    const timers = autoSaveTimersRef.current;
    for (const app of applications) {
      const saved = savedApplications.find((s) => s.id === app.id);
      const dirty = getDirtyFields(app, saved);
      if (Object.keys(dirty).length === 0) continue;
      const existing = timers.get(app.id);
      if (existing) clearTimeout(existing);
      const appId = app.id;
      const timer = setTimeout(() => {
        void saveSingleAppRef.current(appId);
        timers.delete(appId);
      }, 2000);
      timers.set(appId, timer);
    }
  }, [applications, savedApplications, savingAll]);

  // Cancel any in-flight per-app timers on unmount so a setTimeout
  // doesn't fire against a stale `applications` snapshot.
  useEffect(() => {
    const timers = autoSaveTimersRef.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);

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
      const isEdit = editingStudentId !== null;
      const url = isEdit ? `/api/students/${editingStudentId}` : "/api/students";
      const res = await fetch(url, {
        method: isEdit ? "PATCH" : "POST",
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
        const created = await res.json().catch(() => null);
        setCreateSheetOpen(false);
        resetStudentForm();
        // For brand-new students, immediately add them to this year's
        // application so the parent doesn't have to click through the
        // modal again to do it. Edits don't trigger this — the student
        // already had whatever application status they had.
        if (!isEdit && created && typeof created.id === "number") {
          // Stage a skeleton placeholder for the new student so the
          // page shows "something is happening" between sheet close
          // and the application POST landing. The placeholder is
          // cleared by the effect below as soon as the real card
          // shows up in the enrolled list.
          setPendingNewStudent({
            id: created.id,
            first_name:
              typeof created.first_name === "string" ? created.first_name : "",
            last_name:
              typeof created.last_name === "string" ? created.last_name : "",
          });
          await handleAddToYear(created.id);
          // Refresh the rest of the page state (students list +
          // applications) after the auto-add. handleAddToYear pushes
          // optimistically into the applications list already, but
          // fetchData makes sure the new student row also appears.
          await fetchData();
          toast.success("Student added to this year's application.");
        } else {
          await fetchData();
          toast.success(isEdit ? "Student updated" : "Student added");
        }
      } else {
        const body = await res.json().catch(() => null);
        setCreateError(body?.error ?? (editingStudentId ? "Failed to update student" : "Failed to add student"));
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

  // Clear the skeleton placeholder once the real student card has
  // landed in the enrolled list (i.e. the application POST + fetchData
  // round trip finished). Without this the skeleton would persist
  // indefinitely after the real card appeared.
  useEffect(() => {
    if (!pendingNewStudent) return;
    const present = enrolled.some(
      (e) => e.student.id === pendingNewStudent.id
    );
    if (present) setPendingNewStudent(null);
  }, [pendingNewStudent, enrolled]);

  // Don't render two cards for the same student — if the real card is
  // already in the enrolled list, suppress the skeleton even though
  // the effect above hasn't yet flushed `pendingNewStudent` to null.
  const showPendingSkeleton =
    !!pendingNewStudent &&
    !enrolled.some((e) => e.student.id === pendingNewStudent.id);

  if (loading) {
    return (
      <div className="flex flex-1 flex-col gap-6 p-6 mx-auto w-full max-w-4xl">
        <div>
          <div className="flex items-center justify-between gap-3 pb-3 border-b">
            <Skeleton className="h-3 w-20" />
          </div>
          <Skeleton className="h-8 w-3/4 mt-4" />
          <Skeleton className="h-4 w-2/3 mt-3" />
        </div>
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="rounded-lg border p-6">
            <div className="flex items-center gap-3 mb-5">
              <Skeleton className="size-10 rounded-full" />
              <Skeleton className="h-5 w-44" />
            </div>
            <div className="space-y-4">
              {Array.from({ length: 5 }).map((_, j) => (
                <div key={j}>
                  <Skeleton className="h-3 w-24 mb-2" />
                  <Skeleton className="h-9 w-full rounded-md" />
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
                <CardHeader className="py-3 !pb-3 border-b">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        className="relative group rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        disabled={uploadingPhotoId === student.id}
                        onClick={() => {
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
                        onClick={() =>
                          setPendingDeleteStudent({ appId: app.id, name: `${student.first_name} ${student.last_name}` })
                        }
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
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
                          className={!app.current_previous_school ? "border-2 border-red-400" : ""}
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
                          Current Grade
                        </FieldLabel>
                        <Input
                          className={!app.last_grade_completed ? "border-2 border-red-400" : ""}
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
                          Incoming Grade
                        </FieldLabel>
                        <Input
                          className={!app.current_grade ? "border-2 border-red-400" : ""}
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
                          className={`flex min-h-[80px] w-full rounded-md border bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${!app.describe_student_strengths ? "border-2 border-red-400" : "border-input"}`}
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
                          className={`flex min-h-[80px] w-full rounded-md border bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${!app.describe_student_opportunities_for_growth ? "border-2 border-red-400" : "border-input"}`}
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

                  {/* ─── Transportation ───
                      Per-student bus preferences live inside the
                      student card now (was a standalone apply step).
                      Three quick steps when the parent toggles bus
                      transport on:
                        1. The Switch above commits to bus.
                        2. Pick which guardian's address the family
                           wants the stop near (UI hint only — not
                           persisted; keeps the picker grounded for
                           parents with two addresses).
                        3. Pick a stop from the school's published
                           list. Each option shows the stop's name
                           and street address so the parent knows
                           exactly where pickup happens. */}
                  <section className="border-t pt-5">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-sm font-medium">Transportation</h3>
                      <Switch
                        checked={app.is_bus_transportation}
                        onCheckedChange={(v) =>
                          setApplications((prev) =>
                            prev.map((a) =>
                              a.id === app.id
                                ? {
                                    ...a,
                                    is_bus_transportation: v,
                                    // Clear stop + captured address on
                                    // disable so saves don't drag stale
                                    // picks back to the server when a
                                    // family changes their mind.
                                    bus_stop: v ? a.bus_stop : "",
                                    primary_home: v ? a.primary_home : "",
                                  }
                                : a
                            )
                          )
                        }
                        aria-label={`Bus transportation for ${student.first_name}`}
                      />
                    </div>
                    {app.is_bus_transportation ? (
                      <div className="grid gap-4 mt-4">
                        {/* Step 2 — guardian address picker (UI hint).
                            Renders one tile per parent with their
                            address shown so the parent has the
                            context they need to choose a stop. */}
                        {parents.length > 0 ? (
                          <Field>
                            <FieldLabel className="text-xs">
                              Choose your student&rsquo;s primary address
                            </FieldLabel>
                            <div className="grid gap-2 sm:grid-cols-2">
                              {parents.map((p) => {
                                const checked =
                                  busAddressByApp[app.id] === p.id;
                                const line2 = p.address_line_2
                                  ? `, ${p.address_line_2}`
                                  : "";
                                const fullAddress = `${p.address_line_1}${line2}, ${p.city} ${p.state} ${p.zipcode}`;
                                return (
                                  <label
                                    key={p.id}
                                    className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm transition-colors ${
                                      checked
                                        ? "border-primary bg-primary/5"
                                        : "hover:bg-muted/30"
                                    }`}
                                  >
                                    <input
                                      type="radio"
                                      name={`bus-address-${app.id}`}
                                      checked={checked}
                                      onChange={() => {
                                        setBusAddressByApp((prev) => ({
                                          ...prev,
                                          [app.id]: p.id,
                                        }));
                                        // Capture the formatted address
                                        // string onto the application —
                                        // this is what the routing team
                                        // reads as "where to pick up
                                        // from." Persist it alongside
                                        // the bus stop choice so a
                                        // single-source-of-truth save
                                        // covers both fields.
                                        setApplications((prev) =>
                                          prev.map((a) =>
                                            a.id === app.id
                                              ? { ...a, primary_home: fullAddress }
                                              : a
                                          )
                                        );
                                      }}
                                      className="mt-1 size-4 cursor-pointer accent-primary"
                                    />
                                    <div className="min-w-0">
                                      <p className="font-medium truncate">
                                        {p.first_name} {p.last_name}
                                      </p>
                                      <p className="text-xs text-muted-foreground mt-0.5">
                                        {p.address_line_1 ? (
                                          fullAddress
                                        ) : (
                                          <span className="italic">
                                            No address on file
                                          </span>
                                        )}
                                      </p>
                                    </div>
                                  </label>
                                );
                              })}
                            </div>
                          </Field>
                        ) : null}

                        {/* Step 3 — pick a stop. Each item carries the
                            stop name + address so the parent can
                            cross-reference distance from their
                            chosen guardian address above. */}
                        <Field>
                          <FieldLabel className="text-xs">
                            Bus Stop{" "}
                            <span className="text-red-400">*</span>
                          </FieldLabel>
                          <select
                            className={`flex h-9 w-full items-center justify-between rounded-md border bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                              !app.bus_stop
                                ? "border-red-400"
                                : "border-input"
                            }`}
                            value={app.bus_stop || ""}
                            onChange={(e) =>
                              setApplications((prev) =>
                                prev.map((a) =>
                                  a.id === app.id
                                    ? { ...a, bus_stop: e.target.value }
                                    : a
                                )
                              )
                            }
                          >
                            <option value="">
                              {parents.length > 0 &&
                              !busAddressByApp[app.id]
                                ? "Pick an address above first…"
                                : "Select a bus stop"}
                            </option>
                            {busStops.map((s) => (
                              <option key={s.id} value={s.name}>
                                {s.name}
                                {s.address ? ` — ${s.address}` : ""}
                              </option>
                            ))}
                          </select>
                          {/* Bus TIMES deliberately not shown to
                              parents (user request) — schedules can
                              shift, so the application only records
                              the stop; times are communicated by
                              staff closer to the school year. */}
                        </Field>
                      </div>
                    ) : null}
                  </section>
                </CardContent>
              </Card>
            ))}
            {/* Pending skeleton card — appears in the same slot the new
                student is about to occupy, so the page reads as "we're
                adding them now" instead of jumping straight to the new
                card. Matches the real card's outer shape (avatar + name
                header, four input rows below) so when it swaps out for
                the real card the layout doesn't shift. */}
            {showPendingSkeleton && pendingNewStudent ? (
              <Card className="overflow-hidden gap-0 py-0">
                <CardHeader className="py-3 !pb-3 border-b">
                  <div className="flex items-center gap-3">
                    <Avatar className="size-10">
                      <AvatarFallback className="bg-muted text-muted-foreground text-sm font-medium">
                        {(pendingNewStudent.first_name.charAt(0) ?? "").toUpperCase()}
                        {(pendingNewStudent.last_name.charAt(0) ?? "").toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <CardTitle className="text-lg flex items-center gap-2">
                      {pendingNewStudent.first_name} {pendingNewStudent.last_name}
                      <span className="text-xs font-normal text-muted-foreground inline-flex items-center gap-1.5">
                        <Loader2 className="size-3 animate-spin" />
                        Adding to application…
                      </span>
                    </CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4 py-5 bg-white dark:bg-background">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i}>
                      <Skeleton className="h-3 w-24 mb-2" />
                      <Skeleton className="h-9 w-full rounded-md" />
                    </div>
                  ))}
                </CardContent>
              </Card>
            ) : null}
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

          {students.length > 0 ? (
            <div className="divide-y rounded-lg border">
              {students.map((student) => {
                // Show every family student in the modal — already-added
                // ones get a disabled "Added to application" pill so the
                // parent can see at a glance who's in vs out, instead of
                // hiding them and showing a "nothing left to add" message.
                const isAdded = applications.some(
                  (a) => a.registration_students_id === student.id
                );
                return (
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
                    <div className="flex items-center gap-2">
                      {isAdded ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled
                          className="bg-muted text-muted-foreground"
                        >
                          Added to application
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          disabled={addingStudentId === student.id}
                          onClick={() => handleAddToYear(student.id)}
                        >
                          {addingStudentId === student.id ? "Adding..." : "Add"}
                        </Button>
                      )}
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-8 text-muted-foreground hover:text-foreground"
                        onClick={() => openEditStudentSheet(student)}
                        aria-label={`Edit ${student.first_name} ${student.last_name}`}
                      >
                        <Pencil className="size-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-lg border px-4 py-6 text-center">
              <p className="text-sm text-muted-foreground">
                No students on your family yet — use &ldquo;Create New
                Student&rdquo; below to add one.
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
      <Sheet
        open={createSheetOpen}
        onOpenChange={(open) => {
          setCreateSheetOpen(open);
          if (!open) resetStudentForm();
        }}
      >
        <SheetContent>
          <SheetHeader>
            <SheetTitle>
              {editingStudentId ? "Edit Student" : "Create New Student"}
            </SheetTitle>
            <SheetDescription>
              {editingStudentId
                ? "Update this student's information."
                : "Add a new student to your family."}
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
              {creating
                ? editingStudentId
                  ? "Saving..."
                  : "Adding..."
                : editingStudentId
                  ? "Save Changes"
                  : "Add Student"}
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



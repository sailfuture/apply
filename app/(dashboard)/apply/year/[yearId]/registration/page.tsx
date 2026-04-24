"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import { useApplicationFlow } from "@/contexts/application-flow-context";
import { useApplications, useStudents, mutateApplications } from "@/hooks/use-api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StateSelect } from "@/components/state-select";
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
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Textarea } from "@/components/ui/textarea";
import {
  Trash2,
  Plus,
  ChevronDown,
  ChevronUp,
  FileUp,
  X,
  Loader2,
  CheckCircle2,
  Clock,
  ExternalLink,
} from "lucide-react";
import { GlobalSaveStatusPill } from "@/components/save-status-pill";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import { US_STATES } from "@/lib/us-states";
import {
  FileUpload,
  FileUploadDropzone,
  FileUploadItem,
  FileUploadItemDelete,
  FileUploadItemMetadata,
  FileUploadItemPreview,
  FileUploadList,
} from "@/components/ui/file-upload";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Parent {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  relationship: string;
  address_line_1: string;
  address_line_2: string;
  city: string;
  state: string;
  zipcode: string;
}

interface EmergencyContact {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  relationship: string;
  address_line_1: string;
  address_line_2: string;
  city: string;
  state: string;
  zipcode: string;
  _isNew?: boolean;
}

interface Student {
  id: number;
  first_name: string;
  last_name: string;
}

interface Application {
  id: number;
  registration_students_id: number;
  registration_school_years_id: number;
}

interface FileMetadata {
  path?: string;
  name?: string;
  type?: string;
  size?: number;
  mime?: string;
  url?: string;
  [key: string]: unknown;
}

interface StudentRegistration {
  id?: number;
  registration_students_id: number;
  shirt_size: string;
  pant_size: string;
  swim_level: string;
  birth_certificate: FileMetadata;
  school_health_form: FileMetadata;
  transcripts: FileMetadata;
  iep: FileMetadata;
  ssn_card: FileMetadata;
  immunization_forms: FileMetadata;
  passport: FileMetadata;
  student_state_id: FileMetadata;
  allergies: string;
  iep_description: string;
  dietary_restrictions: string;
  prescription_medications: string;
  health_conditions: string;
  vision_impairments: string;
  hearing_impairments: string;
  is_student_on_medicaid: boolean;
  medicaid_number: string;
  medicaid_provider: string;
  carry_epi_pen: boolean;
  epipen_explainer: string;
  permission_for_acetaminophen: string;
  additional_health_information: string;
  interested_in_counseling_services: string;
  other_adults_approved_for_pickup: string;
  prohibited_adults: string;
  liability_waiver_pandadoc_id: string;
  liability_waiver_status: string;
  liability_wavier_sent_at: string | null;
  liability_waiver_pdf_url: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SIZES = ["XS", "S", "M", "L", "XL", "XXL"];
const SWIM_LEVELS = ["None", "Beginner", "Intermediate", "Advanced"];
const YES_NO = ["Yes", "No"];
const YES_NO_MAYBE = ["Yes", "No", "Maybe"];

const REQUIRED_DOCUMENTS: { key: keyof StudentRegistration; label: string }[] = [
  { key: "birth_certificate", label: "Birth Certificate" },
  { key: "school_health_form", label: "School Health Form" },
  { key: "transcripts", label: "Transcripts" },
  { key: "immunization_forms", label: "Immunization Forms" },
];

const OPTIONAL_DOCUMENTS: { key: keyof StudentRegistration; label: string }[] = [
  { key: "iep", label: "IEP" },
  { key: "ssn_card", label: "SSN Card" },
  { key: "passport", label: "Passport" },
  { key: "student_state_id", label: "Student State ID" },
];

function getInitials(first: string, last: string): string {
  return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
}

function hasFile(meta: FileMetadata | null | undefined): boolean {
  return !!meta && Object.keys(meta).length > 0 && !!meta.path;
}

function isRegistrationComplete(reg: StudentRegistration): boolean {
  // Uniform
  if (!reg.shirt_size || !reg.pant_size || !reg.swim_level) return false;
  // Required documents
  if (!hasFile(reg.birth_certificate as FileMetadata)) return false;
  if (!hasFile(reg.school_health_form as FileMetadata)) return false;
  if (!hasFile(reg.transcripts as FileMetadata)) return false;
  if (!hasFile(reg.immunization_forms as FileMetadata)) return false;
  // Health & medical
  if (!reg.allergies) return false;
  if (!reg.dietary_restrictions) return false;
  if (!reg.prescription_medications) return false;
  if (!reg.health_conditions) return false;
  if (!reg.vision_impairments) return false;
  if (!reg.hearing_impairments) return false;
  if (!reg.permission_for_acetaminophen) return false;
  if (!reg.interested_in_counseling_services) return false;
  // EpiPen explainer required if carry_epi_pen is true
  if (reg.carry_epi_pen && !reg.epipen_explainer) return false;
  // Pickup & safety
  if (!reg.other_adults_approved_for_pickup) return false;
  if (!reg.prohibited_adults) return false;
  // Liability waiver
  if (reg.liability_waiver_status !== "completed") return false;
  return true;
}

function isParentComplete(p: Parent): boolean {
  return !!(p.first_name && p.last_name && p.email && p.phone && p.relationship && p.address_line_1 && p.city && p.state && p.zipcode);
}

function isEmergencyContactComplete(c: EmergencyContact): boolean {
  return !!(c.first_name && c.last_name && c.email && c.phone && c.relationship && c.address_line_1 && c.city && c.state && c.zipcode);
}

function StatusIcon({ complete }: { complete: boolean }) {
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

function emptyRegistration(studentId: number): StudentRegistration {
  return {
    registration_students_id: studentId,
    shirt_size: "",
    pant_size: "",
    swim_level: "",
    birth_certificate: {},
    school_health_form: {},
    transcripts: {},
    iep: {},
    ssn_card: {},
    immunization_forms: {},
    passport: {},
    student_state_id: {},
    allergies: "",
    iep_description: "",
    dietary_restrictions: "",
    prescription_medications: "",
    health_conditions: "",
    vision_impairments: "",
    hearing_impairments: "",
    is_student_on_medicaid: false,
    medicaid_number: "",
    medicaid_provider: "",
    carry_epi_pen: false,
    epipen_explainer: "",
    permission_for_acetaminophen: "",
    additional_health_information: "",
    interested_in_counseling_services: "",
    other_adults_approved_for_pickup: "",
    prohibited_adults: "",
    liability_waiver_pandadoc_id: "",
    liability_waiver_status: "",
    liability_wavier_sent_at: null,
    liability_waiver_pdf_url: "",
  };
}

// ---------------------------------------------------------------------------
// DocumentUpload – inline component for single-file document fields
// ---------------------------------------------------------------------------

function DocumentUpload({
  label,
  file,
  onUploaded,
  onRemoved,
}: {
  label: string;
  file: FileMetadata | null | undefined;
  onUploaded: (meta: FileMetadata) => void;
  onRemoved: () => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  async function handleFilesChange(newFiles: File[]) {
    setFiles(newFiles);
    setError(null);

    if (newFiles.length === 0) {
      if (hasFile(file)) {
        setConfirmRemove(true);
      }
      return;
    }

    const f = newFiles[0];
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", f);
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Upload failed (${res.status})`);
      }
      const metadata: FileMetadata = await res.json();
      onUploaded(metadata);
      setFiles([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      setFiles([]);
    } finally {
      setUploading(false);
    }
  }

  function doRemove() {
    setConfirmRemove(false);
    setFiles([]);
    onRemoved();
  }

  if (hasFile(file) && files.length === 0) {
    return (
      <>
        <div className="flex items-center gap-3 rounded-md border border-input bg-background px-4 py-3">
          <CheckCircle2 className="size-5 text-green-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{file?.name || "Uploaded file"}</p>
            <p className="text-xs text-muted-foreground">Uploaded successfully</p>
          </div>
          {file?.path && (
            <a
              href={
                file.url ??
                `${process.env.NEXT_PUBLIC_XANO_BASE ?? "https://xsc3-mvx7-r86m.n7e.xano.io"}${file.path}`
              }
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center size-7 shrink-0 rounded-md hover:bg-muted transition-colors"
            >
              <ExternalLink className="size-4 text-muted-foreground" />
            </a>
          )}
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
                This will remove the uploaded file. You can upload a new one afterwards.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-red-600 text-white hover:bg-red-700"
                onClick={doRemove}
              >
                Remove
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    );
  }

  return (
    <div>
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
              {uploading ? "Uploading..." : label}
            </p>
            <p className="text-xs text-muted-foreground">PDF, JPG, or PNG (max 10MB)</p>
          </div>
        </FileUploadDropzone>
        <FileUploadList>
          {files.map((f, i) => (
            <FileUploadItem key={i} value={f}>
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
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function RegistrationPage() {
  const params = useParams();
  const yearId = Number(params.yearId);

  const {
    setPageTitle,
    registerSaveHandler,
    unregisterSaveHandler,
    updateSaveOptions,
    trackAutosave,
  } = useApplicationFlow();

  // SWR hooks
  const { data: studentsData } = useStudents();
  const { data: applicationsData } = useApplications();

  // Local state
  const [parents, setParents] = useState<Parent[]>([]);
  const [emergencyContacts, setEmergencyContacts] = useState<EmergencyContact[]>([]);
  const [registrations, setRegistrations] = useState<Record<number, StudentRegistration>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [openSections, setOpenSections] = useState<Set<string>>(new Set());
  const [pendingDeleteContact, setPendingDeleteContact] = useState<{ id: number; name: string } | null>(null);
  const [pendingRemoveStudent, setPendingRemoveStudent] = useState<{ id: number; name: string } | null>(null);
  const [showValidation, setShowValidation] = useState(false);
  const [addStudentOpen, setAddStudentOpen] = useState(false);
  const [selectedStudentIds, setSelectedStudentIds] = useState<Set<number>>(new Set());
  const initialCollapseRef = useRef(false);

  // PandaDoc signing state for per-student liability waivers
  const [signingStudentId, setSigningStudentId] = useState<number | null>(null);
  const [signingLoading, setSigningLoading] = useState<number | null>(null);
  const [signingSession, setSigningSession] = useState<{ sessionId: string; documentId: string; studentId: number; applicationId: number } | null>(null);
  const signingInstanceRef = useRef<{ destroy: () => void } | null>(null);
  const pollingRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Derived: year applications and enrolled students
  const yearApps: Application[] = applicationsData
    ? (applicationsData as Application[]).filter((a) => a.registration_school_years_id === yearId)
    : [];

  const enrolledStudents: Student[] = (() => {
    if (!studentsData) return [];
    const enrolledIds = new Set(yearApps.map((a) => a.registration_students_id));
    return (studentsData as Student[]).filter((s) => enrolledIds.has(s.id));
  })();

  // ---------------------------------------------------------------------------
  // PandaDoc signing for per-student liability waivers
  // ---------------------------------------------------------------------------

  async function handleSignWaiver(studentId: number) {
    const app = yearApps.find((a) => a.registration_students_id === studentId);
    if (!app) return;

    const reg = registrations[studentId];
    const regId = reg?.id;

    // If already has a PandaDoc ID, resume the session
    if (reg?.liability_waiver_pandadoc_id) {
      setSigningLoading(studentId);
      try {
        const res = await fetch("/api/pandadoc/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "liability_waiver", applicationId: app.id }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          toast.error(body?.error ?? "Failed to prepare document.");
          return;
        }
        const { documentId, sessionId } = await res.json();
        setSigningSession({ sessionId, documentId, studentId, applicationId: app.id });
        setSigningStudentId(studentId);
        startWaiverPolling(documentId, studentId, regId);
      } catch {
        toast.error("Failed to initiate signing.");
      } finally {
        setSigningLoading(null);
      }
      return;
    }

    setSigningLoading(studentId);
    try {
      const res = await fetch("/api/pandadoc/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "liability_waiver", applicationId: app.id }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        toast.error(body?.error ?? "Failed to prepare document.");
        return;
      }

      const { documentId, sessionId } = await res.json();

      // Save PandaDoc ID to student registration record
      if (regId) {
        await fetch(`/api/student-registration/${regId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            liability_waiver_pandadoc_id: documentId,
            liability_waiver_status: "sent",
            liability_wavier_sent_at: new Date().toISOString(),
          }),
        });
        // Update local state
        updateRegistration(studentId, "liability_waiver_pandadoc_id", documentId);
        updateRegistration(studentId, "liability_waiver_status", "sent");
      }

      setSigningSession({ sessionId, documentId, studentId, applicationId: app.id });
      setSigningStudentId(studentId);
      startWaiverPolling(documentId, studentId, regId);
    } catch {
      toast.error("Failed to initiate signing.");
    } finally {
      setSigningLoading(null);
    }
  }

  function startWaiverPolling(documentId: string, studentId: number, regId?: number) {
    if (pollingRef.current) clearTimeout(pollingRef.current);
    let delay = 3000;
    const maxDelay = 30000;

    async function poll() {
      try {
        const app = yearApps.find((a) => a.registration_students_id === studentId);
        const res = await fetch(
          `/api/pandadoc/status?documentId=${documentId}&applicationId=${app?.id ?? 0}&type=liability_waiver`
        );
        if (!res.ok) {
          delay = Math.min(delay * 1.5, maxDelay);
          pollingRef.current = setTimeout(poll, delay);
          return;
        }
        const data = await res.json();
        if (data.status === "completed") {
          // Update student registration record
          if (regId) {
            await fetch(`/api/student-registration/${regId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ liability_waiver_status: "completed" }),
            });
            updateRegistration(studentId, "liability_waiver_status", "completed");
          }
          setSigningSession(null);
          setSigningStudentId(null);
          toast.success("Liability waiver signed successfully.");
          pollingRef.current = null;
          return;
        }
        delay = Math.min(delay * 1.2, maxDelay);
        pollingRef.current = setTimeout(poll, delay);
      } catch {
        delay = Math.min(delay * 1.5, maxDelay);
        pollingRef.current = setTimeout(poll, delay);
      }
    }

    pollingRef.current = setTimeout(poll, delay);
  }

  // PandaDoc embed initialization — wait for Dialog to mount the wrapper div
  useEffect(() => {
    if (!signingSession) return;
    let cancelled = false;

    const init = async () => {
      // Wait for Dialog to render the wrapper div
      let wrapper: HTMLElement | null = null;
      for (let i = 0; i < 20; i++) {
        wrapper = document.getElementById("pandadoc-reg-signing-wrapper");
        if (wrapper) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      if (!wrapper || cancelled) return;

      wrapper.innerHTML = '<div id="pandadoc-reg-signing-embed"></div>';

      const { Signing } = await import("pandadoc-signing");
      if (cancelled) return;

      if (signingInstanceRef.current) {
        signingInstanceRef.current.destroy();
        signingInstanceRef.current = null;
      }

      const signing = new Signing("pandadoc-reg-signing-embed", { debugMode: true });
      signing
        .on("document.completed", async () => {
          // Update student registration status
          const currentSession = signingSession;
          if (currentSession) {
            const reg = registrations[currentSession.studentId];
            if (reg?.id) {
              await fetch(`/api/student-registration/${reg.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ liability_waiver_status: "completed" }),
              });
              updateRegistration(currentSession.studentId, "liability_waiver_status", "completed");
            }
          }
          setSigningSession(null);
          setSigningStudentId(null);
          toast.success("Liability waiver signed successfully.");
        })
        .on("document.exception", (payload: unknown) => {
          console.error("PandaDoc signing exception:", payload);
        });

      signingInstanceRef.current = signing;
      await signing.open({ sessionId: signingSession.sessionId });
    };

    init();

    return () => {
      cancelled = true;
      if (signingInstanceRef.current) {
        signingInstanceRef.current.destroy();
        signingInstanceRef.current = null;
      }
    };
  }, [signingSession]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearTimeout(pollingRef.current);
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------------

  const fetchData = useCallback(async () => {
    try {
      const [familyRes, ecRes] = await Promise.all([
        fetch("/api/families"),
        fetch("/api/emergency-contacts"),
      ]);

      if (familyRes.ok) {
        const fam = await familyRes.json();
        setParents(fam.parents ?? []);
      }

      if (ecRes.ok) {
        const contacts: EmergencyContact[] = await ecRes.json();
        // Every family must have at least one emergency contact — seed an empty
        // card so the requirement is visible rather than hidden behind "Add".
        if (contacts.length === 0) {
          contacts.push({
            id: -Date.now(),
            first_name: "",
            last_name: "",
            email: "",
            phone: "",
            relationship: "",
            address_line_1: "",
            address_line_2: "",
            city: "",
            state: "",
            zipcode: "",
            _isNew: true,
          });
        }
        setEmergencyContacts(contacts);
      }
    } catch (err) {
      console.error("Failed to fetch registration data:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch student registrations when enrolled students are known
  const fetchRegistrations = useCallback(async () => {
    if (enrolledStudents.length === 0) return;
    try {
      const results = await Promise.all(
        enrolledStudents.map(async (s) => {
          const res = await fetch(`/api/student-registration?studentId=${s.id}`);
          if (res.ok) {
            const data = await res.json();
            // API may return null/empty if no registration exists
            if (data && typeof data === "object" && data.id) {
              return data as StudentRegistration;
            }
          }
          return null;
        })
      );

      // Compute existingIds up front — mutating inside a setState updater is
      // unreliable because the updater may run asynchronously (or multiple times
      // in concurrent/strict mode), so by the time the `if` check below runs the
      // Set could still be empty. This is why students with saved registrations
      // weren't being auto-selected on reload.
      const existingIds = new Set<number>();
      enrolledStudents.forEach((s, i) => {
        if (results[i] && results[i]!.id) {
          existingIds.add(s.id);
        }
      });

      setRegistrations((prev) => {
        const next = { ...prev };
        enrolledStudents.forEach((s, i) => {
          if (!next[s.id]) {
            next[s.id] = results[i] ?? emptyRegistration(s.id);
          }
        });
        return next;
      });
      if (existingIds.size > 0) {
        setSelectedStudentIds((prev) => {
          const next = new Set(prev);
          existingIds.forEach((id) => next.add(id));
          return next;
        });
      }
    } catch (err) {
      console.error("Failed to fetch student registrations:", err);
    }
  }, [enrolledStudents]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (enrolledStudents.length > 0) {
      fetchRegistrations();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentsData, applicationsData]);

  // Default every section to open on initial load — don't auto-collapse completed
  // ones. Users can still manually collapse via the chevron.
  useEffect(() => {
    if (loading || initialCollapseRef.current) return;
    if (!studentsData || !applicationsData) return;
    initialCollapseRef.current = true;

    const openIds = new Set<string>();
    parents.forEach((p) => openIds.add(`parent-${p.id}`));
    emergencyContacts.forEach((ec) => openIds.add(`ec-${ec.id}`));
    enrolledStudents
      .filter((s) => selectedStudentIds.has(s.id))
      .forEach((s) => openIds.add(`student-${s.id}`));
    setOpenSections(openIds);
  }, [loading, parents, emergencyContacts, enrolledStudents, registrations, studentsData, applicationsData, selectedStudentIds]);

  // ---------------------------------------------------------------------------
  // Section toggle
  // ---------------------------------------------------------------------------

  function toggleSection(key: string) {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // ---------------------------------------------------------------------------
  // Parent helpers
  // ---------------------------------------------------------------------------

  function updateParentLocal(parentId: number, field: string, value: string) {
    setParents((prev) =>
      prev.map((p) => (p.id === parentId ? { ...p, [field]: value } : p))
    );
  }

  // ---------------------------------------------------------------------------
  // Emergency contact helpers
  // ---------------------------------------------------------------------------

  function updateContactLocal(contactId: number, field: string, value: string) {
    setEmergencyContacts((prev) =>
      prev.map((c) => (c.id === contactId ? { ...c, [field]: value } : c))
    );
  }

  function addEmergencyContact() {
    const tempId = -Date.now();
    const newContact: EmergencyContact = {
      id: tempId,
      first_name: "",
      last_name: "",
      email: "",
      phone: "",
      relationship: "",
      address_line_1: "",
      address_line_2: "",
      city: "",
      state: "",
      zipcode: "",
      _isNew: true,
    };
    setEmergencyContacts((prev) => [...prev, newContact]);
    setOpenSections((prev) => new Set(prev).add(`ec-${tempId}`));
  }

  async function handleRemoveStudent(studentId: number) {
    const reg = registrations[studentId];
    setPendingRemoveStudent(null);

    // Deselect locally
    setSelectedStudentIds((prev) => {
      const next = new Set(prev);
      next.delete(studentId);
      return next;
    });
    setRegistrations((prev) => {
      const next = { ...prev };
      delete next[studentId];
      return next;
    });
    setOpenSections((prev) => {
      const next = new Set(prev);
      next.delete(`student-${studentId}`);
      return next;
    });

    // Delete persisted registration, if any
    if (reg?.id) {
      try {
        await fetch(`/api/student-registration/${reg.id}`, { method: "DELETE" });
      } catch (err) {
        console.error("Failed to delete student registration:", err);
      }
    }
  }

  function handleDeleteContact(contactId: number) {
    const contact = emergencyContacts.find((c) => c.id === contactId);
    if (!contact) return;

    // Remove from UI
    setEmergencyContacts((prev) => prev.filter((c) => c.id !== contactId));
    setPendingDeleteContact(null);

    // If it was persisted, delete from API
    if (!contact._isNew) {
      fetch(`/api/emergency-contacts/${contactId}`, { method: "DELETE" }).catch((err) =>
        console.error("Failed to delete emergency contact:", err)
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Student registration helpers
  // ---------------------------------------------------------------------------

  function updateRegistration(studentId: number, field: string, value: unknown) {
    setRegistrations((prev) => {
      const next = { ...prev };
      const reg = next[studentId] ?? emptyRegistration(studentId);
      next[studentId] = { ...reg, [field]: value };
      return next;
    });
  }

  // ---------------------------------------------------------------------------
  // Save handler
  // ---------------------------------------------------------------------------

  async function handleSaveAll() {
    setSaving(true);
    try {
      const promises: Promise<unknown>[] = [];

      // 1. PATCH all parents
      for (const p of parents) {
        promises.push(
          fetch(`/api/parents/${p.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email: p.email,
              phone: p.phone,
              relationship: p.relationship,
              address_line_1: p.address_line_1,
              address_line_2: p.address_line_2,
              city: p.city,
              state: p.state,
              zipcode: p.zipcode,
            }),
          })
        );
      }

      // 2. Emergency contacts: POST new, PATCH existing
      for (const ec of emergencyContacts) {
        if (ec._isNew) {
          promises.push(
            fetch("/api/emergency-contacts", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                first_name: ec.first_name,
                last_name: ec.last_name,
                email: ec.email,
                phone: ec.phone,
                relationship: ec.relationship,
                address_line_1: ec.address_line_1,
                address_line_2: ec.address_line_2,
                city: ec.city,
                state: ec.state,
                zipcode: ec.zipcode,
              }),
            })
          );
        } else {
          promises.push(
            fetch(`/api/emergency-contacts/${ec.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                first_name: ec.first_name,
                last_name: ec.last_name,
                email: ec.email,
                phone: ec.phone,
                relationship: ec.relationship,
                address_line_1: ec.address_line_1,
                address_line_2: ec.address_line_2,
                city: ec.city,
                state: ec.state,
                zipcode: ec.zipcode,
              }),
            })
          );
        }
      }

      // 3. Student registrations: POST new, PATCH existing
      for (const reg of Object.values(registrations)) {
        const payload = { ...reg };
        delete (payload as Record<string, unknown>)["id"];

        if (reg.id) {
          promises.push(
            fetch(`/api/student-registration/${reg.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            })
          );
        } else {
          promises.push(
            fetch("/api/student-registration", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            }).then(async (res) => {
              if (res.ok) {
                const created = await res.json();
                setRegistrations((prev) => {
                  const next = { ...prev };
                  next[reg.registration_students_id] = created;
                  return next;
                });
              } else {
                const errBody = await res.text().catch(() => "");
                console.error(
                  `Failed to create student registration for student ${reg.registration_students_id}: ${res.status} ${errBody}`
                );
              }
            })
          );
        }
      }

      await trackAutosave(
        Promise.all(promises).then((results) => {
          // Surface any non-ok response so the global badge goes red.
          const responses = results.filter((r): r is Response => r instanceof Response);
          const failed = responses.find((r) => !r.ok);
          if (failed) throw new Error(`Save failed (${failed.status})`);
          return results;
        })
      );

      // Refresh emergency contacts to get real IDs for newly created ones
      const ecRes = await fetch("/api/emergency-contacts");
      if (ecRes.ok) {
        const contacts: EmergencyContact[] = await ecRes.json();
        setEmergencyContacts(contacts);
      }
    } catch (err) {
      console.error("Failed to save registration:", err);
      toast.error("Failed to save registration. Please try again.");
      throw err;
    } finally {
      setSaving(false);
    }
  }

  const handleSaveAllRef = useRef(handleSaveAll);
  handleSaveAllRef.current = handleSaveAll;

  // Check if all registrations are complete
  const allRegistrationsComplete = selectedStudentIds.size > 0 &&
    [...selectedStudentIds].every((id) => {
      const reg = registrations[id];
      return reg && isRegistrationComplete(reg);
    }) &&
    emergencyContacts.length > 0 &&
    emergencyContacts.every((c) => isEmergencyContactComplete(c));

  const handleCompleteRef = useRef<() => Promise<void>>(() => Promise.resolve());
  handleCompleteRef.current = async () => {
    if (!allRegistrationsComplete) {
      setShowValidation(true);
      toast.error("Please fill out all required fields before completing this section.");
      throw new Error("Validation failed");
    }
    // Save first
    await handleSaveAllRef.current();
    setRegistrationLocked(true);
    toast.success("Registration section completed.");
  };

  useEffect(() => {
    setPageTitle("Registration");
    registerSaveHandler(() => handleCompleteRef.current());
    return () => unregisterSaveHandler();
  }, [setPageTitle, registerSaveHandler, unregisterSaveHandler]);


  // Auto-save on changes (debounced, snapshot-based)
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedSnapshotRef = useRef<string>("");
  const savingRef = useRef(false);
  savingRef.current = saving;

  const currentSnapshot = JSON.stringify({ parents, emergencyContacts, registrations });

  // Capture initial snapshot once data loads
  useEffect(() => {
    if (!loading && savedSnapshotRef.current === "") {
      savedSnapshotRef.current = currentSnapshot;
    }
  }, [loading, currentSnapshot]);

  useEffect(() => {
    // Don't auto-save if no baseline yet, or if currently saving
    if (savedSnapshotRef.current === "" || savingRef.current) return;
    // Don't save if nothing changed
    if (currentSnapshot === savedSnapshotRef.current) return;

    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(async () => {
      await handleSaveAllRef.current();
      savedSnapshotRef.current = JSON.stringify({
        parents,
        emergencyContacts,
        registrations,
      });
    }, 2000);
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, [currentSnapshot]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Loading skeleton
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // Card completion counts (must be before any early returns for hooks rules)
  // ---------------------------------------------------------------------------

  const parentCards = parents.map((p) => isParentComplete(p));
  const ecCards = emergencyContacts.map((ec) => isEmergencyContactComplete(ec));
  const selectedStudents = enrolledStudents.filter((s) => selectedStudentIds.has(s.id));
  const studentCards = selectedStudents.map((s) => {
    const reg = registrations[s.id];
    return reg ? isRegistrationComplete(reg) : false;
  });
  const allCards = [...parentCards, ...ecCards, ...studentCards];
  const completedCards = allCards.filter(Boolean).length;
  const totalCards = allCards.length;
  const [registrationLocked, setRegistrationLocked] = useState(false);

  useEffect(() => {
    if (loading || !studentsData || !applicationsData) return;
    if (registrationLocked) {
      updateSaveOptions({
        completed: true,
        completedLabel: "Registration Section Completed",
        onUnlock: () => setRegistrationLocked(false),
      });
    } else {
      updateSaveOptions({
        label: `Complete Registration`,
        disabled: false,
        saving,
        completed: false,
        isUnlocked: false,
      });
    }
  }, [loading, studentsData, applicationsData, saving, completedCards, totalCards, registrationLocked, updateSaveOptions]);

  if (loading || !studentsData || !applicationsData) {
    return (
      <div className="flex flex-1 flex-col gap-6 p-6 mx-auto w-full max-w-4xl">
        <div>
          <Skeleton className="h-7 w-56 mb-2" />
          <Skeleton className="h-4 w-80" />
        </div>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-lg border p-6">
            <Skeleton className="h-5 w-40 mb-4" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {Array.from({ length: 6 }).map((_, j) => (
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

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <>
      <div className="flex flex-1 flex-col gap-6 p-6 mx-auto w-full max-w-4xl">
        {/* Page header */}
        <div>
          <div className="flex items-center justify-between gap-3 pb-3 border-b">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Registration
            </p>
            <GlobalSaveStatusPill />
          </div>
          <div className="flex items-center gap-3 mt-4">
            <h1 className="text-2xl font-semibold">Complete Registration</h1>
            <span className="text-sm text-muted-foreground font-medium bg-muted px-2.5 py-0.5 rounded-full">
              {completedCards}/{totalCards}
            </span>
          </div>
          <p className="text-muted-foreground text-sm mt-2 max-w-2xl">
            Verify family contacts, upload required documents, and provide health information for each student.
          </p>
        </div>

        {/* ================================================================= */}
        {/* SECTION 1: Family & Emergency Contacts                            */}
        {/* ================================================================= */}

        <div>
          <h2 className="text-lg font-semibold mb-4">Current Primary and Secondary Contacts</h2>

          <div className="space-y-4">
            {/* Parent / Guardian Cards */}
            {parents.map((parent) => {
              const sectionKey = `parent-${parent.id}`;
              const isOpen = openSections.has(sectionKey);
              return (
                <Card key={parent.id} className="overflow-hidden gap-0 py-0 ring-0 border">
                  <CardHeader
                    className="border-b py-3 !pb-3 cursor-pointer select-none"
                    onClick={() => toggleSection(sectionKey)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Avatar className="size-10">
                          <AvatarFallback className="bg-muted text-muted-foreground text-sm font-medium">
                            {getInitials(parent.first_name, parent.last_name)}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <CardTitle className="text-lg">
                            {parent.first_name} {parent.last_name}
                          </CardTitle>
                          <p className="text-xs text-muted-foreground">Parent / Guardian</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusIcon complete={isParentComplete(parent)} />
                        <div
                          className="flex size-8 items-center justify-center rounded-md border border-input text-muted-foreground hover:bg-muted/50 transition-colors"
                          onClick={(e) => { e.stopPropagation(); toggleSection(sectionKey); }}
                        >
                          <svg className={`size-4 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                          </svg>
                        </div>
                      </div>
                    </div>
                  </CardHeader>
                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.25, ease: "easeInOut" }}
                        className="overflow-hidden"
                      >
                        <CardContent className="space-y-6 py-5 bg-white dark:bg-background">
                          {/* Contact Information */}
                          <section>
                            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                              Contact Information
                            </h3>
                            <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
                              <Field>
                                <FieldLabel className="text-xs">Email</FieldLabel>
                                <Input
                                  type="email"
                                  placeholder="email@example.com"
                                  value={parent.email || ""}
                                  onChange={(e) => updateParentLocal(parent.id, "email", e.target.value)}
                                />
                              </Field>
                              <Field>
                                <FieldLabel className="text-xs">Phone</FieldLabel>
                                <Input
                                  className={!parent.phone ? "border-red-400" : ""}
                                  placeholder="(555) 555-5555"
                                  value={parent.phone || ""}
                                  onChange={(e) => updateParentLocal(parent.id, "phone", e.target.value)}
                                />
                              </Field>
                              <Field>
                                <FieldLabel className="text-xs">Relationship</FieldLabel>
                                <Input
                                  className={!parent.relationship ? "border-red-400" : ""}
                                  placeholder="e.g. Mother"
                                  value={parent.relationship || ""}
                                  onChange={(e) => updateParentLocal(parent.id, "relationship", e.target.value)}
                                />
                              </Field>
                            </div>
                          </section>

                          <Separator />

                          {/* Address */}
                          <section>
                            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                              Address
                            </h3>
                            <div className="space-y-4">
                              <div className="grid gap-4 grid-cols-1 sm:grid-cols-[2fr_1fr]">
                                <Field>
                                  <FieldLabel className="text-xs">Street Address</FieldLabel>
                                  <Input
                                    className={!parent.address_line_1 ? "border-red-400" : ""}
                                    placeholder="123 Main Street"
                                    value={parent.address_line_1 || ""}
                                    onChange={(e) => updateParentLocal(parent.id, "address_line_1", e.target.value)}
                                  />
                                </Field>
                                <Field>
                                  <FieldLabel className="text-xs">Apt, Suite, etc.</FieldLabel>
                                  <Input
                                    placeholder="Apt 4B"
                                    value={parent.address_line_2 || ""}
                                    onChange={(e) => updateParentLocal(parent.id, "address_line_2", e.target.value)}
                                  />
                                </Field>
                              </div>
                              <div className="grid gap-4 grid-cols-1 sm:grid-cols-[2fr_1fr_1fr]">
                                <Field>
                                  <FieldLabel className="text-xs">City</FieldLabel>
                                  <Input
                                    className={!parent.city ? "border-red-400" : ""}
                                    placeholder="St. Petersburg"
                                    value={parent.city || ""}
                                    onChange={(e) => updateParentLocal(parent.id, "city", e.target.value)}
                                  />
                                </Field>
                                <Field>
                                  <FieldLabel className="text-xs">State</FieldLabel>
                                  <StateSelect
                                    value={parent.state || ""}
                                    invalid={!parent.state}
                                    onChange={(v) => updateParentLocal(parent.id, "state", v)}
                                  />
                                </Field>
                                <Field>
                                  <FieldLabel className="text-xs">Zip Code</FieldLabel>
                                  <Input
                                    className={!parent.zipcode ? "border-red-400" : ""}
                                    placeholder="33701"
                                    value={parent.zipcode || ""}
                                    onChange={(e) => updateParentLocal(parent.id, "zipcode", e.target.value)}
                                  />
                                </Field>
                              </div>
                            </div>
                          </section>
                        </CardContent>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </Card>
              );
            })}

            {/* Divider between parents and emergency contacts */}
            {parents.length > 0 && (
              <div className="pt-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Emergency Contacts
                </h3>
              </div>
            )}

            {/* Emergency Contact Cards */}
            {emergencyContacts.map((ec) => {
              const sectionKey = `ec-${ec.id}`;
              const isOpen = openSections.has(sectionKey);
              return (
                <Card key={ec.id} className="overflow-hidden gap-0 py-0 ring-0 border">
                  <CardHeader
                    className="border-b py-3 !pb-3 cursor-pointer select-none"
                    onClick={() => toggleSection(sectionKey)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Avatar className="size-10">
                          <AvatarFallback className="bg-muted text-muted-foreground text-sm font-medium">
                            {ec.first_name || ec.last_name
                              ? getInitials(ec.first_name || "?", ec.last_name || "?")
                              : "EC"}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <CardTitle className="text-lg">
                            {ec.first_name || ec.last_name
                              ? `${ec.first_name} ${ec.last_name}`.trim()
                              : "New Emergency Contact"}
                          </CardTitle>
                          <p className="text-xs text-muted-foreground">Emergency Contact</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusIcon complete={isEmergencyContactComplete(ec)} />
                        <Button
                          variant="outline"
                          size="icon"
                          className="size-8 text-muted-foreground hover:text-red-600"
                          disabled={emergencyContacts.length <= 1}
                          title={
                            emergencyContacts.length <= 1
                              ? "At least one emergency contact is required"
                              : undefined
                          }
                          onClick={(e) => {
                            e.stopPropagation();
                            if (emergencyContacts.length <= 1) {
                              toast.error("At least one emergency contact is required.");
                              return;
                            }
                            setPendingDeleteContact({
                              id: ec.id,
                              name: `${ec.first_name} ${ec.last_name}`.trim() || "this contact",
                            });
                          }}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                        <div
                          className="flex size-8 items-center justify-center rounded-md border border-input text-muted-foreground hover:bg-muted/50 transition-colors"
                          onClick={(e) => { e.stopPropagation(); toggleSection(sectionKey); }}
                        >
                          <svg className={`size-4 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                          </svg>
                        </div>
                      </div>
                    </div>
                  </CardHeader>
                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.25, ease: "easeInOut" }}
                        className="overflow-hidden"
                      >
                        <CardContent className="space-y-6 py-5 bg-white dark:bg-background">
                          {/* Contact Information */}
                          <section>
                            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                              Contact Information
                            </h3>
                            <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
                              <Field>
                                <FieldLabel className="text-xs">First Name</FieldLabel>
                                <Input
                                  className={!ec.first_name ? "border-red-400" : ""}
                                  placeholder="First name"
                                  value={ec.first_name || ""}
                                  onChange={(e) => updateContactLocal(ec.id, "first_name", e.target.value)}
                                />
                              </Field>
                              <Field>
                                <FieldLabel className="text-xs">Last Name</FieldLabel>
                                <Input
                                  className={!ec.last_name ? "border-red-400" : ""}
                                  placeholder="Last name"
                                  value={ec.last_name || ""}
                                  onChange={(e) => updateContactLocal(ec.id, "last_name", e.target.value)}
                                />
                              </Field>
                              <Field>
                                <FieldLabel className="text-xs">Relationship</FieldLabel>
                                <Input
                                  className={!ec.relationship ? "border-red-400" : ""}
                                  placeholder="e.g. Grandmother"
                                  value={ec.relationship || ""}
                                  onChange={(e) => updateContactLocal(ec.id, "relationship", e.target.value)}
                                />
                              </Field>
                            </div>
                            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 mt-4">
                              <Field>
                                <FieldLabel className="text-xs">Email <span className="text-red-400">*</span></FieldLabel>
                                <Input
                                  type="email"
                                  className={showValidation && !ec.email ? "border-red-400" : ""}
                                  placeholder="email@example.com"
                                  value={ec.email || ""}
                                  onChange={(e) => updateContactLocal(ec.id, "email", e.target.value)}
                                />
                              </Field>
                              <Field>
                                <FieldLabel className="text-xs">Phone</FieldLabel>
                                <Input
                                  className={!ec.phone ? "border-red-400" : ""}
                                  placeholder="(555) 555-5555"
                                  value={ec.phone || ""}
                                  onChange={(e) => updateContactLocal(ec.id, "phone", e.target.value)}
                                />
                              </Field>
                            </div>
                          </section>

                          <Separator />

                          {/* Address */}
                          <section>
                            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                              Address
                            </h3>
                            <div className="space-y-4">
                              <div className="grid gap-4 grid-cols-1 sm:grid-cols-[2fr_1fr]">
                                <Field>
                                  <FieldLabel className="text-xs">Street Address <span className="text-red-400">*</span></FieldLabel>
                                  <Input
                                    className={showValidation && !ec.address_line_1 ? "border-red-400" : ""}
                                    placeholder="123 Main Street"
                                    value={ec.address_line_1 || ""}
                                    onChange={(e) => updateContactLocal(ec.id, "address_line_1", e.target.value)}
                                  />
                                </Field>
                                <Field>
                                  <FieldLabel className="text-xs">Apt, Suite, etc.</FieldLabel>
                                  <Input
                                    placeholder="Apt 4B"
                                    value={ec.address_line_2 || ""}
                                    onChange={(e) => updateContactLocal(ec.id, "address_line_2", e.target.value)}
                                  />
                                </Field>
                              </div>
                              <div className="grid gap-4 grid-cols-1 sm:grid-cols-[2fr_1fr_1fr]">
                                <Field>
                                  <FieldLabel className="text-xs">City <span className="text-red-400">*</span></FieldLabel>
                                  <Input
                                    className={showValidation && !ec.city ? "border-red-400" : ""}
                                    placeholder="St. Petersburg"
                                    value={ec.city || ""}
                                    onChange={(e) => updateContactLocal(ec.id, "city", e.target.value)}
                                  />
                                </Field>
                                <Field>
                                  <FieldLabel className="text-xs">State <span className="text-red-400">*</span></FieldLabel>
                                  <StateSelect
                                    value={ec.state || ""}
                                    invalid={showValidation && !ec.state}
                                    onChange={(v) => updateContactLocal(ec.id, "state", v)}
                                  />
                                </Field>
                                <Field>
                                  <FieldLabel className="text-xs">Zip Code <span className="text-red-400">*</span></FieldLabel>
                                  <Input
                                    className={showValidation && !ec.zipcode ? "border-red-400" : ""}
                                    placeholder="33701"
                                    value={ec.zipcode || ""}
                                    onChange={(e) => updateContactLocal(ec.id, "zipcode", e.target.value)}
                                  />
                                </Field>
                              </div>
                            </div>
                          </section>
                        </CardContent>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </Card>
              );
            })}

            {/* Add Emergency Contact button */}
            <Button
              variant="outline"
              className="w-full"
              onClick={addEmergencyContact}
            >
              <Plus className="size-4 mr-1.5" />
              Add Emergency Contact
            </Button>
          </div>
        </div>

        {/* ================================================================= */}
        {/* SECTION 2: Student Registration Cards                             */}
        {/* ================================================================= */}

        {enrolledStudents.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Student Registration</h2>
              {enrolledStudents.some((s) => !selectedStudentIds.has(s.id)) && (
                <Button variant="outline" size="sm" onClick={() => setAddStudentOpen(true)}>
                  <Plus className="size-4 mr-1.5" />
                  Add Student
                </Button>
              )}
            </div>

            {selectedStudentIds.size === 0 && (
              <div className="rounded-lg border bg-white px-6 py-12 text-center">
                <p className="text-muted-foreground text-sm mb-4">
                  Select a student to begin their registration.
                </p>
                <Button onClick={() => setAddStudentOpen(true)}>
                  <Plus className="size-4 mr-1.5" />
                  Add Student to Registration
                </Button>
              </div>
            )}

            <div className="space-y-4">
              {enrolledStudents.filter((s) => selectedStudentIds.has(s.id)).map((student) => {
                const sectionKey = `student-${student.id}`;
                const isOpen = openSections.has(sectionKey);
                const reg = registrations[student.id] ?? emptyRegistration(student.id);

                return (
                  <Card key={student.id} className="overflow-hidden gap-0 py-0 ring-0 border">
                    <CardHeader
                      className="border-b py-3 !pb-3 cursor-pointer select-none"
                      onClick={() => toggleSection(sectionKey)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <Avatar className="size-10">
                            <AvatarFallback className="bg-muted text-muted-foreground text-sm font-medium">
                              {getInitials(student.first_name, student.last_name)}
                            </AvatarFallback>
                          </Avatar>
                          <CardTitle className="text-lg">
                            {student.first_name} {student.last_name}
                          </CardTitle>
                        </div>
                        <div className="flex items-center gap-2">
                          <StatusIcon complete={isRegistrationComplete(reg)} />
                          <Button
                            variant="outline"
                            size="icon"
                            className="size-8 text-muted-foreground hover:text-red-600"
                            onClick={(e) => {
                              e.stopPropagation();
                              setPendingRemoveStudent({
                                id: student.id,
                                name: `${student.first_name} ${student.last_name}`.trim() || "this student",
                              });
                            }}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                          <div
                            className="flex size-8 items-center justify-center rounded-md border border-input text-muted-foreground hover:bg-muted/50 transition-colors"
                            onClick={(e) => { e.stopPropagation(); toggleSection(sectionKey); }}
                          >
                            <svg className={`size-4 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                            </svg>
                          </div>
                        </div>
                      </div>
                    </CardHeader>
                    <AnimatePresence initial={false}>
                      {isOpen && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.25, ease: "easeInOut" }}
                          className="overflow-hidden"
                        >
                          <CardContent className="space-y-6 py-5 bg-white dark:bg-background">
                            {/* Uniform & Activities */}
                            <section>
                              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                                Uniform &amp; Activities
                              </h3>
                              <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
                                <Field>
                                  <FieldLabel className="text-xs">Shirt Size <span className="text-red-400">*</span></FieldLabel>
                                  <Select
                                    value={reg.shirt_size || ""}
                                    onValueChange={(v) => updateRegistration(student.id, "shirt_size", v)}
                                  >
                                    <SelectTrigger className={showValidation && !reg.shirt_size ? "border-red-400" : ""}>
                                      <SelectValue placeholder="Select size" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {SIZES.map((s) => (
                                        <SelectItem key={s} value={s}>{s}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </Field>
                                <Field>
                                  <FieldLabel className="text-xs">Pant Size <span className="text-red-400">*</span></FieldLabel>
                                  <Select
                                    value={reg.pant_size || ""}
                                    onValueChange={(v) => updateRegistration(student.id, "pant_size", v)}
                                  >
                                    <SelectTrigger className={showValidation && !reg.pant_size ? "border-red-400" : ""}>
                                      <SelectValue placeholder="Select size" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {SIZES.map((s) => (
                                        <SelectItem key={s} value={s}>{s}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </Field>
                                <Field>
                                  <FieldLabel className="text-xs">Swim Level <span className="text-red-400">*</span></FieldLabel>
                                  <Select
                                    value={reg.swim_level || ""}
                                    onValueChange={(v) => updateRegistration(student.id, "swim_level", v)}
                                  >
                                    <SelectTrigger className={showValidation && !reg.swim_level ? "border-red-400" : ""}>
                                      <SelectValue placeholder="Select level" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {SWIM_LEVELS.map((l) => (
                                        <SelectItem key={l} value={l}>{l}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </Field>
                              </div>
                            </section>

                            <Separator />

                            {/* Required Documents */}
                            <section>
                              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                                Required Documents <span className="text-red-400">*</span>
                              </h3>
                              <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
                                {REQUIRED_DOCUMENTS.map(({ key, label }) => (
                                  <Field key={key}>
                                    <FieldLabel className="text-xs">{label} <span className="text-red-400">*</span></FieldLabel>
                                    <DocumentUpload
                                      label={`Upload ${label}`}
                                      file={reg[key] as FileMetadata}
                                      onUploaded={(meta) => updateRegistration(student.id, key, meta)}
                                      onRemoved={() => updateRegistration(student.id, key, {})}
                                    />
                                  </Field>
                                ))}
                              </div>
                            </section>

                            <Separator />

                            {/* Optional Documents */}
                            <section>
                              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                                Optional Documents
                              </h3>
                              <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
                                {OPTIONAL_DOCUMENTS.map(({ key, label }) => (
                                  <Field key={key}>
                                    <FieldLabel className="text-xs">{label}</FieldLabel>
                                    <DocumentUpload
                                      label={`Upload ${label}`}
                                      file={reg[key] as FileMetadata}
                                      onUploaded={(meta) => updateRegistration(student.id, key, meta)}
                                      onRemoved={() => updateRegistration(student.id, key, {})}
                                    />
                                  </Field>
                                ))}
                              </div>
                              <div className="mt-4">
                                <Field>
                                  <FieldLabel className="text-xs">IEP Description</FieldLabel>
                                  <Textarea
                                    placeholder="Describe IEP if applicable..."
                                    value={reg.iep_description || ""}
                                    onChange={(e) => updateRegistration(student.id, "iep_description", e.target.value)}
                                    rows={2}
                                  />
                                </Field>
                              </div>
                            </section>

                            <Separator />

                            {/* Health & Medical */}
                            <section>
                              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                                Health &amp; Medical
                              </h3>
                              <div className="space-y-4">
                                <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
                                  <Field>
                                    <FieldLabel className="text-xs">Allergies <span className="text-red-400">*</span></FieldLabel>
                                    <Textarea
                                      placeholder="List any allergies..."
                                      value={reg.allergies || ""}
                                      onChange={(e) => updateRegistration(student.id, "allergies", e.target.value)}
                                      className={showValidation && !reg.allergies ? "border-red-400" : ""}
                                      rows={2}
                                    />
                                  </Field>
                                </div>
                                <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
                                  <Field>
                                    <FieldLabel className="text-xs">Dietary Restrictions <span className="text-red-400">*</span></FieldLabel>
                                    <Textarea
                                      placeholder="List any dietary restrictions..."
                                      value={reg.dietary_restrictions || ""}
                                      onChange={(e) => updateRegistration(student.id, "dietary_restrictions", e.target.value)}
                                      className={showValidation && !reg.dietary_restrictions ? "border-red-400" : ""}
                                      rows={2}
                                    />
                                  </Field>
                                  <Field>
                                    <FieldLabel className="text-xs">Prescription Medications <span className="text-red-400">*</span></FieldLabel>
                                    <Textarea
                                      placeholder="List any prescription medications..."
                                      value={reg.prescription_medications || ""}
                                      onChange={(e) => updateRegistration(student.id, "prescription_medications", e.target.value)}
                                      className={showValidation && !reg.prescription_medications ? "border-red-400" : ""}
                                      rows={2}
                                    />
                                  </Field>
                                </div>
                                <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
                                  <Field>
                                    <FieldLabel className="text-xs">Health Conditions <span className="text-red-400">*</span></FieldLabel>
                                    <Textarea
                                      placeholder="Describe any health conditions..."
                                      value={reg.health_conditions || ""}
                                      onChange={(e) => updateRegistration(student.id, "health_conditions", e.target.value)}
                                      className={showValidation && !reg.health_conditions ? "border-red-400" : ""}
                                      rows={2}
                                    />
                                  </Field>
                                  <Field>
                                    <FieldLabel className="text-xs">Additional Health Information</FieldLabel>
                                    <Textarea
                                      placeholder="Any additional health information..."
                                      value={reg.additional_health_information || ""}
                                      onChange={(e) => updateRegistration(student.id, "additional_health_information", e.target.value)}
                                      rows={2}
                                    />
                                  </Field>
                                </div>
                                <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
                                  <Field>
                                    <FieldLabel className="text-xs">Vision Impairments <span className="text-red-400">*</span></FieldLabel>
                                    <Input
                                      placeholder="Describe any vision impairments..."
                                      value={reg.vision_impairments || ""}
                                      onChange={(e) => updateRegistration(student.id, "vision_impairments", e.target.value)}
                                      className={showValidation && !reg.vision_impairments ? "border-red-400" : ""}
                                    />
                                  </Field>
                                  <Field>
                                    <FieldLabel className="text-xs">Hearing Impairments <span className="text-red-400">*</span></FieldLabel>
                                    <Input
                                      placeholder="Describe any hearing impairments..."
                                      value={reg.hearing_impairments || ""}
                                      onChange={(e) => updateRegistration(student.id, "hearing_impairments", e.target.value)}
                                      className={showValidation && !reg.hearing_impairments ? "border-red-400" : ""}
                                    />
                                  </Field>
                                </div>

                                <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
                                  <Field>
                                    <FieldLabel className="text-xs">Permission for Acetaminophen <span className="text-red-400">*</span></FieldLabel>
                                    <Select
                                      value={reg.permission_for_acetaminophen || ""}
                                      onValueChange={(v) => updateRegistration(student.id, "permission_for_acetaminophen", v)}
                                    >
                                      <SelectTrigger className={showValidation && !reg.permission_for_acetaminophen ? "border-red-400" : ""}>
                                        <SelectValue placeholder="Select" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {YES_NO.map((o) => (
                                          <SelectItem key={o} value={o}>{o}</SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </Field>
                                  <Field>
                                    <FieldLabel className="text-xs">Interested in Counseling Services <span className="text-red-400">*</span></FieldLabel>
                                    <Select
                                      value={reg.interested_in_counseling_services || ""}
                                      onValueChange={(v) => updateRegistration(student.id, "interested_in_counseling_services", v)}
                                    >
                                      <SelectTrigger className={showValidation && !reg.interested_in_counseling_services ? "border-red-400" : ""}>
                                        <SelectValue placeholder="Select" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {YES_NO_MAYBE.map((o) => (
                                          <SelectItem key={o} value={o}>{o}</SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </Field>
                                </div>
                              </div>
                            </section>

                            <Separator />

                            {/* EpiPen */}
                            <section>
                              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                                EpiPen
                              </h3>
                              <label className="inline-flex cursor-pointer items-center gap-3">
                                <input
                                  type="checkbox"
                                  checked={reg.carry_epi_pen || false}
                                  onChange={(e) => updateRegistration(student.id, "carry_epi_pen", e.target.checked)}
                                  className="size-5 cursor-pointer rounded accent-primary"
                                />
                                <span className="text-sm select-none">Yes, my child carries an EpiPen</span>
                              </label>
                              <AnimatePresence initial={false}>
                                {reg.carry_epi_pen && (
                                  <motion.div
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: "auto" }}
                                    exit={{ opacity: 0, height: 0 }}
                                    transition={{ duration: 0.2, ease: "easeInOut" }}
                                    className="overflow-hidden"
                                  >
                                    <div className="mt-4">
                                      <Field>
                                        <FieldLabel className="text-xs">Please explain <span className="text-red-400">*</span></FieldLabel>
                                        <Textarea
                                          placeholder="Describe the allergy, when to administer, and any other relevant details..."
                                          value={reg.epipen_explainer || ""}
                                          onChange={(e) => updateRegistration(student.id, "epipen_explainer", e.target.value)}
                                          className={showValidation && reg.carry_epi_pen && !reg.epipen_explainer ? "border-red-400" : ""}
                                          rows={3}
                                        />
                                      </Field>
                                    </div>
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </section>

                            <Separator />

                            {/* Medicaid */}
                            <section>
                              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                                Medicaid
                              </h3>
                              <label className="inline-flex cursor-pointer items-center gap-3">
                                <input
                                  type="checkbox"
                                  checked={reg.is_student_on_medicaid || false}
                                  onChange={(e) => updateRegistration(student.id, "is_student_on_medicaid", e.target.checked)}
                                  className="size-5 cursor-pointer rounded accent-primary"
                                />
                                <span className="text-sm select-none">Is your student currently on Medicaid?</span>
                              </label>
                              <AnimatePresence initial={false}>
                                {reg.is_student_on_medicaid && (
                                  <motion.div
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: "auto" }}
                                    exit={{ opacity: 0, height: 0 }}
                                    transition={{ duration: 0.2, ease: "easeInOut" }}
                                    className="overflow-hidden"
                                  >
                                    <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 mt-4">
                                      <Field>
                                        <FieldLabel className="text-xs">Medicaid Number</FieldLabel>
                                        <Input
                                          placeholder="Medicaid number"
                                          value={reg.medicaid_number || ""}
                                          onChange={(e) => updateRegistration(student.id, "medicaid_number", e.target.value)}
                                        />
                                      </Field>
                                      <Field>
                                        <FieldLabel className="text-xs">Medicaid Provider</FieldLabel>
                                        <Input
                                          placeholder="Medicaid provider"
                                          value={reg.medicaid_provider || ""}
                                          onChange={(e) => updateRegistration(student.id, "medicaid_provider", e.target.value)}
                                        />
                                      </Field>
                                    </div>
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </section>

                            <Separator />

                            {/* Pickup & Safety */}
                            <section>
                              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                                Pickup &amp; Safety
                              </h3>
                              <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
                                <Field>
                                  <FieldLabel className="text-xs">Other Adults Approved for Pickup <span className="text-red-400">*</span></FieldLabel>
                                  <Textarea
                                    placeholder="List names and relationships of approved adults..."
                                    value={reg.other_adults_approved_for_pickup || ""}
                                    onChange={(e) => updateRegistration(student.id, "other_adults_approved_for_pickup", e.target.value)}
                                    className={showValidation && !reg.other_adults_approved_for_pickup ? "border-red-400" : ""}
                                    rows={3}
                                  />
                                </Field>
                                <Field>
                                  <FieldLabel className="text-xs">Prohibited Adults <span className="text-red-400">*</span></FieldLabel>
                                  <Textarea
                                    placeholder="List any adults prohibited from picking up the student..."
                                    value={reg.prohibited_adults || ""}
                                    onChange={(e) => updateRegistration(student.id, "prohibited_adults", e.target.value)}
                                    className={showValidation && !reg.prohibited_adults ? "border-red-400" : ""}
                                    rows={3}
                                  />
                                </Field>
                              </div>
                            </section>

                            <Separator />

                            {/* Liability Waiver */}
                            <section>
                              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                                Liability Waiver <span className="text-red-400">*</span>
                              </h3>
                              <div className="rounded-md border border-input bg-white p-4">
                                {(() => {
                                  const waiverStatus = reg.liability_waiver_status;
                                  const waiverSent = !!reg.liability_waiver_pandadoc_id;
                                  const isLoading = signingLoading === student.id;

                                  if (waiverStatus === "completed") {
                                    return (
                                      <div className="flex items-center gap-3">
                                        <CheckCircle2 className="size-5 text-green-600 shrink-0" />
                                        <div>
                                          <p className="text-sm font-medium">Liability waiver signed</p>
                                          <p className="text-xs text-muted-foreground">This document has been signed and completed.</p>
                                        </div>
                                      </div>
                                    );
                                  }

                                  if (waiverSent) {
                                    return (
                                      <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                          <Clock className="size-5 text-amber-500 shrink-0" />
                                          <div>
                                            <p className="text-sm font-medium">Awaiting signature</p>
                                            <p className="text-xs text-muted-foreground">A liability waiver has been prepared and is awaiting your signature.</p>
                                          </div>
                                        </div>
                                        <Button
                                          size="sm"
                                          disabled={isLoading}
                                          onClick={() => handleSignWaiver(student.id)}
                                        >
                                          {isLoading ? <><Loader2 className="size-3 animate-spin mr-1.5" /> Preparing...</> : "Sign Now"}
                                        </Button>
                                      </div>
                                    );
                                  }

                                  return (
                                    <div className="flex items-center justify-between">
                                      <div>
                                        <p className="text-sm font-medium">Liability waiver required</p>
                                        <p className="text-xs text-muted-foreground">A signed liability waiver is required for each student.</p>
                                      </div>
                                      <Button
                                        size="sm"
                                        disabled={isLoading}
                                        onClick={() => handleSignWaiver(student.id)}
                                      >
                                        {isLoading ? <><Loader2 className="size-3 animate-spin mr-1.5" /> Preparing...</> : "Sign Waiver"}
                                      </Button>
                                    </div>
                                  );
                                })()}
                              </div>
                            </section>
                          </CardContent>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </Card>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Remove Student from Registration Confirmation */}
      <AlertDialog open={!!pendingRemoveStudent} onOpenChange={(open) => { if (!open) setPendingRemoveStudent(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove student from registration?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove {pendingRemoveStudent?.name} from this year&apos;s registration and discard their
              registration details (documents, health info, waiver). The student record and application remain.
              You can re-add them later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={() => pendingRemoveStudent && handleRemoveStudent(pendingRemoveStudent.id)}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Emergency Contact Confirmation */}
      <AlertDialog open={!!pendingDeleteContact} onOpenChange={(open) => { if (!open) setPendingDeleteContact(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove {pendingDeleteContact?.name}. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={() => pendingDeleteContact && handleDeleteContact(pendingDeleteContact.id)}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Add Student to Registration Dialog */}
      <Dialog open={addStudentOpen} onOpenChange={setAddStudentOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Student to Registration</DialogTitle>
            <DialogDescription>
              Select a student from your family to add to the registration.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border divide-y">
            {enrolledStudents
              .filter((s) => !selectedStudentIds.has(s.id))
              .map((student) => (
                <div
                  key={student.id}
                  className="flex items-center justify-between px-4 py-3"
                >
                  <div className="flex items-center gap-3">
                    <Avatar className="size-10">
                      <AvatarFallback className="bg-muted text-muted-foreground text-sm font-medium">
                        {getInitials(student.first_name, student.last_name)}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="text-sm font-medium">{student.first_name} {student.last_name}</p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => {
                      setSelectedStudentIds((prev) => {
                        const next = new Set(prev);
                        next.add(student.id);
                        return next;
                      });
                      // Initialize registration if not exists
                      setRegistrations((prev) => {
                        const next = { ...prev };
                        if (!next[student.id]) {
                          next[student.id] = emptyRegistration(student.id);
                        }
                        return next;
                      });
                      // Auto-open the new card
                      setOpenSections((prev) => {
                        const next = new Set(prev);
                        next.add(`student-${student.id}`);
                        return next;
                      });
                      setAddStudentOpen(false);
                    }}
                  >
                    Add
                  </Button>
                </div>
              ))}
            {enrolledStudents.filter((s) => !selectedStudentIds.has(s.id)).length === 0 && (
              <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                All students have been added to registration.
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* PandaDoc Signing Modal */}
      <Dialog
        open={!!signingSession}
        onOpenChange={(open) => {
          if (!open) {
            if (signingInstanceRef.current) {
              signingInstanceRef.current.destroy();
              signingInstanceRef.current = null;
            }
            if (pollingRef.current) {
              clearTimeout(pollingRef.current);
              pollingRef.current = null;
            }
            setSigningSession(null);
            setSigningStudentId(null);
            // Refresh applications to pick up any status changes
            mutateApplications();
          }
        }}
      >
        <DialogContent className="max-w-[95vw] sm:max-w-[95vw] w-full h-[90vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-6 py-4 border-b shrink-0">
            <DialogTitle>
              Sign Liability Waiver
              {signingSession && (() => {
                const s = enrolledStudents.find((st) => st.id === signingSession.studentId);
                return s ? ` — ${s.first_name} ${s.last_name}` : "";
              })()}
            </DialogTitle>
            <DialogDescription>
              Review and sign the liability waiver below.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 relative overflow-hidden">
            <style>{`
              #pandadoc-reg-signing-wrapper {
                position: absolute;
                inset: 0;
              }
              #pandadoc-reg-signing-wrapper iframe {
                width: 100% !important;
                height: 100% !important;
                border: none;
              }
            `}</style>
            <div id="pandadoc-reg-signing-wrapper" className="absolute inset-0" />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

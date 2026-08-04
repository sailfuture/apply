"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useParams } from "next/navigation";
import { useApplicationFlow } from "@/contexts/application-flow-context";
import { useApplications, useStudents, mutateApplications, mutateStudents } from "@/hooks/use-api";
import { useSWRConfig } from "swr";
import { useFamilyProgress } from "@/hooks/use-family-progress";
import { useStudentRegistrationProgress } from "@/hooks/use-student-registration-progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { InviteStatusBadge, ResendInviteButton } from "@/components/invite-status";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StateSelect } from "@/components/state-select";
import { OptionSelect } from "@/components/option-select";
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import {
  Trash2,
  Plus,
  FileUp,
  X,
  Loader2,
  CheckCircle2,
  Clock,
  ExternalLink,
  Info,
  Camera,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { GlobalSaveStatusPill } from "@/components/save-status-pill";
import { AnimatePresence, motion } from "motion/react";
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
  FileUploadTrigger,
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
  invite_status: string;
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
  /** Student's own phone number — canonical 10-digit US digits.
   *  Evergreen on `registration_students`; entered on this packet. */
  student_phone?: string;
  // Document arrays live on `registration_students` (evergreen, per student).
  // Parents can upload multiple files per category.
  birth_certificate?: FileMetadata[];
  school_health_form?: FileMetadata[];
  transcripts?: FileMetadata[];
  immunization_forms?: FileMetadata[];
  passport?: FileMetadata[];
  student_state_id?: FileMetadata[];
  iep?: FileMetadata[];
  ssn_card?: FileMetadata[];
  discipline?: FileMetadata[];
}

// Keys on the Student object that are document-array fields.
type StudentDocField =
  | "birth_certificate"
  | "school_health_form"
  | "transcripts"
  | "immunization_forms"
  | "passport"
  | "student_state_id"
  | "iep"
  | "ssn_card"
  | "discipline";

interface Application {
  id: number;
  registration_students_id: number;
  registration_school_years_id: number;
  /** Soft-delete flag — `false` means the parent removed this student
   *  from the year. We hide inactive apps from the registration roster
   *  so removed students don't auto-preload back in. Treat undefined
   *  as active for legacy rows that predate the column. */
  isActive?: boolean;
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
  /** Year this packet belongs to — packets are per (student, year). */
  registration_school_years_id: number;
  /** New Enrollment vs Re-Enrollment — admin-set elsewhere, defaulted from
   *  the family application progress row on create. */
  registration_type_id: number;
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
  liability_waiver_sent_at: string | null;
  liability_waiver_pdf_url: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SIZES = ["XS", "S", "M", "L", "XL", "XXL"];
const SWIM_LEVELS = ["None", "Beginner", "Intermediate", "Advanced"];
const YES_NO = ["Yes", "No"];
const YES_NO_MAYBE = ["Yes", "No", "Maybe"];

// Florida Medicaid managed-care plan options. Same list the admissions
// team uses — admin can extend this array when new plans are accepted.
const MEDICAID_PROVIDERS = [
  "Humana Healthy Horizons in Florida",
  "Sunshine Health",
  "Simply Healthcare Plan",
  "UnitedHealthcare Community Plan of Florida",
  "Aetna Better Health of Florida",
];

// Helper — map string arrays into the { value, label } shape OptionSelect expects.
const toOptions = (items: string[]) => items.map((i) => ({ value: i, label: i }));

const REQUIRED_DOCUMENTS: { key: StudentDocField; label: string }[] = [
  { key: "birth_certificate", label: "Birth Certificate" },
  { key: "school_health_form", label: "School Health Form" },
  { key: "transcripts", label: "Transcripts" },
  { key: "immunization_forms", label: "Immunization Forms" },
];

/** Per-document parent-facing guidance: a short how-to (rendered in a
 *  popover) and an external link to the relevant ordering page. Keyed by
 *  the same StudentDocField used on the student record. */
const DOC_GUIDES: Partial<
  Record<StudentDocField, { sourceUrl: string; sourceLabel: string; help: React.ReactNode }>
> = {
  school_health_form: {
    sourceUrl:
      "https://www.floridahealth.gov/wp-content/uploads/2025/07/school-health-entry-exam-form-dh3040-chp-07-2013.pdf",
    sourceLabel: "Download DH3040 form",
    help: (
      <>
        <p className="text-sm font-medium mb-1">School Entry Health Exam (DH3040)</p>
        <p className="text-xs text-muted-foreground">
          Download the Florida DH3040 form and have it completed by your child&rsquo;s
          doctor at their physical, then upload the signed copy here.
        </p>
      </>
    ),
  },
  immunization_forms: {
    sourceUrl:
      "https://flshotsusers.com/patients-and-parents/request-your-immunization-records",
    sourceLabel: "Request via Florida SHOTS",
    help: (
      <>
        <p className="text-sm font-medium mb-1">How to get immunization records</p>
        <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-4">
          <li>
            <span className="font-medium text-foreground">Ask your provider.</span>{" "}
            Most use Florida SHOTS and can print your child&rsquo;s history on request.
          </li>
          <li>
            <span className="font-medium text-foreground">County health department.</span>{" "}
            If your provider isn&rsquo;t on Florida SHOTS, request from your local county
            health department.
          </li>
          <li>
            <span className="font-medium text-foreground">Florida SHOTS online.</span>{" "}
            Adults (18+) can submit form DH3203 directly. Minor records must go through
            a provider or the county health department.
          </li>
        </ul>
      </>
    ),
  },
  transcripts: {
    sourceUrl:
      "https://www.pcsb.org/departments/student-support/records-management/transcript-verification-records",
    sourceLabel: "Pinellas County Records Management",
    help: (
      <>
        <p className="text-sm font-medium mb-1">Where to request transcripts</p>
        <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-4">
          <li>
            <span className="font-medium text-foreground">Current / recent students.</span>{" "}
            Within 5 years of a Pinellas high school or 7 years of elementary/middle —
            contact the last school attended directly.
          </li>
          <li>
            <span className="font-medium text-foreground">Older records.</span>{" "}
            Use the ScribOrder online system linked above.
          </li>
        </ul>
        <p className="text-xs text-muted-foreground mt-2">
          Questions? Pinellas County Records Management —{" "}
          <a
            href="mailto:centralrecords@pcsb.org"
            className="underline underline-offset-2"
          >
            centralrecords@pcsb.org
          </a>
          , (727) 793-2701.
        </p>
      </>
    ),
  },
  birth_certificate: {
    sourceUrl: "https://www.floridahealth.gov/certificates-records/birth-certificates/",
    sourceLabel: "Florida Department of Health — Birth Certificates",
    help: (
      <>
        <p className="text-sm font-medium mb-1">Ordering a Florida birth certificate</p>
        <p className="text-xs text-muted-foreground mb-2">
          Eligible requestors: the registrant (18+), a parent named on the record, or
          a legal guardian. Photo ID required.
        </p>
        <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-4">
          <li>
            <span className="font-medium text-foreground">Online (recommended).</span>{" "}
            VitalChek is Florida&rsquo;s only authorized online vendor — $19 Bureau fee +
            $7 processing, mailed to you.
          </li>
          <li>
            <span className="font-medium text-foreground">By mail.</span>{" "}
            Florida Bureau of Vital Statistics, PO Box 210, Jacksonville FL 32231 — $9
            per certificate, 3-5 business days.
          </li>
          <li>
            <span className="font-medium text-foreground">In person.</span>{" "}
            1217 N Pearl St, Jacksonville (Mon-Fri 8am-4:30pm). $10 rush for same-day.
          </li>
          <li>
            <span className="font-medium text-foreground">County health department.</span>{" "}
            For records from 1917 to present, mail-in or walk-in (fees vary).
          </li>
        </ul>
      </>
    ),
  },
};

function DocumentGuide({
  guide,
}: {
  guide: { sourceUrl: string; sourceLabel: string; help: React.ReactNode };
}) {
  return (
    <span className="inline-flex items-center gap-1 ml-1">
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="About this document"
            className="inline-flex items-center justify-center size-4 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <Info className="size-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 text-left">
          {guide.help}
          <div className="mt-3 pt-3 border-t">
            <a
              href={guide.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-primary underline underline-offset-2 hover:no-underline"
            >
              {guide.sourceLabel}
              <ExternalLink className="size-3" />
            </a>
          </div>
        </PopoverContent>
      </Popover>
      <a
        href={guide.sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={guide.sourceLabel}
        className="inline-flex items-center justify-center size-4 rounded text-muted-foreground hover:text-primary hover:bg-muted transition-colors"
      >
        <ExternalLink className="size-3.5" />
      </a>
    </span>
  );
}

const OPTIONAL_DOCUMENTS: { key: StudentDocField; label: string }[] = [
  { key: "iep", label: "IEP" },
  { key: "ssn_card", label: "SSN Card" },
  { key: "passport", label: "Passport" },
  { key: "student_state_id", label: "Student State ID" },
  { key: "discipline", label: "Discipline Records" },
];

/** True when the student has at least one valid file uploaded under `field`. */
function hasAnyStudentDoc(student: Student | undefined, field: StudentDocField): boolean {
  const arr = student?.[field];
  if (!Array.isArray(arr) || arr.length === 0) return false;
  return arr.some((m) => hasFile(m));
}

function getInitials(first: string, last: string): string {
  return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
}

function hasFile(meta: FileMetadata | null | undefined): boolean {
  return !!meta && Object.keys(meta).length > 0 && !!meta.path;
}

function isRegistrationComplete(reg: StudentRegistration, student: Student | undefined): boolean {
  // Uniform
  if (!reg.shirt_size || !reg.pant_size || !reg.swim_level) return false;
  // Required documents — now live on the student record (evergreen, array).
  if (!hasAnyStudentDoc(student, "birth_certificate")) return false;
  if (!hasAnyStudentDoc(student, "school_health_form")) return false;
  if (!hasAnyStudentDoc(student, "transcripts")) return false;
  if (!hasAnyStudentDoc(student, "immunization_forms")) return false;
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

function emptyRegistration(
  studentId: number,
  yearId: number,
  typeId: number
): StudentRegistration {
  return {
    registration_students_id: studentId,
    registration_school_years_id: yearId,
    registration_type_id: typeId,
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
    liability_waiver_sent_at: null,
    liability_waiver_pdf_url: "",
  };
}

// ---------------------------------------------------------------------------
// DocumentUpload – multi-file uploader for the per-student document arrays
// on `registration_students`. Parents can add multiple files per category
// (e.g. two pages of a passport, a set of immunization forms, etc.).
// ---------------------------------------------------------------------------

function DocumentUpload({
  label,
  files,
  onUploaded,
  onRemoved,
  invalid = false,
}: {
  label: string;
  /** Current array of uploaded file metadata (Xano file shape). */
  files: FileMetadata[];
  /** Called after a successful upload with the new metadata. The parent is
   *  responsible for appending to its array state and persisting. */
  onUploaded: (meta: FileMetadata) => void;
  /** Remove the file at `index` from the array. */
  onRemoved: (index: number) => void;
  /** When true AND the array is empty, highlight the dropzone red. */
  invalid?: boolean;
}) {
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<number | null>(null);

  const hasAny = files.some((f) => hasFile(f));

  async function handleFilesChange(newFiles: File[]) {
    setPendingFiles(newFiles);
    setError(null);
    if (newFiles.length === 0) return;

    // Upload each selected file in series so errors surface one at a time
    // and partial successes are persisted.
    setUploading(true);
    try {
      for (const f of newFiles) {
        const formData = new FormData();
        formData.append("file", f);
        const res = await fetch("/api/upload", { method: "POST", body: formData });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error ?? `Upload failed (${res.status})`);
        }
        const metadata: FileMetadata = await res.json();
        onUploaded(metadata);
      }
      setPendingFiles([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      setPendingFiles([]);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Previously-uploaded files — each is independently removable. */}
      {files.map((file, idx) => {
        if (!hasFile(file)) return null;
        return (
          <div
            key={(file.path as string) ?? idx}
            className="flex items-center gap-3 rounded-md border border-input bg-background px-4 py-3"
          >
            <CheckCircle2 className="size-5 text-green-600 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">
                {(file.name as string) || `Uploaded file ${idx + 1}`}
              </p>
              <p className="text-xs text-muted-foreground">Uploaded successfully</p>
            </div>
            {file.path && (
              <a
                href={
                  (file.url as string) ??
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
              onClick={() => setConfirmRemove(idx)}
            >
              <X className="size-4" />
            </Button>
          </div>
        );
      })}

      {/* Dropzone — always rendered so parents can add additional files. */}
      <FileUpload
        maxFiles={5}
        maxSize={10 * 1024 * 1024}
        accept=".pdf,.jpg,.jpeg,.png,.heic,.heif"
        className="w-full"
        value={pendingFiles}
        onValueChange={handleFilesChange}
        disabled={uploading}
      >
        <FileUploadDropzone
          className={`flex-row gap-3 px-4 py-3 cursor-pointer ${
            invalid && !hasAny ? "border-2 border-red-400" : ""
          }`}
        >
          {uploading ? (
            <Loader2 className="size-5 text-muted-foreground animate-spin" />
          ) : (
            <FileUp className="size-5 text-muted-foreground" />
          )}
          <div className="flex-1 text-left">
            <p className="text-sm font-medium">
              {uploading
                ? "Uploading..."
                : hasAny
                  ? `Add another ${label.toLowerCase()}`
                  : label}
            </p>
            <p className="text-xs text-muted-foreground">PDF, JPG, PNG, or HEIC (max 10MB each, up to 5)</p>
          </div>
        </FileUploadDropzone>
        {/* Touch-only shortcut to snap a photo of a paper document. Hidden on
            desktop (pointer-coarse) since `capture` only does anything on
            mobile; the dropzone above still handles file/PDF selection. */}
        <FileUploadTrigger asChild capture="environment">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="hidden w-full pointer-coarse:flex"
          >
            <Camera className="size-4" />
            Take a photo
          </Button>
        </FileUploadTrigger>
        <FileUploadList>
          {pendingFiles.map((f, i) => (
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

      <AlertDialog
        open={confirmRemove !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmRemove(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove uploaded file?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the uploaded file. You can upload another afterwards.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={() => {
                if (confirmRemove !== null) onRemoved(confirmRemove);
                setConfirmRemove(null);
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
  const { mutate: swrMutate } = useSWRConfig();
  const { data: studentsData } = useStudents();
  const { data: applicationsData } = useApplications();
  // Pull the current registration_type_id off the family application progress
  // row. Every new student_registration row is stamped with this so the
  // packet is scoped to (student, year, type).
  const { progress } = useFamilyProgress(yearId);
  // Default to 1 ("New Application") if the progress row hasn't resolved
  // yet — matches the server-side default in /api/family-progress.
  const registrationTypeId = progress?.registration_type_id ?? 1;

  // Registration-progress bridge row — `isRegistration` latches when the
  // parent clicks "Complete Registration". Drives the sidenav state and
  // the post-enrollment dashboard trigger.
  const { progress: regProgress, setSection: setRegSection } =
    useStudentRegistrationProgress(yearId);

  // Local state
  const [parents, setParents] = useState<Parent[]>([]);
  const [emergencyContacts, setEmergencyContacts] = useState<EmergencyContact[]>([]);
  const [registrations, setRegistrations] = useState<Record<number, StudentRegistration>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pendingDeleteContact, setPendingDeleteContact] = useState<{ id: number; name: string } | null>(null);
  const [pendingRemoveStudent, setPendingRemoveStudent] = useState<{ id: number; name: string } | null>(null);
  const [showValidation, setShowValidation] = useState(false);
  const [addStudentOpen, setAddStudentOpen] = useState(false);
  const [selectedStudentIds, setSelectedStudentIds] = useState<Set<number>>(new Set());

  // Per-student phone draft, keyed by student id. `student_phone` lives on
  // the evergreen `registration_students` row (not the per-year packet),
  // so we hold a local editable copy and persist it on blur + on the
  // section save. Seeded from each student's saved value once the students
  // load (effect below); the ref mirror lets the blur handler read the
  // latest draft without a stale closure.
  const [studentPhoneDraft, setStudentPhoneDraft] = useState<Record<number, string>>({});
  const studentPhoneDraftRef = useRef(studentPhoneDraft);
  studentPhoneDraftRef.current = studentPhoneDraft;

  // Invite-a-parent state — same Clerk invitation flow as /family. Sends an
  // email the secondary contact uses to create their own Clerk account and
  // link to this family.
  const [inviteSheetOpen, setInviteSheetOpen] = useState(false);
  const [inviteFirstName, setInviteFirstName] = useState("");
  const [inviteLastName, setInviteLastName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRelationship, setInviteRelationship] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState("");

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviting(true);
    setInviteError("");
    try {
      const res = await fetch("/api/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: inviteEmail,
          first_name: inviteFirstName,
          last_name: inviteLastName,
          relationship: inviteRelationship,
        }),
      });
      if (res.ok) {
        setInviteSheetOpen(false);
        setInviteFirstName("");
        setInviteLastName("");
        setInviteEmail("");
        setInviteRelationship("");
        // Pull the new pending parent into the Parents section immediately.
        await fetchData();
        toast.success("Invitation sent. They'll receive an email to join.");
      } else {
        const body = await res.json().catch(() => null);
        setInviteError(body?.error ?? "Failed to send invitation");
      }
    } catch {
      setInviteError("Network error — please try again");
    } finally {
      setInviting(false);
    }
  }

  // PandaDoc signing state for per-student liability waivers
  const [signingStudentId, setSigningStudentId] = useState<number | null>(null);
  const [signingLoading, setSigningLoading] = useState<number | null>(null);
  const [signingSession, setSigningSession] = useState<{ sessionId: string; documentId: string; studentId: number; applicationId: number } | null>(null);
  // `docLoaded` gates the full-screen "Preparing your waiver..."
  // overlay — flips true when PandaDoc's embed fires `document.loaded`.
  // Without this, signingSession is set the moment the API returns
  // (before the iframe has any content), and the parent would see a
  // blank dialog interior under the doc-load delay.
  const [docLoaded, setDocLoaded] = useState(false);
  const signingInstanceRef = useRef<{ destroy: () => void } | null>(null);
  const pollingRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Derived: year applications and enrolled students. Inactive apps
  // (`isActive=false`) are excluded — when a parent removes a student
  // from the year, that student shouldn't auto-preload back into the
  // registration roster.
  const yearApps: Application[] = applicationsData
    ? (applicationsData as Application[]).filter(
        (a) =>
          a.registration_school_years_id === yearId &&
          a.isActive !== false
      )
    : [];

  const enrolledStudents: Student[] = (() => {
    if (!studentsData) return [];
    const enrolledIds = new Set(yearApps.map((a) => a.registration_students_id));
    return (studentsData as Student[]).filter((s) => enrolledIds.has(s.id));
  })();

  // Seed the phone drafts from each loaded student's saved value. Runs
  // when the students SWR data changes; the `=== undefined` guard keeps it
  // idempotent so a revalidation (or a save round-trip) never clobbers a
  // value the parent is actively editing.
  useEffect(() => {
    if (!studentsData) return;
    setStudentPhoneDraft((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const s of studentsData as Student[]) {
        if (next[s.id] === undefined) {
          next[s.id] = s.student_phone ?? "";
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [studentsData]);

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
          body: JSON.stringify({
          type: "liability_waiver",
          applicationId: app.id,
          yearId: app.registration_school_years_id,
        }),
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
        body: JSON.stringify({
          type: "liability_waiver",
          applicationId: app.id,
          yearId: app.registration_school_years_id,
        }),
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
            liability_waiver_sent_at: new Date().toISOString(),
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
          `/api/pandadoc/status?documentId=${documentId}&applicationId=${app?.id ?? 0}&type=liability_waiver&yearId=${app?.registration_school_years_id ?? 0}`
        );
        if (!res.ok) {
          delay = Math.min(delay * 1.5, maxDelay);
          pollingRef.current = setTimeout(poll, delay);
          return;
        }
        const data = await res.json();
        // PandaDoc envelope was deleted (admin trashed it). Stop the
        // polling loop and drop the signing session so the iframe
        // goes away. The next sign attempt will self-heal via the
        // create route.
        if (data.status === "missing") {
          pollingRef.current = null;
          setSigningSession(null);
          setSigningStudentId(null);
          toast.error(
            "This document is no longer available. Please try again to start fresh."
          );
          return;
        }
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
      // Reset the loaded flag every time the embed re-initializes so
      // the overlay re-engages until PandaDoc fires `document.loaded`
      // (or `document.exception`, the failure short-circuit).
      setDocLoaded(false);
      signing
        .on("document.loaded", () => {
          setDocLoaded(true);
        })
        .on("document.exception", () => {
          setDocLoaded(true);
        })
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
      //
      // We now pre-select **every** active student (not just the ones with a
      // saved registration row) so the parent doesn't have to manually
      // click "Add Student" for each one — every isActive=true app
      // means that student needs a registration packet.
      const existingIds = new Set<number>();
      enrolledStudents.forEach((s) => {
        existingIds.add(s.id);
      });

      setRegistrations((prev) => {
        const next = { ...prev };
        enrolledStudents.forEach((s, i) => {
          if (!next[s.id]) {
            const loaded = results[i];
            if (loaded) {
              // Backfill year/type on rows that predate the schema change so
              // the next save writes them back up. No-op once migrated data.
              next[s.id] = {
                ...loaded,
                registration_school_years_id:
                  loaded.registration_school_years_id || yearId,
                registration_type_id:
                  loaded.registration_type_id || registrationTypeId,
              };
            } else {
              next[s.id] = emptyRegistration(s.id, yearId, registrationTypeId);
            }
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
      const reg = next[studentId] ?? emptyRegistration(studentId, yearId, registrationTypeId);
      next[studentId] = { ...reg, [field]: value };
      return next;
    });
  }

  // -------------------------------------------------------------------------
  // Student document uploads — docs live on the evergreen `registration_students`
  // row as arrays, so each add/remove hits the student PATCH endpoint
  // directly and the students SWR cache is revalidated.
  // -------------------------------------------------------------------------

  async function patchStudentDocs(
    studentId: number,
    field: StudentDocField,
    nextArray: FileMetadata[]
  ) {
    // Optimistic update — patch the students SWR cache immediately so the
    // newly-uploaded file shows up in the uploaded-files list the same tick
    // the upload finishes. Without this, the DocumentUpload component
    // flickers: pendingFiles clears → brief empty gap → server revalidation
    // finally catches up and the green "uploaded" row appears.
    swrMutate(
      "/api/students",
      (current: Student[] | undefined) => {
        if (!Array.isArray(current)) return current;
        return current.map((s) =>
          s.id === studentId ? { ...s, [field]: nextArray } : s
        );
      },
      { revalidate: false }
    );

    try {
      const res = await fetch(`/api/students/${studentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: nextArray }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Save failed (${res.status})`);
      }
      // Confirm with the server's copy (replaces the optimistic value).
      await mutateStudents();
    } catch (err) {
      console.error(`Failed to save ${field} for student ${studentId}:`, err);
      toast.error("Failed to save document. Please try again.");
      // Revert — pull the true value back from Xano.
      await mutateStudents();
    }
  }

  function handleStudentDocUpload(
    studentId: number,
    field: StudentDocField,
    meta: FileMetadata
  ) {
    const student = enrolledStudents.find((s) => s.id === studentId);
    const current = (student?.[field] as FileMetadata[] | undefined) ?? [];
    patchStudentDocs(studentId, field, [...current, meta]);
  }

  function handleStudentDocRemove(
    studentId: number,
    field: StudentDocField,
    index: number
  ) {
    const student = enrolledStudents.find((s) => s.id === studentId);
    const current = (student?.[field] as FileMetadata[] | undefined) ?? [];
    patchStudentDocs(
      studentId,
      field,
      current.filter((_, i) => i !== index)
    );
  }

  // Persist a student's phone to the evergreen `registration_students`
  // row. Called on blur (and again from `handleSaveAll`); no-ops when the
  // draft already matches the saved value so blur + section-save don't
  // double-write. Optimistically patches the students SWR cache so the
  // value sticks across a revalidation, then confirms with the server copy.
  async function persistStudentPhone(studentId: number) {
    const digits = studentPhoneDraftRef.current[studentId] ?? "";
    const student = enrolledStudents.find((s) => s.id === studentId);
    if ((student?.student_phone ?? "") === digits) return;
    swrMutate(
      "/api/students",
      (current: Student[] | undefined) =>
        Array.isArray(current)
          ? current.map((s) =>
              s.id === studentId ? { ...s, student_phone: digits } : s
            )
          : current,
      { revalidate: false }
    );
    try {
      const res = await fetch(`/api/students/${studentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ student_phone: digits }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Save failed (${res.status})`);
      }
      await mutateStudents();
    } catch (err) {
      console.error(`Failed to save phone for student ${studentId}:`, err);
      toast.error("Failed to save phone number. Please try again.");
      await mutateStudents();
    }
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

      // 3. Student registrations: PATCH existing packets only.
      //
      // Packet creation lives on the admin-side accept cascade
      // (`/api/admin/family-progress` + `/api/admin/applications/[id]`)
      // — when admin accepts a family or a single application, every
      // active student's packet is resolve-or-created server-side
      // with the billing + SUFS columns mirrored from the
      // application row. By the time a parent reaches this form,
      // each active student already has a packet, so this client
      // only needs to PATCH.
      //
      // A missing `reg.id` here means either (a) the parent loaded
      // this page before acceptance landed (shouldn't happen — the
      // route gate hides this view pre-acceptance), or (b) the
      // server-side cascade failed for that student. We log loudly
      // so the failure surfaces instead of silently re-creating a
      // duplicate packet, but skip the save for that row.
      for (const reg of Object.values(registrations)) {
        if (!reg.id) {
          console.error(
            `Skipping registration save for student ${reg.registration_students_id}: no packet id on file. Acceptance cascade should have created the row server-side.`
          );
          continue;
        }
        const payload = { ...reg };
        delete (payload as Record<string, unknown>)["id"];
        promises.push(
          fetch(`/api/student-registration/${reg.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        );
      }

      // 4. Student phone — evergreen on `registration_students`. PATCH any
      //    selected student whose draft differs from the saved value so
      //    "Complete Section" persists a number the parent typed without
      //    blurring out of the field first. Idempotent with the on-blur
      //    save (`persistStudentPhone`): both skip when unchanged.
      for (const student of enrolledStudents.filter((s) =>
        selectedStudentIds.has(s.id)
      )) {
        const digits = studentPhoneDraftRef.current[student.id];
        if (digits === undefined) continue;
        if ((student.student_phone ?? "") === digits) continue;
        promises.push(
          fetch(`/api/students/${student.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ student_phone: digits }),
          })
        );
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

      // Refresh emergency contacts ONLY to map temp IDs onto their
      // real server-assigned IDs for newly-persisted (`_isNew`)
      // contacts. Do NOT replace the whole local list with the
      // server's response — that races mid-typing edits: the parent
      // types "abc", autosave fires with "ab" already inflight, the
      // server responds with "ab", and the wholesale state replace
      // wipes the "c" the parent just added. The bug shows up as
      // characters getting "deleted" while the user types.
      //
      // We match newly-persisted server rows to local `_isNew` rows
      // by index of contacts the server has that we don't recognize
      // locally. Already-persisted contacts (real id, in our local
      // map) keep their typed-but-not-yet-saved values intact.
      const ecRes = await fetch("/api/emergency-contacts");
      if (ecRes.ok) {
        const serverContacts: EmergencyContact[] = await ecRes.json();
        setEmergencyContacts((prev) => {
          const persistedLocalIds = new Set(
            prev.filter((c) => !c._isNew).map((c) => c.id)
          );
          const newlyPersisted = serverContacts.filter(
            (sc) => !persistedLocalIds.has(sc.id)
          );
          let nextIdx = 0;
          return prev.map((c) => {
            if (!c._isNew) return c;
            const match = newlyPersisted[nextIdx];
            nextIdx += 1;
            return match ? { ...c, id: match.id, _isNew: false } : c;
          });
        });
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

  // Check if every section of the page is complete — parents, selected
  // students, and at least one emergency contact. Previously this missed
  // parent completion, which let the Complete button pass validation with
  // required parent fields still empty (the downstream PATCH would then
  // silently reject at Xano).
  const allParentsComplete =
    parents.length > 0 && parents.every((p) => isParentComplete(p));
  const allStudentsComplete =
    selectedStudentIds.size > 0 &&
    [...selectedStudentIds].every((id) => {
      const reg = registrations[id];
      const student = enrolledStudents.find((s) => s.id === id);
      return reg && isRegistrationComplete(reg, student);
    });
  const allEmergencyContactsComplete =
    emergencyContacts.length > 0 &&
    emergencyContacts.every((c) => isEmergencyContactComplete(c));
  const allRegistrationsComplete =
    allParentsComplete && allStudentsComplete && allEmergencyContactsComplete;

  const handleCompleteRef = useRef<() => Promise<void>>(() => Promise.resolve());
  handleCompleteRef.current = async () => {
    if (!allRegistrationsComplete) {
      setShowValidation(true);
      // Surface the specific section that's blocking so the parent knows
      // where to look. Without this, users who have complete students but
      // incomplete parents see "fill out all required fields" and can't
      // tell which cards need attention.
      const blocker = !allParentsComplete
        ? "parent / guardian"
        : !allStudentsComplete
          ? "student"
          : "emergency contact";
      toast.error(
        `Please complete every required field in each ${blocker} card before continuing.`
      );
      throw new Error("Validation failed");
    }
    // Fire the bool flip and the full-save in parallel. `setRegSection`
    // does an optimistic SWR mutate internally, so `regProgress.isRegistration`
    // flips to true on the same tick — the button transitions to the
    // "Section Completed" state immediately, instead of waiting for the
    // multi-request save to complete. If the save fails we roll the latch
    // back so we don't leave the section falsely marked complete.
    const [saveResult, latchResult] = await Promise.allSettled([
      handleSaveAllRef.current(),
      setRegSection("isRegistration", true),
    ]);

    if (saveResult.status === "rejected") {
      // Revert the optimistic latch so the UI matches the server.
      try {
        await setRegSection("isRegistration", false);
      } catch {
        /* best-effort revert */
      }
      throw saveResult.reason;
    }

    if (latchResult.status === "rejected") {
      console.error("Failed to latch isRegistration:", latchResult.reason);
      toast.error("Saved, but couldn't mark the section complete. Please try again.");
      throw latchResult.reason;
    }

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
    return reg ? isRegistrationComplete(reg, s) : false;
  });
  const allCards = [...parentCards, ...ecCards, ...studentCards];
  const completedCards = allCards.filter(Boolean).length;
  const totalCards = allCards.length;
  // Lock state is the bridge row's bool — single source of truth, so the
  // sidenav + this button always agree and the state survives reloads.
  const registrationLocked = regProgress?.isRegistration === true;

  useEffect(() => {
    if (loading || !studentsData || !applicationsData) return;
    if (registrationLocked) {
      updateSaveOptions({
        completed: true,
        completedLabel: "Registration Section Completed",
        onUnlock: () => {
          setRegSection("isRegistration", false).catch(() => {
            toast.error("Failed to unlock — please try again.");
          });
        },
      });
    } else {
      // The top-bar autosave pill already shows "Saving…" on every field
      // change, so the Complete Registration button stays static here —
      // we don't flash "Saving…" on it during the per-keystroke autosave.
      updateSaveOptions({
        label: `Complete Registration`,
        disabled: false,
        completed: false,
        isUnlocked: false,
      });
    }
  }, [loading, studentsData, applicationsData, completedCards, totalCards, registrationLocked, updateSaveOptions]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading || !studentsData || !applicationsData) {
    return (
      <div className="flex flex-1 flex-col gap-6 p-6 mx-auto w-full max-w-4xl">
        <div>
          <div className="flex items-center justify-between gap-3 pb-3 border-b">
            <Skeleton className="h-3 w-20" />
          </div>
          <Skeleton className="h-8 w-3/4 mt-4" />
          <Skeleton className="h-4 w-2/3 mt-3" />
        </div>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-lg border p-6">
            <div className="flex items-center gap-3 mb-5">
              <Skeleton className="size-10 rounded-full" />
              <Skeleton className="h-5 w-44" />
            </div>
            <div className="space-y-4">
              {Array.from({ length: 4 }).map((_, j) => (
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
              return (
                <Card key={parent.id} className="overflow-hidden gap-0 py-0 ring-0 border">
                  <CardHeader className="border-b py-3 !pb-3">
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
                        <InviteStatusBadge status={parent.invite_status} />
                        <ResendInviteButton
                          parentId={parent.id}
                          status={parent.invite_status}
                          size="xs"
                        />
                        <StatusIcon complete={isParentComplete(parent)} />
                      </div>
                    </div>
                  </CardHeader>
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
                                <PhoneInput
                                  className={!parent.phone ? "border-2 border-red-400" : ""}
                                  value={parent.phone || ""}
                                  onChange={(d) => updateParentLocal(parent.id, "phone", d)}
                                />
                              </Field>
                              <Field>
                                <FieldLabel className="text-xs">Relationship</FieldLabel>
                                <Input
                                  className={!parent.relationship ? "border-2 border-red-400" : ""}
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
                                    className={!parent.address_line_1 ? "border-2 border-red-400" : ""}
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
                                    className={!parent.city ? "border-2 border-red-400" : ""}
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
                                    className={!parent.zipcode ? "border-2 border-red-400" : ""}
                                    placeholder="33701"
                                    value={parent.zipcode || ""}
                                    onChange={(e) => updateParentLocal(parent.id, "zipcode", e.target.value)}
                                  />
                                </Field>
                              </div>
                            </div>
                          </section>
                        </CardContent>
                </Card>
              );
            })}

            {/* Invite a secondary parent/guardian. Sends a Clerk invitation
                so the other parent can create an account, link to this
                family, and fill in their own details. */}
            <Button
              type="button"
              variant="outline"
              className="w-full bg-white"
              onClick={() => {
                setInviteError("");
                setInviteSheetOpen(true);
              }}
            >
              <Plus className="size-4 mr-1.5" />
              Add Parent / Guardian
            </Button>

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
              return (
                <Card key={ec.id} className="overflow-hidden gap-0 py-0 ring-0 border">
                  <CardHeader className="border-b py-3 !pb-3">
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
                      </div>
                    </div>
                  </CardHeader>
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
                                  className={!ec.first_name ? "border-2 border-red-400" : ""}
                                  placeholder="First name"
                                  value={ec.first_name || ""}
                                  autoComplete="given-name"
                                  onChange={(e) => updateContactLocal(ec.id, "first_name", e.target.value)}
                                />
                              </Field>
                              <Field>
                                <FieldLabel className="text-xs">Last Name</FieldLabel>
                                <Input
                                  className={!ec.last_name ? "border-2 border-red-400" : ""}
                                  placeholder="Last name"
                                  value={ec.last_name || ""}
                                  autoComplete="family-name"
                                  onChange={(e) => updateContactLocal(ec.id, "last_name", e.target.value)}
                                />
                              </Field>
                              <Field>
                                <FieldLabel className="text-xs">Relationship</FieldLabel>
                                <Input
                                  className={!ec.relationship ? "border-2 border-red-400" : ""}
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
                                  className={showValidation && !ec.email ? "border-2 border-red-400" : ""}
                                  placeholder="email@example.com"
                                  value={ec.email || ""}
                                  autoComplete="email"
                                  onChange={(e) => updateContactLocal(ec.id, "email", e.target.value)}
                                />
                              </Field>
                              <Field>
                                <FieldLabel className="text-xs">Phone</FieldLabel>
                                <PhoneInput
                                  className={!ec.phone ? "border-2 border-red-400" : ""}
                                  value={ec.phone || ""}
                                  autoComplete="tel"
                                  onChange={(d) => updateContactLocal(ec.id, "phone", d)}
                                />
                              </Field>
                            </div>
                          </section>

                          <Separator />

                          {/* Address — `autoComplete` tokens unlock the
                              browser's saved-address dropdown so parents
                              don't retype the same address on every
                              year's renewal. Standard tokens map to
                              the OS-level address book on most
                              devices. */}
                          <section>
                            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                              Address
                            </h3>
                            <div className="space-y-4">
                              <div className="grid gap-4 grid-cols-1 sm:grid-cols-[2fr_1fr]">
                                <Field>
                                  <FieldLabel className="text-xs">Street Address <span className="text-red-400">*</span></FieldLabel>
                                  <Input
                                    className={showValidation && !ec.address_line_1 ? "border-2 border-red-400" : ""}
                                    placeholder="123 Main Street"
                                    value={ec.address_line_1 || ""}
                                    autoComplete="address-line1"
                                    onChange={(e) => updateContactLocal(ec.id, "address_line_1", e.target.value)}
                                  />
                                </Field>
                                <Field>
                                  <FieldLabel className="text-xs">Apt, Suite, etc.</FieldLabel>
                                  <Input
                                    placeholder="Apt 4B"
                                    value={ec.address_line_2 || ""}
                                    autoComplete="address-line2"
                                    onChange={(e) => updateContactLocal(ec.id, "address_line_2", e.target.value)}
                                  />
                                </Field>
                              </div>
                              <div className="grid gap-4 grid-cols-1 sm:grid-cols-[2fr_1fr_1fr]">
                                <Field>
                                  <FieldLabel className="text-xs">City <span className="text-red-400">*</span></FieldLabel>
                                  <Input
                                    className={showValidation && !ec.city ? "border-2 border-red-400" : ""}
                                    placeholder="St. Petersburg"
                                    value={ec.city || ""}
                                    autoComplete="address-level2"
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
                                    className={showValidation && !ec.zipcode ? "border-2 border-red-400" : ""}
                                    placeholder="33701"
                                    value={ec.zipcode || ""}
                                    autoComplete="postal-code"
                                    onChange={(e) => updateContactLocal(ec.id, "zipcode", e.target.value)}
                                  />
                                </Field>
                              </div>
                            </div>
                          </section>
                        </CardContent>
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
                const reg = registrations[student.id] ?? emptyRegistration(student.id, yearId, registrationTypeId);

                return (
                  <Card key={student.id} className="overflow-hidden gap-0 py-0 ring-0 border">
                    <CardHeader className="border-b py-3 !pb-3">
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
                          <StatusIcon complete={isRegistrationComplete(reg, student)} />
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
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-6 py-5 bg-white dark:bg-background">
                            {/* Student Information — evergreen contact info
                                on the student record (not the per-year
                                packet). Optional; persists on blur. */}
                            <section>
                              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                                Student Information
                              </h3>
                              <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
                                <Field>
                                  <FieldLabel className="text-xs">Student Phone</FieldLabel>
                                  <PhoneInput
                                    value={studentPhoneDraft[student.id] ?? ""}
                                    onChange={(d) =>
                                      setStudentPhoneDraft((prev) => ({
                                        ...prev,
                                        [student.id]: d,
                                      }))
                                    }
                                    onValidate={() => void persistStudentPhone(student.id)}
                                  />
                                </Field>
                              </div>
                            </section>

                            <Separator />

                            {/* Uniform & Activities */}
                            <section>
                              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                                Uniform &amp; Activities
                              </h3>
                              <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
                                <Field>
                                  <FieldLabel className="text-xs">Shirt Size <span className="text-red-400">*</span></FieldLabel>
                                  <OptionSelect
                                    options={toOptions(SIZES)}
                                    value={reg.shirt_size || ""}
                                    onChange={(v) => updateRegistration(student.id, "shirt_size", v)}
                                    placeholder="Select size"
                                    invalid={showValidation && !reg.shirt_size}
                                  />
                                </Field>
                                <Field>
                                  <FieldLabel className="text-xs">Pant Size <span className="text-red-400">*</span></FieldLabel>
                                  <OptionSelect
                                    options={toOptions(SIZES)}
                                    value={reg.pant_size || ""}
                                    onChange={(v) => updateRegistration(student.id, "pant_size", v)}
                                    placeholder="Select size"
                                    invalid={showValidation && !reg.pant_size}
                                  />
                                </Field>
                                <Field>
                                  <FieldLabel className="text-xs">Swim Level <span className="text-red-400">*</span></FieldLabel>
                                  <OptionSelect
                                    options={toOptions(SWIM_LEVELS)}
                                    value={reg.swim_level || ""}
                                    onChange={(v) => updateRegistration(student.id, "swim_level", v)}
                                    placeholder="Select level"
                                    invalid={showValidation && !reg.swim_level}
                                  />
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
                                {REQUIRED_DOCUMENTS.map(({ key, label }) => {
                                  const currentFiles =
                                    (student[key] as FileMetadata[] | undefined) ?? [];
                                  const guide = DOC_GUIDES[key];
                                  return (
                                    <Field key={key}>
                                      <FieldLabel className="text-xs flex items-center">
                                        <span>
                                          {label} <span className="text-red-400">*</span>
                                        </span>
                                        {guide && <DocumentGuide guide={guide} />}
                                      </FieldLabel>
                                      <DocumentUpload
                                        label={`Upload ${label}`}
                                        files={currentFiles}
                                        onUploaded={(meta) => handleStudentDocUpload(student.id, key, meta)}
                                        onRemoved={(idx) => handleStudentDocRemove(student.id, key, idx)}
                                        invalid={showValidation && !hasAnyStudentDoc(student, key)}
                                      />
                                    </Field>
                                  );
                                })}
                              </div>
                            </section>

                            <Separator />

                            {/* Optional Documents */}
                            <section>
                              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                                Optional Documents
                              </h3>
                              <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
                                {OPTIONAL_DOCUMENTS.map(({ key, label }) => {
                                  const currentFiles =
                                    (student[key] as FileMetadata[] | undefined) ?? [];
                                  return (
                                    <Field key={key}>
                                      <FieldLabel className="text-xs">{label}</FieldLabel>
                                      <DocumentUpload
                                        label={`Upload ${label}`}
                                        files={currentFiles}
                                        onUploaded={(meta) => handleStudentDocUpload(student.id, key, meta)}
                                        onRemoved={(idx) => handleStudentDocRemove(student.id, key, idx)}
                                      />
                                    </Field>
                                  );
                                })}
                              </div>
                              {/* IEP description only shows up after a parent
                                  has actually uploaded an IEP document — no
                                  reason to prompt for a description when
                                  the form isn't on file. */}
                              {hasAnyStudentDoc(student, "iep") && (
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
                              )}
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
                                      className={showValidation && !reg.allergies ? "border-2 border-red-400" : ""}
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
                                      className={showValidation && !reg.dietary_restrictions ? "border-2 border-red-400" : ""}
                                      rows={2}
                                    />
                                  </Field>
                                  <Field>
                                    <FieldLabel className="text-xs">Prescription Medications <span className="text-red-400">*</span></FieldLabel>
                                    <Textarea
                                      placeholder="List any prescription medications..."
                                      value={reg.prescription_medications || ""}
                                      onChange={(e) => updateRegistration(student.id, "prescription_medications", e.target.value)}
                                      className={showValidation && !reg.prescription_medications ? "border-2 border-red-400" : ""}
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
                                      className={showValidation && !reg.health_conditions ? "border-2 border-red-400" : ""}
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
                                      className={showValidation && !reg.vision_impairments ? "border-2 border-red-400" : ""}
                                    />
                                  </Field>
                                  <Field>
                                    <FieldLabel className="text-xs">Hearing Impairments <span className="text-red-400">*</span></FieldLabel>
                                    <Input
                                      placeholder="Describe any hearing impairments..."
                                      value={reg.hearing_impairments || ""}
                                      onChange={(e) => updateRegistration(student.id, "hearing_impairments", e.target.value)}
                                      className={showValidation && !reg.hearing_impairments ? "border-2 border-red-400" : ""}
                                    />
                                  </Field>
                                </div>

                                <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
                                  <Field>
                                    <FieldLabel className="text-xs">Permission for Acetaminophen <span className="text-red-400">*</span></FieldLabel>
                                    <OptionSelect
                                      options={toOptions(YES_NO)}
                                      value={reg.permission_for_acetaminophen || ""}
                                      onChange={(v) => updateRegistration(student.id, "permission_for_acetaminophen", v)}
                                      placeholder="Select"
                                      invalid={showValidation && !reg.permission_for_acetaminophen}
                                    />
                                  </Field>
                                  <Field>
                                    <FieldLabel className="text-xs">Interested in Counseling Services <span className="text-red-400">*</span></FieldLabel>
                                    <OptionSelect
                                      options={toOptions(YES_NO_MAYBE)}
                                      value={reg.interested_in_counseling_services || ""}
                                      onChange={(v) => updateRegistration(student.id, "interested_in_counseling_services", v)}
                                      placeholder="Select"
                                      invalid={showValidation && !reg.interested_in_counseling_services}
                                    />
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
                                          className={showValidation && reg.carry_epi_pen && !reg.epipen_explainer ? "border-2 border-red-400" : ""}
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
                                        <OptionSelect
                                          options={toOptions(MEDICAID_PROVIDERS)}
                                          value={reg.medicaid_provider || ""}
                                          onChange={(v) => updateRegistration(student.id, "medicaid_provider", v)}
                                          placeholder="Select plan"
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
                                    className={showValidation && !reg.other_adults_approved_for_pickup ? "border-2 border-red-400" : ""}
                                    rows={3}
                                  />
                                </Field>
                                <Field>
                                  <FieldLabel className="text-xs">Prohibited Adults <span className="text-red-400">*</span></FieldLabel>
                                  <Textarea
                                    placeholder="List any adults prohibited from picking up the student..."
                                    value={reg.prohibited_adults || ""}
                                    onChange={(e) => updateRegistration(student.id, "prohibited_adults", e.target.value)}
                                    className={showValidation && !reg.prohibited_adults ? "border-2 border-red-400" : ""}
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
                              <div
                                className={`rounded-md border bg-white p-4 ${
                                  showValidation && reg.liability_waiver_status !== "completed"
                                    ? "border-2 border-red-400"
                                    : "border-input"
                                }`}
                              >
                                {(() => {
                                  const waiverStatus = reg.liability_waiver_status;
                                  const waiverSent = !!reg.liability_waiver_pandadoc_id;
                                  const isLoading = signingLoading === student.id;

                                  if (waiverStatus === "completed") {
                                    // Build the download URL from the proxy
                                    // route — authorizes the fetch against
                                    // the family and streams the signed PDF.
                                    const docId = reg.liability_waiver_pandadoc_id;
                                    const app = yearApps.find(
                                      (a) => a.registration_students_id === student.id
                                    );
                                    const downloadUrl =
                                      docId && app
                                        ? `/api/pandadoc/download?documentId=${docId}&applicationId=${app.id}&yearId=${app.registration_school_years_id}`
                                        : null;
                                    return (
                                      <div className="flex items-center justify-between gap-3">
                                        <div className="flex items-center gap-3">
                                          <CheckCircle2 className="size-5 text-green-600 shrink-0" />
                                          <div>
                                            <p className="text-sm font-medium">Liability waiver signed</p>
                                            <p className="text-xs text-muted-foreground">This document has been signed and completed.</p>
                                          </div>
                                        </div>
                                        {downloadUrl && (
                                          <Button
                                            variant="outline"
                                            size="sm"
                                            className="shrink-0 bg-white"
                                            onClick={() => window.open(downloadUrl, "_blank")}
                                          >
                                            Download PDF
                                          </Button>
                                        )}
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

      {/* Add Parent / Guardian Sheet — mirrors the invite flow on /family so
          parents can add a secondary contact without leaving this page. */}
      <Sheet open={inviteSheetOpen} onOpenChange={setInviteSheetOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Add Parent / Guardian</SheetTitle>
            <SheetDescription>
              They&apos;ll receive an email to create their own account and
              join your family.
            </SheetDescription>
          </SheetHeader>
          <form onSubmit={handleInvite} className="flex flex-col gap-4 p-4">
            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel>First Name</FieldLabel>
                <Input
                  value={inviteFirstName}
                  onChange={(e) => setInviteFirstName(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel>Last Name</FieldLabel>
                <Input
                  value={inviteLastName}
                  onChange={(e) => setInviteLastName(e.target.value)}
                />
              </Field>
            </div>
            <Field>
              <FieldLabel>Email</FieldLabel>
              <Input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                required
              />
            </Field>
            <Field>
              <FieldLabel>Relationship</FieldLabel>
              <Input
                placeholder="e.g. Mother, Father, Guardian"
                value={inviteRelationship}
                onChange={(e) => setInviteRelationship(e.target.value)}
              />
            </Field>
            {inviteError && (
              <p className="text-sm text-red-600 dark:text-red-400">
                {inviteError}
              </p>
            )}
            <Button type="submit" disabled={inviting} className="mt-2">
              {inviting ? "Sending..." : "Send Invitation"}
            </Button>
          </form>
        </SheetContent>
      </Sheet>

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
                          next[student.id] = emptyRegistration(student.id, yearId, registrationTypeId);
                        }
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

      {/* Full-screen blocking overlay during waiver prep. Covers two
          phases the parent shouldn't be able to click out of:
            1. signingLoading is set → API is creating + sending the
               PandaDoc envelope (can take 5-30s on a fresh doc)
            2. signingSession is set but the embed hasn't fired
               `document.loaded` yet → iframe is mounting / fetching
          Once `docLoaded` flips true, the dialog content takes over
          and this overlay disappears.
          Portaled to document.body so it shares the same stacking
          level as the shadcn Dialog's own portal — without the
          portal, the overlay would render inside the page's
          stacking context and the Dialog (which portals to body)
          would paint above it, regardless of z-index. */}
      {(signingLoading !== null || (signingSession !== null && !docLoaded)) &&
        typeof window !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95 backdrop-blur-sm"
            role="status"
            aria-live="polite"
            aria-label="Preparing liability waiver"
          >
            <div className="flex flex-col items-center gap-4 px-6 text-center">
              <Loader2 className="size-10 animate-spin text-primary" />
              <div className="space-y-1">
                <p className="text-base font-medium">
                  Preparing your liability waiver…
                </p>
                <p className="text-sm text-muted-foreground max-w-sm">
                  This usually takes a few seconds. Please don&apos;t close
                  this tab.
                </p>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

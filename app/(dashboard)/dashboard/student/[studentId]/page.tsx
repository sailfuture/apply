"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { toast } from "sonner";
import { useStudents, useApplications, useSchoolYears, mutateStudents } from "@/hooks/use-api";
import { convertHeicToJpeg } from "@/lib/heic";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  ExternalLink,
  FileText,
  FileUp,
  Loader2,
  X,
} from "lucide-react";
import { DashboardPageHeader } from "@/components/dashboard-page-header";
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

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface FileMetadata {
  path?: string;
  name?: string;
  url?: string;
  [key: string]: unknown;
}

interface Student {
  id: number;
  first_name: string;
  last_name: string;
  date_of_birth?: string;
  gender?: string;
  ethnicity?: string;
  birth_certificate?: FileMetadata[];
  school_health_form?: FileMetadata[];
  transcripts?: FileMetadata[];
  immunization_forms?: FileMetadata[];
  passport?: FileMetadata[];
  student_state_id?: FileMetadata[];
  iep?: FileMetadata[];
  ssn_card?: FileMetadata[];
}

interface Application {
  id: number;
  registration_students_id: number;
  registration_school_years_id: number;
  current_grade?: string;
  last_grade_completed?: string;
  current_previous_school?: string;
  is_bus_transportation?: boolean;
  bus_stop?: string;
  describe_student_strengths?: string;
  describe_student_opportunities_for_growth?: string;
  sufs_type?: string;
  sufs_status?: string;
}

interface RegistrationPacket {
  id: number;
  registration_students_id: number;
  registration_school_years_id: number;
  shirt_size?: string;
  pant_size?: string;
  swim_level?: string;
  allergies?: string;
  dietary_restrictions?: string;
  prescription_medications?: string;
  health_conditions?: string;
  vision_impairments?: string;
  hearing_impairments?: string;
  is_student_on_medicaid?: boolean;
  medicaid_provider?: string;
  medicaid_number?: number;
  carry_epi_pen?: boolean;
  epipen_explainer?: string;
  permission_for_acetaminophen?: string;
  interested_in_counseling_services?: string;
  additional_health_information?: string;
  other_adults_approved_for_pickup?: string;
  prohibited_adults?: string;
  liability_waiver_status?: string;
  registrationConfirmed?: boolean;
}

type DocField = keyof Pick<
  Student,
  | "birth_certificate"
  | "school_health_form"
  | "transcripts"
  | "immunization_forms"
  | "iep"
  | "ssn_card"
  | "passport"
  | "student_state_id"
>;

const DOC_LABELS: { key: DocField; label: string; required: boolean }[] = [
  { key: "birth_certificate", label: "Birth Certificate", required: true },
  { key: "school_health_form", label: "School Health Form", required: true },
  { key: "transcripts", label: "Transcripts", required: true },
  { key: "immunization_forms", label: "Immunization Forms", required: true },
  { key: "iep", label: "IEP", required: false },
  { key: "ssn_card", label: "SSN Card", required: false },
  { key: "passport", label: "Passport", required: false },
  { key: "student_state_id", label: "Student State ID", required: false },
];

const xanoBase =
  process.env.NEXT_PUBLIC_XANO_BASE ?? "https://xsc3-mvx7-r86m.n7e.xano.io";

function formatDob(dob?: string): string {
  if (!dob) return "—";
  return new Date(dob + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function yesNo(b: boolean | undefined): string {
  if (b === true) return "Yes";
  if (b === false) return "No";
  return "—";
}

function val(s: string | number | null | undefined): string {
  if (s === null || s === undefined || s === "") return "—";
  return String(s);
}

/**
 * Read-only student detail page for enrolled families. Aggregates data from:
 *   - registration_students (basic info + document arrays)
 *   - registration_application for the year (grade, transport, scholarships)
 *   - registration_student_registration packet for the year (health, safety)
 *
 * Documents are uploadable from this page so a parent can backfill missing
 * required files after submission. Other fields are read-only and route
 * change requests through email.
 */
export default function StudentDetailPage() {
  const params = useParams();
  const studentId = Number(params.studentId);
  const searchParams = useSearchParams();
  const yearIdParam = searchParams.get("yearId");
  const yearId = yearIdParam ? Number(yearIdParam) : null;

  const { mutate: swrMutate } = useSWRConfig();
  const { data: studentsData } = useStudents();
  const { data: applicationsData } = useApplications();

  // The student object lives in the family-wide students cache.
  const student: Student | undefined = useMemo(() => {
    return (Array.isArray(studentsData) ? studentsData : []).find(
      (s: Student) => s.id === studentId
    );
  }, [studentsData, studentId]);

  // Application row for this (student, year).
  const application: Application | undefined = useMemo(() => {
    if (!applicationsData || yearId === null) return undefined;
    return (applicationsData as Application[]).find(
      (a) =>
        a.registration_students_id === studentId &&
        a.registration_school_years_id === yearId
    );
  }, [applicationsData, studentId, yearId]);

  // Packet row — fetched separately because it isn't in any global SWR cache.
  const { data: packet } = useSWR<RegistrationPacket | null>(
    studentId ? `/api/student-registration?studentId=${studentId}` : null,
    fetcher
  );

  // School year name for breadcrumb context.
  const { data: yearsData } = useSchoolYears();
  const yearName = useMemo(() => {
    if (!yearId || !yearsData) return null;
    return (
      (yearsData as { id: number; year_name: string }[]).find(
        (y) => y.id === yearId
      )?.year_name ?? null
    );
  }, [yearId, yearsData]);

  // Skeleton the whole page until the student record, the year's
  // application row, AND the registration packet have all loaded. Gating
  // on all three — rather than rendering each section the moment its own
  // fetch resolves — stops the page popping in piecemeal (personal info
  // first, then health/pickup/apparel a beat later as the packet arrives).
  // `packet` is `undefined` only while in flight; it settles to `null` for
  // students with no packet, so this still resolves for them.
  const loading =
    !studentsData || !applicationsData || packet === undefined || !student;
  if (loading) {
    return <StudentDetailSkeleton />;
  }

  const dashboardHref = yearId ? `/dashboard?yearId=${yearId}` : "/dashboard";

  const requiredDocs = DOC_LABELS.filter((d) => d.required);
  const optionalDocs = DOC_LABELS.filter((d) => !d.required);

  return (
    <div className="flex flex-1 flex-col gap-6 p-6 mx-auto w-full max-w-4xl">
      <DashboardPageHeader
        backHref={dashboardHref}
        backLabel="Back to Dashboard"
        breadcrumb={[
          { label: "Dashboard", href: dashboardHref },
          ...(yearName ? [{ label: yearName, href: dashboardHref }] : []),
          { label: `${student.first_name} ${student.last_name}` },
        ]}
        title={`${student.first_name} ${student.last_name}`}
        backRowAction={
          <Button asChild variant="outline" size="sm" className="bg-white">
            <a
              href={`mailto:tward@sailfuture.org?subject=${encodeURIComponent(
                `Update request — ${student.first_name} ${student.last_name}`
              )}`}
            >
              Request a change to this student
            </a>
          </Button>
        }
      />

      {/* Student info table */}
      <div>
        <h2 className="text-sm font-semibold mb-3">Personal Information</h2>
        <DetailTable
          rows={[
            ["Date of Birth", formatDob(student.date_of_birth)],
            ["Gender", val(student.gender)],
            ["Ethnicity", val(student.ethnicity)],
          ]}
        />
      </div>

      {/* Application info — grade + school context for the year */}
      {application ? (
        <div>
          <h2 className="text-sm font-semibold mb-3">Academic Information</h2>
          <DetailTable
            rows={[
              ["Incoming Grade", val(application.current_grade)],
              ["Current Grade", val(application.last_grade_completed)],
              ["Previous School", val(application.current_previous_school)],
              [
                "Bus Transportation",
                application.is_bus_transportation
                  ? `Yes${application.bus_stop ? ` · ${application.bus_stop}` : ""}`
                  : "No",
              ],
              ["SUFS Scholarship", val(application.sufs_type)],
              ["SUFS Status", val(application.sufs_status)],
              ["Strengths", val(application.describe_student_strengths)],
              [
                "Opportunities for Growth",
                val(application.describe_student_opportunities_for_growth),
              ],
            ]}
          />
        </div>
      ) : null}

      {/* Health & medical from the registration packet */}
      {packet ? (
        <div>
          <h2 className="text-sm font-semibold mb-3">Health &amp; Medical</h2>
          <DetailTable
            rows={[
              ["Allergies", val(packet.allergies)],
              ["Dietary Restrictions", val(packet.dietary_restrictions)],
              ["Prescription Medications", val(packet.prescription_medications)],
              ["Health Conditions", val(packet.health_conditions)],
              ["Vision Impairments", val(packet.vision_impairments)],
              ["Hearing Impairments", val(packet.hearing_impairments)],
              [
                "Permission for Acetaminophen",
                val(packet.permission_for_acetaminophen),
              ],
              [
                "Counseling Services",
                val(packet.interested_in_counseling_services),
              ],
              ["Carries EpiPen", yesNo(packet.carry_epi_pen)],
              ...(packet.carry_epi_pen
                ? ([["EpiPen Notes", val(packet.epipen_explainer)]] as [string, string][])
                : []),
              ["On Medicaid", yesNo(packet.is_student_on_medicaid)],
              ...(packet.is_student_on_medicaid
                ? ([
                    ["Medicaid Provider", val(packet.medicaid_provider)],
                    ["Medicaid Number", val(packet.medicaid_number)],
                  ] as [string, string][])
                : []),
              [
                "Additional Health Notes",
                val(packet.additional_health_information),
              ],
            ]}
          />
        </div>
      ) : null}

      {/* Pickup / safety from the registration packet */}
      {packet ? (
        <div>
          <h2 className="text-sm font-semibold mb-3">Pickup &amp; Safety</h2>
          <DetailTable
            rows={[
              [
                "Other Adults Approved for Pickup",
                val(packet.other_adults_approved_for_pickup),
              ],
              ["Prohibited Adults", val(packet.prohibited_adults)],
            ]}
          />
        </div>
      ) : null}

      {/* Apparel sizing */}
      {packet ? (
        <div>
          <h2 className="text-sm font-semibold mb-3">Uniform &amp; Activities</h2>
          <DetailTable
            rows={[
              ["Shirt Size", val(packet.shirt_size)],
              ["Pant Size", val(packet.pant_size)],
              ["Swim Level", val(packet.swim_level)],
            ]}
          />
        </div>
      ) : null}

      {/* Documents — uploadable. Split into two tables so parents see at a
          glance what's mandatory vs nice-to-have. Same DocRow renderer for
          both groups; the `required` flag drives the per-row badge. */}
      <div>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-sm font-semibold">Required Documents</h2>
          <p className="text-xs text-muted-foreground">
            All four required to complete enrollment.
          </p>
        </div>
        <div className="rounded-xl bg-background p-1.5 shadow-sm border">
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <tbody className="divide-y">
                {requiredDocs.map(({ key, label, required }) => (
                  <DocRow
                    key={key}
                    field={key}
                    label={label}
                    required={required}
                    files={(student[key] as FileMetadata[] | undefined) ?? []}
                    studentId={student.id}
                    onChanged={() => {
                      void swrMutate("/api/students");
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-sm font-semibold">Optional Documents</h2>
          <p className="text-xs text-muted-foreground">
            Upload if applicable.
          </p>
        </div>
        <div className="rounded-xl bg-background p-1.5 shadow-sm border">
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <tbody className="divide-y">
                {optionalDocs.map(({ key, label, required }) => (
                  <DocRow
                    key={key}
                    field={key}
                    label={label}
                    required={required}
                    files={(student[key] as FileMetadata[] | undefined) ?? []}
                    studentId={student.id}
                    onChanged={() => {
                      void swrMutate("/api/students");
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

    </div>
  );
}

/**
 * Full-page loading state for the student detail page. Mirrors the real
 * layout — header (breadcrumb + title, then the Back / request-change row)
 * followed by the stacked detail sections and document tables — so the page
 * appears once, fully formed, instead of section-by-section as each fetch
 * resolves.
 */
function StudentDetailSkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-6 p-6 mx-auto w-full max-w-4xl">
      {/* Header — matches DashboardPageHeader: breadcrumb + title above a
          row with the Back button (left) and request-change action (right). */}
      <div className="border-b pb-4 space-y-3">
        <div className="space-y-2">
          <Skeleton className="h-3 w-48" />
          <Skeleton className="h-7 w-56" />
        </div>
        <div className="flex items-center justify-between gap-3">
          <Skeleton className="h-8 w-36 rounded-md" />
          <Skeleton className="h-8 w-52 rounded-md" />
        </div>
      </div>

      {/* Detail sections — h2 label over a bordered table card. Row counts
          loosely track the real sections (personal, academic, health,
          pickup/apparel) plus the two document tables. */}
      <SectionSkeleton rows={3} />
      <SectionSkeleton rows={6} />
      <SectionSkeleton rows={5} />
      <SectionSkeleton rows={4} />
      <SectionSkeleton rows={4} />
    </div>
  );
}

/** One labelled table-card skeleton block used by StudentDetailSkeleton. */
function SectionSkeleton({ rows }: { rows: number }) {
  return (
    <div>
      <Skeleton className="h-4 w-40 mb-3" />
      <div className="rounded-xl bg-background p-1.5 shadow-sm border">
        <div className="overflow-hidden rounded-lg border divide-y">
          {Array.from({ length: rows }).map((_, i) => (
            <div
              key={i}
              className="flex items-center justify-between gap-4 px-4 py-3"
            >
              <Skeleton className="h-3 w-40" />
              <Skeleton className="h-3 w-24" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function DetailTable({ rows }: { rows: [string, string][] }) {
  return (
    <div className="rounded-xl bg-background p-1.5 shadow-sm border">
      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <tbody className="divide-y">
            {rows.map(([label, value]) => (
              <tr key={label}>
                <td className="px-4 py-3 text-xs text-muted-foreground w-56 align-top">
                  {label}
                </td>
                <td className="px-4 py-3 font-medium whitespace-pre-wrap">
                  {value}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Per-document row: lists existing files (with link + delete) and a
 * compact "Upload file" button that triggers a hidden file input. Each
 * change PATCHes /api/students/:id with the new array.
 */
function DocRow({
  field,
  label,
  required,
  files,
  studentId,
  onChanged,
}: {
  field: DocField;
  label: string;
  required: boolean;
  files: FileMetadata[];
  studentId: number;
  onChanged: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validFiles = files.filter((f) => f && f.path);

  async function patchFiles(next: FileMetadata[]) {
    const res = await fetch(`/api/students/${studentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: next }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.error ?? `Save failed (${res.status})`);
    }
    await mutateStudents();
    onChanged();
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow same-file re-pick
    if (!file) return;
    setUploading(true);
    try {
      const uploadFile = await convertHeicToJpeg(file);
      const form = new FormData();
      form.append("file", uploadFile);
      const upRes = await fetch("/api/upload", { method: "POST", body: form });
      if (!upRes.ok) {
        const body = await upRes.json().catch(() => null);
        throw new Error(body?.error ?? `Upload failed (${upRes.status})`);
      }
      const meta: FileMetadata = await upRes.json();
      await patchFiles([...validFiles, meta]);
      toast.success(`${label} uploaded.`);
    } catch (err) {
      console.error("Document upload failed:", err);
      toast.error(
        err instanceof Error ? err.message : "Upload failed — please try again."
      );
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete() {
    if (pendingDelete === null) return;
    const idx = pendingDelete;
    setPendingDelete(null);
    try {
      await patchFiles(validFiles.filter((_, i) => i !== idx));
      toast.success(`${label} removed.`);
    } catch (err) {
      console.error("Document delete failed:", err);
      toast.error(
        err instanceof Error ? err.message : "Failed to remove file."
      );
    }
  }

  return (
    <>
      <tr>
        <td className="px-4 py-3 align-top w-72">
          <p className="font-medium flex items-center gap-2 flex-wrap">
            <FileText className="size-4 text-muted-foreground" />
            {label}
            {required ? (
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                Required
              </span>
            ) : null}
          </p>
        </td>
        <td className="px-4 py-3">
          {validFiles.length === 0 ? (
            <p className="text-xs text-muted-foreground">No file on record.</p>
          ) : (
            <ul className="space-y-1">
              {validFiles.map((f, i) => (
                <li
                  key={(f.path as string) ?? i}
                  className="flex items-center gap-2"
                >
                  <a
                    href={(f.url as string) ?? `${xanoBase}${f.path}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-primary underline underline-offset-2 hover:no-underline truncate"
                  >
                    {(f.name as string) || `File ${i + 1}`}
                    <ExternalLink className="size-3 shrink-0" />
                  </a>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-6 text-muted-foreground hover:text-red-600"
                    onClick={() => setPendingDelete(i)}
                    aria-label={`Remove ${f.name ?? `file ${i + 1}`}`}
                  >
                    <X className="size-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </td>
        <td className="px-4 py-3 text-right whitespace-nowrap w-32">
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.heic,.heif"
            className="hidden"
            onChange={handleUpload}
            disabled={uploading}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="bg-white"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? (
              <>
                <Loader2 className="size-3 animate-spin mr-1.5" />
                Uploading
              </>
            ) : (
              <>
                <FileUp className="size-3.5 mr-1.5" />
                Upload file
              </>
            )}
          </Button>
        </td>
      </tr>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this file?</AlertDialogTitle>
            <AlertDialogDescription>
              The file will be removed from this student&rsquo;s record. You
              can upload a replacement afterwards.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={(e) => {
                e.preventDefault();
                void handleDelete();
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

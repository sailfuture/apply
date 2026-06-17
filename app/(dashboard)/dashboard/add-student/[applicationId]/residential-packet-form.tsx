"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { convertHeicToJpeg } from "@/lib/heic";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldLabel } from "@/components/ui/field";
import { PhoneInput } from "@/components/ui/phone-input";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, Clock, FileUp, Loader2, X, ExternalLink } from "lucide-react";

/**
 * Per-student registration packet for a residential / foster mid-year
 * addition, rendered on the add-student page once admin has accepted the
 * student. Self-contained on purpose: it reuses the same endpoints as the
 * family apply-flow registration step (`/api/student-registration/[id]`
 * for the packet, `/api/students/[id]` for the evergreen document arrays,
 * `/api/upload` for files) but shares no state with that page, so there's
 * no risk to the critical family registration flow.
 *
 * No tuition / enrollment-signing — funding for these placements is
 * external. Completion is derived from the packet's required fields (see
 * `isPacketComplete`); once complete the parent submits and the student
 * waits on admin to confirm the packet (`registrationConfirmed`), which is
 * what finally folds them into the enrolled roster.
 *
 * NOTE: the liability waiver (PandaDoc) is intentionally NOT part of the
 * completion criteria here — who signs it for a foster placement (foster
 * parent vs. placing agency) is an open question to resolve separately.
 */

type FileMeta = { path?: string; name?: string; url?: string; [k: string]: unknown };

type DocField =
  | "birth_certificate"
  | "school_health_form"
  | "transcripts"
  | "immunization_forms"
  | "iep"
  | "ssn_card"
  | "passport"
  | "student_state_id"
  | "discipline";

interface Packet {
  id?: number;
  registration_students_id: number;
  registration_school_years_id: number;
  registration_type_id: number;
  shirt_size: string;
  pant_size: string;
  swim_level: string;
  allergies: string;
  dietary_restrictions: string;
  prescription_medications: string;
  health_conditions: string;
  vision_impairments: string;
  hearing_impairments: string;
  is_student_on_medicaid: boolean;
  medicaid_number: number | string;
  medicaid_provider: string;
  carry_epi_pen: boolean;
  epipen_explainer: string;
  permission_for_acetaminophen: string;
  additional_health_information: string;
  interested_in_counseling_services: string;
  other_adults_approved_for_pickup: string;
  prohibited_adults: string;
  registrationConfirmed?: boolean;
}

const SIZES = ["XS", "S", "M", "L", "XL", "XXL"];
const SWIM_LEVELS = ["None", "Beginner", "Intermediate", "Advanced"];
const YES_NO = ["Yes", "No"];
const YES_NO_MAYBE = ["Yes", "No", "Maybe"];
const MEDICAID_PROVIDERS = [
  "Humana Healthy Horizons in Florida",
  "Sunshine Health",
  "Simply Healthcare Plan",
  "UnitedHealthcare Community Plan of Florida",
  "Aetna Better Health of Florida",
];

const REQUIRED_DOCS: { key: DocField; label: string }[] = [
  { key: "birth_certificate", label: "Birth Certificate" },
  { key: "school_health_form", label: "School Health Form" },
  { key: "transcripts", label: "Transcripts" },
  { key: "immunization_forms", label: "Immunization Forms" },
];
const OPTIONAL_DOCS: { key: DocField; label: string }[] = [
  { key: "iep", label: "IEP" },
  { key: "ssn_card", label: "SSN Card" },
  { key: "passport", label: "Passport" },
  { key: "student_state_id", label: "Student State ID" },
  { key: "discipline", label: "Discipline Records" },
];

function hasFile(meta: FileMeta | null | undefined): boolean {
  return !!meta && typeof meta === "object" && !!meta.path;
}

function hasAnyDoc(arr: FileMeta[] | undefined): boolean {
  return Array.isArray(arr) && arr.some((m) => hasFile(m));
}

function emptyPacket(
  studentId: number,
  yearId: number,
  typeId: number
): Packet {
  return {
    registration_students_id: studentId,
    registration_school_years_id: yearId,
    registration_type_id: typeId,
    shirt_size: "",
    pant_size: "",
    swim_level: "",
    allergies: "",
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
  };
}

/** Completion criteria for a residential packet — mirrors the family
 *  flow's `isRegistrationComplete` minus the liability waiver. */
function isPacketComplete(
  p: Packet,
  docs: Record<DocField, FileMeta[]>
): boolean {
  if (!p.shirt_size || !p.pant_size || !p.swim_level) return false;
  for (const { key } of REQUIRED_DOCS) {
    if (!hasAnyDoc(docs[key])) return false;
  }
  if (!p.allergies) return false;
  if (!p.dietary_restrictions) return false;
  if (!p.prescription_medications) return false;
  if (!p.health_conditions) return false;
  if (!p.vision_impairments) return false;
  if (!p.hearing_impairments) return false;
  if (!p.permission_for_acetaminophen) return false;
  if (!p.interested_in_counseling_services) return false;
  if (p.carry_epi_pen && !p.epipen_explainer) return false;
  if (!p.other_adults_approved_for_pickup) return false;
  if (!p.prohibited_adults) return false;
  return true;
}

const XANO_FILE_BASE =
  process.env.NEXT_PUBLIC_XANO_BASE ?? "https://xsc3-mvx7-r86m.n7e.xano.io";

/** Compact multi-file uploader for an evergreen student document array. */
function DocUpload({
  label,
  files,
  onUploaded,
  onRemoved,
  invalid,
}: {
  label: string;
  files: FileMeta[];
  onUploaded: (meta: FileMeta) => void;
  onRemoved: (index: number) => void;
  invalid?: boolean;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasAny = files.some((f) => hasFile(f));

  async function handleFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of Array.from(list)) {
        const uploadFile = await convertHeicToJpeg(file);
        const fd = new FormData();
        fd.append("file", uploadFile);
        const res = await fetch("/api/upload", { method: "POST", body: fd });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error ?? `Upload failed (${res.status})`);
        }
        onUploaded((await res.json()) as FileMeta);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {files.map((file, idx) =>
        hasFile(file) ? (
          <div
            key={(file.path as string) ?? idx}
            className="flex items-center gap-3 rounded-md border border-input bg-background px-4 py-2.5"
          >
            <CheckCircle2 className="size-5 text-green-600 shrink-0" />
            <p className="flex-1 min-w-0 text-sm font-medium truncate">
              {(file.name as string) || `Uploaded file ${idx + 1}`}
            </p>
            {file.path ? (
              <a
                href={(file.url as string) ?? `${XANO_FILE_BASE}${file.path}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex size-7 shrink-0 items-center justify-center rounded-md hover:bg-muted"
              >
                <ExternalLink className="size-4 text-muted-foreground" />
              </a>
            ) : null}
            <Button
              variant="ghost"
              size="icon"
              className="size-7 shrink-0"
              onClick={() => onRemoved(idx)}
              aria-label="Remove file"
            >
              <X className="size-4" />
            </Button>
          </div>
        ) : null
      )}
      <label
        className={`flex cursor-pointer flex-row items-center gap-3 rounded-md border border-dashed px-4 py-3 transition-colors hover:bg-muted/30 ${
          invalid && !hasAny ? "border-2 border-red-400" : "border-input"
        }`}
      >
        {uploading ? (
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        ) : (
          <FileUp className="size-5 text-muted-foreground" />
        )}
        <div className="flex-1 text-left">
          <p className="text-sm font-medium">
            {uploading
              ? "Uploading…"
              : hasAny
                ? `Add another ${label.toLowerCase()}`
                : label}
          </p>
          <p className="text-xs text-muted-foreground">PDF, JPG, PNG, or HEIC (max 10MB each)</p>
        </div>
        <input
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,.heic,.heif"
          className="hidden"
          disabled={uploading}
          onChange={(e) => {
            void handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </label>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}

interface StudentDocsRow {
  id: number;
  student_phone?: string;
  birth_certificate?: FileMeta[];
  school_health_form?: FileMeta[];
  transcripts?: FileMeta[];
  immunization_forms?: FileMeta[];
  iep?: FileMeta[];
  ssn_card?: FileMeta[];
  passport?: FileMeta[];
  student_state_id?: FileMeta[];
  discipline?: FileMeta[];
}

export function ResidentialPacketForm({
  studentId,
  yearId,
  registrationTypeId,
  studentName,
  onSubmitted,
}: {
  studentId: number;
  yearId: number;
  registrationTypeId: number;
  studentName: string;
  /** Optional — called after a successful submit (e.g. to revalidate
   *  dashboard caches). The form manages its own post-submit view. */
  onSubmitted?: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [packet, setPacket] = useState<Packet | null>(null);
  const [docs, setDocs] = useState<Record<DocField, FileMeta[]>>({
    birth_certificate: [],
    school_health_form: [],
    transcripts: [],
    immunization_forms: [],
    iep: [],
    ssn_card: [],
    passport: [],
    student_state_id: [],
    discipline: [],
  });
  // Student phone lives on the evergreen student row (not the packet),
  // so it persists independently — on blur + on save, like the docs.
  const [studentPhone, setStudentPhone] = useState("");
  const [savedStudentPhone, setSavedStudentPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [showValidation, setShowValidation] = useState(false);

  const loadDocsFromStudent = useCallback((row: StudentDocsRow | undefined) => {
    if (!row) return;
    setDocs({
      birth_certificate: row.birth_certificate ?? [],
      school_health_form: row.school_health_form ?? [],
      transcripts: row.transcripts ?? [],
      immunization_forms: row.immunization_forms ?? [],
      iep: row.iep ?? [],
      ssn_card: row.ssn_card ?? [],
      passport: row.passport ?? [],
      student_state_id: row.student_state_id ?? [],
      discipline: row.discipline ?? [],
    });
    setStudentPhone(row.student_phone ?? "");
    setSavedStudentPhone(row.student_phone ?? "");
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [packetRes, studentsRes] = await Promise.all([
          fetch(`/api/student-registration?studentId=${studentId}`),
          fetch(`/api/students`),
        ]);
        let loadedPacket: Packet | null = null;
        if (packetRes.ok) {
          const data = await packetRes.json();
          if (data && typeof data === "object" && data.id) {
            loadedPacket = {
              ...emptyPacket(studentId, yearId, registrationTypeId),
              ...data,
              medicaid_number: data.medicaid_number ?? "",
            };
          }
        }
        if (cancelled) return;
        setPacket(
          loadedPacket ?? emptyPacket(studentId, yearId, registrationTypeId)
        );
        if (studentsRes.ok) {
          const students: StudentDocsRow[] = await studentsRes.json();
          loadDocsFromStudent(students.find((s) => s.id === studentId));
        }
      } catch (err) {
        console.error("Failed to load packet:", err);
        if (!cancelled)
          setPacket(emptyPacket(studentId, yearId, registrationTypeId));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [studentId, yearId, registrationTypeId, loadDocsFromStudent]);

  function setField<K extends keyof Packet>(key: K, value: Packet[K]) {
    setPacket((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  // Documents persist immediately on add/remove (they live on the evergreen
  // student row, independent of the packet's save lifecycle).
  async function persistDocs(field: DocField, next: FileMeta[]) {
    setDocs((prev) => ({ ...prev, [field]: next }));
    try {
      const res = await fetch(`/api/students/${studentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: next }),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
    } catch (err) {
      console.error(`Failed to save ${field}:`, err);
      toast.error("Failed to save document. Please try again.");
    }
  }

  // Persist the student's phone to the evergreen student row. No-ops when
  // unchanged; called on blur and again from save/submit so a number typed
  // without blurring still lands.
  async function persistStudentPhone() {
    if (studentPhone === savedStudentPhone) return;
    try {
      const res = await fetch(`/api/students/${studentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ student_phone: studentPhone }),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      setSavedStudentPhone(studentPhone);
    } catch (err) {
      console.error("Failed to save student phone:", err);
      toast.error("Failed to save phone number. Please try again.");
    }
  }

  const complete = useMemo(
    () => (packet ? isPacketComplete(packet, docs) : false),
    [packet, docs]
  );

  async function savePacket(): Promise<boolean> {
    if (!packet?.id) {
      // The accept cascade creates the packet server-side; a missing id
      // means acceptance hasn't fully landed yet.
      toast.error("This student's packet isn't ready yet. Try again shortly.");
      return false;
    }
    // Strip server-owned fields — the parent never writes the admin
    // confirmation flag or the Xano-managed id.
    const { id, registrationConfirmed, ...payload } = packet;
    void id;
    void registrationConfirmed;
    const res = await fetch(`/api/student-registration/${packet.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return res.ok;
  }

  async function handleSave() {
    if (saving || submitting) return;
    setSaving(true);
    try {
      await persistStudentPhone();
      if (!(await savePacket())) throw new Error("save failed");
      toast.success("Progress saved.");
    } catch {
      toast.error("Couldn't save. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmit() {
    if (saving || submitting || !packet) return;
    if (!complete) {
      setShowValidation(true);
      toast.error("Please complete all required fields before submitting.");
      return;
    }
    setSubmitting(true);
    try {
      await persistStudentPhone();
      if (!(await savePacket())) throw new Error("save failed");
      toast.success("Registration packet submitted for review.");
      setSubmitted(true);
      onSubmitted?.();
    } catch {
      toast.error("Couldn't submit. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading || !packet) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-lg border p-6 space-y-3">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-9 w-full rounded-md" />
            <Skeleton className="h-9 w-full rounded-md" />
          </div>
        ))}
      </div>
    );
  }

  // Admin has confirmed the packet — the student is fully enrolled.
  if (packet.registrationConfirmed) {
    return (
      <PacketBanner
        tone="success"
        title={`${studentName} is enrolled.`}
        body="Admissions has confirmed this student's registration — they now appear in your enrolled students."
      />
    );
  }
  // Parent submitted; waiting on admin to confirm the packet.
  if (submitted) {
    return (
      <PacketBanner
        tone="pending"
        title={`${studentName}'s registration is in review.`}
        body="Thanks! Our admissions team is reviewing the packet. This student joins your enrolled roster once it's confirmed."
      />
    );
  }

  const invalid = (v: string) => showValidation && !v;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">
          Registration packet — {studentName}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Complete this student&rsquo;s registration details. Once submitted,
          our admissions team confirms the packet and the student joins your
          enrolled roster.
        </p>
      </div>

      {/* Student Information — evergreen contact info on the student
          row (persists independently of the packet save). */}
      <Card className="overflow-hidden gap-0 py-0">
        <CardHeader className="py-3 !pb-3 border-b">
          <CardTitle className="text-base">Student Information</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 py-5 sm:grid-cols-3 bg-white dark:bg-background">
          <Field>
            <FieldLabel className="text-xs">Student Phone</FieldLabel>
            <PhoneInput
              value={studentPhone}
              onChange={setStudentPhone}
              onValidate={() => void persistStudentPhone()}
            />
          </Field>
        </CardContent>
      </Card>

      {/* Uniform */}
      <Card className="overflow-hidden gap-0 py-0">
        <CardHeader className="py-3 !pb-3 border-b">
          <CardTitle className="text-base">Uniform</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 py-5 sm:grid-cols-3 bg-white dark:bg-background">
          <PacketSelect
            label="Shirt Size"
            value={packet.shirt_size}
            options={SIZES}
            onChange={(v) => setField("shirt_size", v)}
            invalid={invalid(packet.shirt_size)}
          />
          <PacketSelect
            label="Pant Size"
            value={packet.pant_size}
            options={SIZES}
            onChange={(v) => setField("pant_size", v)}
            invalid={invalid(packet.pant_size)}
          />
          <PacketSelect
            label="Swim Level"
            value={packet.swim_level}
            options={SWIM_LEVELS}
            onChange={(v) => setField("swim_level", v)}
            invalid={invalid(packet.swim_level)}
          />
        </CardContent>
      </Card>

      {/* Documents */}
      <Card className="overflow-hidden gap-0 py-0">
        <CardHeader className="py-3 !pb-3 border-b">
          <CardTitle className="text-base">Documents</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5 py-5 sm:grid-cols-2 bg-white dark:bg-background">
          {REQUIRED_DOCS.map(({ key, label }) => (
            <Field key={key}>
              <FieldLabel className="text-xs">
                {label} <span className="text-red-400">*</span>
              </FieldLabel>
              <DocUpload
                label={`Upload ${label}`}
                files={docs[key]}
                invalid={showValidation}
                onUploaded={(meta) => persistDocs(key, [...docs[key], meta])}
                onRemoved={(idx) =>
                  persistDocs(
                    key,
                    docs[key].filter((_, i) => i !== idx)
                  )
                }
              />
            </Field>
          ))}
          {OPTIONAL_DOCS.map(({ key, label }) => (
            <Field key={key}>
              <FieldLabel className="text-xs">{label}</FieldLabel>
              <DocUpload
                label={`Upload ${label}`}
                files={docs[key]}
                onUploaded={(meta) => persistDocs(key, [...docs[key], meta])}
                onRemoved={(idx) =>
                  persistDocs(
                    key,
                    docs[key].filter((_, i) => i !== idx)
                  )
                }
              />
            </Field>
          ))}
        </CardContent>
      </Card>

      {/* Health & medical */}
      <Card className="overflow-hidden gap-0 py-0">
        <CardHeader className="py-3 !pb-3 border-b">
          <CardTitle className="text-base">Health &amp; Medical</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 py-5 bg-white dark:bg-background">
          <div className="grid gap-4 sm:grid-cols-2">
            <PacketTextarea
              label="Allergies"
              value={packet.allergies}
              onChange={(v) => setField("allergies", v)}
              invalid={invalid(packet.allergies)}
            />
            <PacketTextarea
              label="Dietary Restrictions"
              value={packet.dietary_restrictions}
              onChange={(v) => setField("dietary_restrictions", v)}
              invalid={invalid(packet.dietary_restrictions)}
            />
            <PacketTextarea
              label="Prescription Medications"
              value={packet.prescription_medications}
              onChange={(v) => setField("prescription_medications", v)}
              invalid={invalid(packet.prescription_medications)}
            />
            <PacketTextarea
              label="Health Conditions"
              value={packet.health_conditions}
              onChange={(v) => setField("health_conditions", v)}
              invalid={invalid(packet.health_conditions)}
            />
            <PacketTextarea
              label="Vision Impairments"
              value={packet.vision_impairments}
              onChange={(v) => setField("vision_impairments", v)}
              invalid={invalid(packet.vision_impairments)}
            />
            <PacketTextarea
              label="Hearing Impairments"
              value={packet.hearing_impairments}
              onChange={(v) => setField("hearing_impairments", v)}
              invalid={invalid(packet.hearing_impairments)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <PacketSelect
              label="Permission for Acetaminophen"
              value={packet.permission_for_acetaminophen}
              options={YES_NO}
              onChange={(v) => setField("permission_for_acetaminophen", v)}
              invalid={invalid(packet.permission_for_acetaminophen)}
            />
            <PacketSelect
              label="Interested in Counseling Services"
              value={packet.interested_in_counseling_services}
              options={YES_NO_MAYBE}
              onChange={(v) =>
                setField("interested_in_counseling_services", v)
              }
              invalid={invalid(packet.interested_in_counseling_services)}
            />
          </div>

          <div className="flex items-center justify-between gap-3 border-t pt-4">
            <div>
              <p className="text-sm font-medium">Carries an EpiPen</p>
              <p className="text-xs text-muted-foreground">
                Toggle on if this student carries an EpiPen.
              </p>
            </div>
            <Switch
              checked={packet.carry_epi_pen}
              onCheckedChange={(v) => setField("carry_epi_pen", v)}
              aria-label="Carries an EpiPen"
            />
          </div>
          {packet.carry_epi_pen ? (
            <PacketTextarea
              label="EpiPen Details"
              value={packet.epipen_explainer}
              onChange={(v) => setField("epipen_explainer", v)}
              invalid={invalid(packet.epipen_explainer)}
            />
          ) : null}

          <div className="flex items-center justify-between gap-3 border-t pt-4">
            <div>
              <p className="text-sm font-medium">On Medicaid</p>
              <p className="text-xs text-muted-foreground">
                Toggle on to record the student&rsquo;s Medicaid plan.
              </p>
            </div>
            <Switch
              checked={packet.is_student_on_medicaid}
              onCheckedChange={(v) => setField("is_student_on_medicaid", v)}
              aria-label="On Medicaid"
            />
          </div>
          {packet.is_student_on_medicaid ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel className="text-xs">Medicaid Number</FieldLabel>
                <Input
                  value={String(packet.medicaid_number ?? "")}
                  onChange={(e) => setField("medicaid_number", e.target.value)}
                />
              </Field>
              <PacketSelect
                label="Medicaid Provider"
                value={packet.medicaid_provider}
                options={MEDICAID_PROVIDERS}
                onChange={(v) => setField("medicaid_provider", v)}
              />
            </div>
          ) : null}

          <PacketTextarea
            label="Additional Health Information"
            value={packet.additional_health_information}
            onChange={(v) => setField("additional_health_information", v)}
          />
        </CardContent>
      </Card>

      {/* Pickup & safety */}
      <Card className="overflow-hidden gap-0 py-0">
        <CardHeader className="py-3 !pb-3 border-b">
          <CardTitle className="text-base">Pickup &amp; Safety</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 py-5 sm:grid-cols-2 bg-white dark:bg-background">
          <PacketTextarea
            label="Other Adults Approved for Pickup"
            value={packet.other_adults_approved_for_pickup}
            onChange={(v) => setField("other_adults_approved_for_pickup", v)}
            invalid={invalid(packet.other_adults_approved_for_pickup)}
          />
          <PacketTextarea
            label="Adults Prohibited from Pickup"
            value={packet.prohibited_adults}
            onChange={(v) => setField("prohibited_adults", v)}
            invalid={invalid(packet.prohibited_adults)}
          />
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-3">
        <Button variant="outline" onClick={handleSave} disabled={saving || submitting}>
          {saving ? "Saving…" : "Save for Later"}
        </Button>
        <Button onClick={handleSubmit} disabled={submitting || saving}>
          {submitting ? "Submitting…" : "Submit Registration"}
        </Button>
      </div>
    </div>
  );
}

function PacketSelect({
  label,
  value,
  options,
  onChange,
  invalid,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
  invalid?: boolean;
}) {
  return (
    <Field>
      <FieldLabel className="text-xs">{label}</FieldLabel>
      <Select value={value || undefined} onValueChange={onChange}>
        <SelectTrigger className={`w-full ${invalid ? "border-2 border-red-400" : ""}`}>
          <SelectValue placeholder="Select…" />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o} value={o}>
              {o}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

function PacketTextarea({
  label,
  value,
  onChange,
  invalid,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  invalid?: boolean;
}) {
  return (
    <Field>
      <FieldLabel className="text-xs">{label}</FieldLabel>
      <Textarea
        className={`min-h-[72px] ${invalid ? "border-2 border-red-400" : ""}`}
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

function PacketBanner({
  tone,
  title,
  body,
}: {
  tone: "success" | "pending";
  title: string;
  body: string;
}) {
  const cls =
    tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100"
      : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100";
  return (
    <div className={`rounded-xl border p-5 flex items-start gap-3 ${cls}`}>
      <div className="shrink-0 mt-0.5">
        {tone === "success" ? (
          <CheckCircle2 className="size-5" />
        ) : (
          <Clock className="size-5" />
        )}
      </div>
      <div>
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-xs mt-1 opacity-80 max-w-xl">{body}</p>
      </div>
    </div>
  );
}

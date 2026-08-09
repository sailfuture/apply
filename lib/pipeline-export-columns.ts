import type {
  PipelineFamilyRow,
  PipelineStage,
} from "@/app/api/admin/pipeline/route";

/**
 * Column metadata + row formatting for the Admissions Pipeline export.
 * Mirrors the enrolled-export contract: every exported value is a
 * pre-formatted string (booleans → "Yes"/"No", timestamps →
 * "YYYY-MM-DD"); the `stage` field is a filter, never a column —
 * the visible stage column is `stage_label`.
 */
export interface PipelineExportRow {
  /** Filter-only — which board column the family sits in. */
  stage: PipelineStage;
  family_name: string;
  primary_name: string;
  primary_email: string;
  primary_phone: string;
  student_names: string;
  student_count: string;
  stage_label: string;
  application_type: string;
  application_status: string;
  app_sections: string;
  submitted_date: string;
  accepted_date: string;
  reg_sections: string;
  tuition_done: string;
  enrollment_agreement_done: string;
  registration_packet_done: string;
  volunteer_hours_done: string;
  registration_submitted: string;
  registration_submitted_date: string;
  registration_confirmed: string;
  registration_confirmed_date: string;
}

export type PipelineExportColumnKey = Exclude<
  keyof PipelineExportRow,
  "stage"
>;

export type PipelineExportColumnGroup =
  | "Family"
  | "Application"
  | "Registration";

export interface PipelineExportColumn {
  key: PipelineExportColumnKey;
  label: string;
  group: PipelineExportColumnGroup;
  defaultSelected?: boolean;
}

export const PIPELINE_EXPORT_COLUMN_GROUPS: PipelineExportColumnGroup[] = [
  "Family",
  "Application",
  "Registration",
];

export const PIPELINE_EXPORT_COLUMNS: PipelineExportColumn[] = [
  { key: "family_name", label: "Family", group: "Family", defaultSelected: true },
  { key: "primary_name", label: "Primary Parent", group: "Family", defaultSelected: true },
  { key: "primary_email", label: "Email", group: "Family", defaultSelected: true },
  { key: "primary_phone", label: "Phone", group: "Family", defaultSelected: true },
  { key: "student_names", label: "Students", group: "Family", defaultSelected: true },
  { key: "student_count", label: "Student Count", group: "Family" },
  { key: "stage_label", label: "Pipeline Stage", group: "Application", defaultSelected: true },
  { key: "application_type", label: "Application Type", group: "Application", defaultSelected: true },
  { key: "application_status", label: "Application Status", group: "Application", defaultSelected: true },
  { key: "app_sections", label: "Application Sections", group: "Application" },
  { key: "submitted_date", label: "Submitted Date", group: "Application", defaultSelected: true },
  { key: "accepted_date", label: "Accepted Date", group: "Application", defaultSelected: true },
  { key: "reg_sections", label: "Registration Sections", group: "Registration" },
  { key: "tuition_done", label: "Tuition Done", group: "Registration" },
  { key: "enrollment_agreement_done", label: "Enrollment Agreement Done", group: "Registration" },
  { key: "registration_packet_done", label: "Registration Packet Done", group: "Registration" },
  { key: "volunteer_hours_done", label: "Volunteer Hours Done", group: "Registration" },
  { key: "registration_submitted", label: "Registration Submitted", group: "Registration", defaultSelected: true },
  { key: "registration_submitted_date", label: "Registration Submitted Date", group: "Registration" },
  { key: "registration_confirmed", label: "Registration Confirmed", group: "Registration", defaultSelected: true },
  { key: "registration_confirmed_date", label: "Registration Confirmed Date", group: "Registration" },
];

export const PIPELINE_STAGE_LABELS: Record<PipelineStage, string> = {
  application: "Application",
  registration: "Registration",
  enrollment: "Enrollment",
};

function fmtDate(ms: number | null | undefined): string {
  if (!ms) return "";
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function yesNo(v: boolean): string {
  return v ? "Yes" : "No";
}

function applicationStatusLabel(row: PipelineFamilyRow): string {
  if (row.isAccepted) return "Accepted";
  if (row.isSubmitted) return "Submitted";
  if (row.app_sections_complete > 0) return "In Progress";
  return "Not Started";
}

/** Project raw pipeline rows into pre-formatted export rows. Callers
 *  should filter out `is_archived` rows before (or after) calling —
 *  the pipeline export never includes archived families. */
export function buildPipelineExportRows(
  rows: PipelineFamilyRow[]
): PipelineExportRow[] {
  return rows.map((r) => ({
    stage: r.stage,
    family_name: r.family_name,
    primary_name: r.primary_name,
    primary_email: r.primary_email,
    primary_phone: r.primary_phone,
    student_names: r.student_names,
    student_count: String(r.student_count),
    stage_label: PIPELINE_STAGE_LABELS[r.stage],
    application_type:
      r.flow_type === "reapply" ? "Re-Enrollment" : "New Application",
    application_status: applicationStatusLabel(r),
    app_sections: `${r.app_sections_complete}/${r.app_sections_total}`,
    submitted_date: fmtDate(r.submitted_at),
    accepted_date: fmtDate(r.accepted_at),
    reg_sections: `${r.reg_sections_complete}/${r.reg_sections_total}`,
    tuition_done: yesNo(r.reg_tuition_done),
    enrollment_agreement_done: yesNo(r.reg_enrollment_done),
    registration_packet_done: yesNo(r.reg_packet_done),
    volunteer_hours_done: yesNo(r.reg_volunteer_done),
    registration_submitted: yesNo(r.reg_submitted),
    registration_submitted_date: fmtDate(r.reg_submitted_date),
    registration_confirmed: yesNo(r.is_registration_confirmed),
    registration_confirmed_date: fmtDate(r.registration_confirmed_time),
  }));
}

/**
 * Shared column metadata for the Enrolled Students XLSX export.
 *
 * Single source of truth for the export's shape: the API route
 * (`/api/admin/enrolled/export`) produces an `EnrolledExportRow` per
 * student, and the export dialog renders one checkbox per column here
 * and projects the chosen columns into the spreadsheet. Keeping the
 * keys/labels/groups in one place stops the route and the modal from
 * drifting apart.
 *
 * Every exportable value is a pre-formatted string so the spreadsheet
 * writer can drop it straight into a cell (booleans become "Yes"/"No",
 * timestamps become "YYYY-MM-DD", etc.). The three `is_*` booleans are
 * NOT columns — they back the status/program filters in the modal.
 */

/** One row of the export — a flat, display-ready projection of a
 *  student joined with their year packet + family. */
export interface EnrolledExportRow {
  /** Stable id for React keys + de-dupe. Not exported as a column. */
  student_id: number;

  // ── Filter-only fields (drive the modal's checkboxes, never columns) ──
  /** `student.isEnrolled === true && !isArchived`. */
  is_enrolled: boolean;
  /** `student.isArchived === true` — formally unenrolled. */
  is_archived: boolean;
  /** Family-level `is_residential` flag (foster/residential family). */
  is_residential: boolean;

  // ── Student ──
  first_name: string;
  last_name: string;
  /** Student's school Google account (`registration_students.school_email`),
   *  e.g. first.last26@sailfuture.org; "" until admin assigns one. */
  school_email: string;
  date_of_birth: string;
  gender: string;
  ethnicity: string;

  // ── Placement (per-year packet) ──
  grade_level: string;
  incoming_grade: string;
  crew_assignment: string;
  shirt_size: string;
  pant_size: string;
  swim_level: string;

  // ── Status & program ──
  enrollment_status: string;
  program: string;
  enrolled_date: string;
  unenrollment_date: string;
  unenrollment_reason: string;
  liability_waiver_status: string;

  // ── Transportation (per-year application) ──
  bus_transportation: string;
  bus_stop: string;

  // ── Contact ──
  family_name: string;
  primary_name: string;
  primary_email: string;
  primary_phone: string;
  secondary_name: string;
  secondary_email: string;
  secondary_phone: string;
  /** All emergency contacts joined — "Name (relationship) · phone",
   *  separated by "; ". */
  emergency_contacts: string;

  // ── Medical / health (per-year packet) ──
  allergies: string;
  health_conditions: string;
  dietary_restrictions: string;
  prescription_medications: string;
  vision_impairments: string;
  hearing_impairments: string;
  carry_epi_pen: string;
  epi_pen_notes: string;
  acetaminophen_permission: string;
  counseling_interest: string;
  additional_health_notes: string;
  on_medicaid: string;
  medicaid_number: string;
  medicaid_provider: string;

  // ── Pickup & safety (per-year packet) ──
  approved_pickup_adults: string;
  prohibited_adults: string;

  // ── Documents — "Approved" | "Uploaded" | "Missing" ──
  doc_birth_certificate: string;
  doc_school_health_form: string;
  doc_transcripts: string;
  doc_immunization: string;

  // ── Testing ──
  nwea_math: string;
  nwea_reading: string;
  nwea_math_date: string;
  nwea_reading_date: string;
}

/** Keys that map to an actual spreadsheet column (everything on the
 *  row except the id + the filter booleans). */
export type ExportColumnKey = Exclude<
  keyof EnrolledExportRow,
  "student_id" | "is_enrolled" | "is_archived" | "is_residential"
>;

export type ExportColumnGroup =
  | "Student"
  | "Placement"
  | "Status & program"
  | "Transportation"
  | "Contact"
  | "Medical"
  | "Pickup & safety"
  | "Documents"
  | "Testing";

export interface ExportColumn {
  key: ExportColumnKey;
  label: string;
  group: ExportColumnGroup;
  /** Checked by default in the modal so a one-click export yields a
   *  sensible roster without ticking every box. */
  defaultSelected: boolean;
}

/** Group render order in the modal. */
export const EXPORT_COLUMN_GROUPS: ExportColumnGroup[] = [
  "Student",
  "Placement",
  "Status & program",
  "Transportation",
  "Contact",
  "Medical",
  "Pickup & safety",
  "Documents",
  "Testing",
];

/** The full column menu, in spreadsheet order. */
export const EXPORT_COLUMNS: ExportColumn[] = [
  // Student
  { key: "first_name", label: "First Name", group: "Student", defaultSelected: true },
  { key: "last_name", label: "Last Name", group: "Student", defaultSelected: true },
  { key: "school_email", label: "School Email", group: "Student", defaultSelected: true },
  { key: "date_of_birth", label: "Date of Birth", group: "Student", defaultSelected: true },
  { key: "gender", label: "Gender", group: "Student", defaultSelected: false },
  { key: "ethnicity", label: "Ethnicity", group: "Student", defaultSelected: false },
  // Placement
  { key: "grade_level", label: "Grade Level", group: "Placement", defaultSelected: true },
  { key: "incoming_grade", label: "Incoming Grade", group: "Placement", defaultSelected: false },
  { key: "crew_assignment", label: "Crew", group: "Placement", defaultSelected: true },
  { key: "shirt_size", label: "Shirt Size", group: "Placement", defaultSelected: true },
  { key: "pant_size", label: "Pant Size", group: "Placement", defaultSelected: false },
  { key: "swim_level", label: "Swim Level", group: "Placement", defaultSelected: false },
  // Status & program
  { key: "enrollment_status", label: "Enrollment Status", group: "Status & program", defaultSelected: true },
  { key: "program", label: "Program", group: "Status & program", defaultSelected: true },
  { key: "enrolled_date", label: "Enrolled Date", group: "Status & program", defaultSelected: false },
  { key: "unenrollment_date", label: "Unenrollment Date", group: "Status & program", defaultSelected: false },
  { key: "unenrollment_reason", label: "Unenrollment Reason", group: "Status & program", defaultSelected: false },
  { key: "liability_waiver_status", label: "Liability Waiver", group: "Status & program", defaultSelected: false },
  // Transportation
  { key: "bus_transportation", label: "Bus Transportation", group: "Transportation", defaultSelected: true },
  { key: "bus_stop", label: "Bus Stop", group: "Transportation", defaultSelected: true },
  // Contact
  { key: "family_name", label: "Family", group: "Contact", defaultSelected: false },
  { key: "primary_name", label: "Primary Contact", group: "Contact", defaultSelected: false },
  { key: "primary_email", label: "Primary Email", group: "Contact", defaultSelected: false },
  { key: "primary_phone", label: "Primary Phone", group: "Contact", defaultSelected: false },
  { key: "secondary_name", label: "Secondary Contact", group: "Contact", defaultSelected: false },
  { key: "secondary_email", label: "Secondary Email", group: "Contact", defaultSelected: false },
  { key: "secondary_phone", label: "Secondary Phone", group: "Contact", defaultSelected: false },
  { key: "emergency_contacts", label: "Emergency Contacts", group: "Contact", defaultSelected: false },
  // Medical
  { key: "allergies", label: "Allergies", group: "Medical", defaultSelected: false },
  { key: "health_conditions", label: "Health Conditions", group: "Medical", defaultSelected: false },
  { key: "dietary_restrictions", label: "Dietary Restrictions", group: "Medical", defaultSelected: false },
  { key: "prescription_medications", label: "Prescription Medications", group: "Medical", defaultSelected: false },
  { key: "vision_impairments", label: "Vision Impairments", group: "Medical", defaultSelected: false },
  { key: "hearing_impairments", label: "Hearing Impairments", group: "Medical", defaultSelected: false },
  { key: "carry_epi_pen", label: "Carries EpiPen", group: "Medical", defaultSelected: false },
  { key: "epi_pen_notes", label: "EpiPen Notes", group: "Medical", defaultSelected: false },
  { key: "acetaminophen_permission", label: "Acetaminophen Permission", group: "Medical", defaultSelected: false },
  { key: "counseling_interest", label: "Counseling Interest", group: "Medical", defaultSelected: false },
  { key: "additional_health_notes", label: "Additional Health Notes", group: "Medical", defaultSelected: false },
  { key: "on_medicaid", label: "On Medicaid", group: "Medical", defaultSelected: false },
  { key: "medicaid_number", label: "Medicaid Number", group: "Medical", defaultSelected: false },
  { key: "medicaid_provider", label: "Medicaid Provider", group: "Medical", defaultSelected: false },
  // Pickup & safety
  { key: "approved_pickup_adults", label: "Approved Pickup Adults", group: "Pickup & safety", defaultSelected: false },
  { key: "prohibited_adults", label: "Prohibited Adults", group: "Pickup & safety", defaultSelected: false },
  // Documents
  { key: "doc_birth_certificate", label: "Birth Certificate", group: "Documents", defaultSelected: false },
  { key: "doc_school_health_form", label: "School Health Form", group: "Documents", defaultSelected: false },
  { key: "doc_transcripts", label: "Transcripts", group: "Documents", defaultSelected: false },
  { key: "doc_immunization", label: "Immunization Forms", group: "Documents", defaultSelected: false },
  // Testing
  { key: "nwea_math", label: "NWEA Math", group: "Testing", defaultSelected: false },
  { key: "nwea_reading", label: "NWEA Reading", group: "Testing", defaultSelected: false },
  { key: "nwea_math_date", label: "NWEA Math Date", group: "Testing", defaultSelected: false },
  { key: "nwea_reading_date", label: "NWEA Reading Date", group: "Testing", defaultSelected: false },
];

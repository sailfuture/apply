/**
 * Zod schemas that define what "complete" means for each apply-flow section.
 *
 * These schemas are the single source of truth for completion and validation.
 * The client reads them to render the "X of Y" sidenav counts and the
 * "missing items" panels; the server runs them on PATCH / Submit as a final gate.
 *
 * Each section exports:
 *   - `*Schema`        a Zod schema shaped like the canonical record
 *   - `*Requirements`  a stable, ordered list of { key, label, jumpTo } entries used
 *                      by the UI to render checklists and missing-items panels
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Requirement metadata — drives the missing-items panel UI
// ---------------------------------------------------------------------------

export interface Requirement {
  /** dot.path on the section record, e.g. "parents[0].email" */
  key: string;
  /** Human-readable field label */
  label: string;
  /** Optional anchor / query param for jump-to-field deep links */
  jumpTo?: string;
}

// ---------------------------------------------------------------------------
// Family section — parents must each have all contact + address fields
// ---------------------------------------------------------------------------

// Treat null/undefined as empty strings so Zod's error messages stay human-readable
// ("First name is required") instead of "Expected string, received null".
const requiredString = (message: string) =>
  z.preprocess((v) => (v == null ? "" : v), z.string().min(1, message));

const requiredEmail = (message: string) =>
  z.preprocess((v) => (v == null ? "" : v), z.string().min(1, message).email("Must be a valid email"));

export const parentSchema = z.object({
  first_name: requiredString("First name is required"),
  last_name: requiredString("Last name is required"),
  email: requiredEmail("Email is required"),
  phone: requiredString("Phone is required"),
  relationship: requiredString("Relationship is required"),
  address_line_1: requiredString("Street address is required"),
  city: requiredString("City is required"),
  state: requiredString("State is required"),
  zipcode: requiredString("Zip code is required"),
});

export const familySchema = z.object({
  parents: z.array(parentSchema).min(1, "At least one parent/guardian is required"),
});

/** Returns a Requirement[] enumerating every missing field across all parents. */
export function familyRequirements(parents: unknown[]): Requirement[] {
  const reqs: Requirement[] = [];
  parents.forEach((p, i) => {
    const result = parentSchema.safeParse(p);
    if (result.success) return;
    const name = (() => {
      const parent = p as { first_name?: string; last_name?: string } | undefined;
      const fn = parent?.first_name ?? "";
      const ln = parent?.last_name ?? "";
      const full = `${fn} ${ln}`.trim();
      return full || `Parent ${i + 1}`;
    })();
    for (const issue of result.error.issues) {
      reqs.push({
        key: `parents[${i}].${String(issue.path[0])}`,
        label: `${name}: ${issue.message}`,
        jumpTo: `#parent-${i}`,
      });
    }
  });
  return reqs;
}

// ---------------------------------------------------------------------------
// Student Details section — per-application school-history fields
// ---------------------------------------------------------------------------

export const studentApplicationSchema = z.object({
  current_previous_school: requiredString("Current / previous school is required"),
  last_grade_completed: requiredString("Current grade is required"),
  current_grade: requiredString("Incoming grade is required"),
  describe_student_strengths: requiredString("Student strengths are required"),
  describe_student_opportunities_for_growth: requiredString("Opportunities for growth are required"),
});

export const studentDetailsSchema = z.object({
  applications: z.array(studentApplicationSchema).min(1, "At least one student is required"),
});

export function studentDetailsRequirements(
  applications: { id?: number; registration_students_id?: number }[],
  studentLookup: (id: number) => { first_name?: string; last_name?: string } | undefined
): Requirement[] {
  const reqs: Requirement[] = [];
  applications.forEach((a, i) => {
    const result = studentApplicationSchema.safeParse(a);
    if (result.success) return;
    const student = a.registration_students_id ? studentLookup(a.registration_students_id) : undefined;
    const name = student ? `${student.first_name ?? ""} ${student.last_name ?? ""}`.trim() : `Student ${i + 1}`;
    for (const issue of result.error.issues) {
      reqs.push({
        key: `applications[${i}].${String(issue.path[0])}`,
        label: `${name}: ${issue.message}`,
        jumpTo: `#student-${a.registration_students_id}-${String(issue.path[0])}`,
      });
    }
  });
  return reqs;
}

// ---------------------------------------------------------------------------
// Financial Aid section — SUFS (per student) + Opportunity Scholarship (family)
// ---------------------------------------------------------------------------

/** Per-student SUFS Award ID — 9-digit numeric code. */
export const sufsApplicationSchema = z.object({
  sufs_award_id: z
    .number()
    .int()
    .min(1, "SUFS Award ID is required")
    .max(999_999_999, "SUFS Award ID must be at most 9 digits"),
});

export const opportunityScholarshipSchema = z.discriminatedUnion("path", [
  z.object({
    path: z.literal("none"),
    isNotParticipating: z.literal(true),
  }),
  z.object({
    path: z.literal("snap"),
    isSNAPBenefits: z.literal(true),
    snap_benefits: z.array(z.unknown()).min(1, "At least one SNAP award letter must be uploaded"),
  }),
  z.object({
    path: z.literal("full"),
    isOpportunityScholarship: z.literal(true),
    household_adults: z.number().int().min(1, "Number of adults in household is required"),
    household_children: z.number().int().min(1, "Number of children in household is required"),
    family_contribution_per_month: z
      .number()
      .min(1, "Family contribution per month is required"),
    scholarship_advocacy_letter: z
      .string()
      .min(1, "Scholarship advocacy letter is required"),
    signature: z.record(z.string(), z.unknown()).refine((v) => Object.keys(v).length > 0, {
      message: "Signature is required",
    }),
  }),
]);

export const financialAidSchema = z.object({
  sufs_applications: z.array(sufsApplicationSchema).min(1, "At least one student is required"),
  opportunity_scholarship: opportunityScholarshipSchema,
});

export function financialAidRequirements(input: {
  applications: { id: number; registration_students_id: number; sufs_award_id?: number }[];
  studentLookup: (id: number) => { first_name?: string; last_name?: string } | undefined;
  opportunity: unknown;
}): Requirement[] {
  const reqs: Requirement[] = [];

  // SUFS — check each enrolled student
  input.applications.forEach((a) => {
    const result = sufsApplicationSchema.safeParse(a);
    if (result.success) return;
    const s = input.studentLookup(a.registration_students_id);
    const name = s ? `${s.first_name ?? ""} ${s.last_name ?? ""}`.trim() : "Student";
    reqs.push({
      key: `sufs.${a.id}.sufs_award_id`,
      label: `${name}: SUFS Award ID is required (9 digits)`,
      jumpTo: `#sufs-${a.id}`,
    });
  });

  // Opportunity Scholarship — validate the chosen path
  const osResult = opportunityScholarshipSchema.safeParse(input.opportunity);
  if (!osResult.success) {
    for (const issue of osResult.error.issues) {
      reqs.push({
        key: `opportunity.${issue.path.join(".")}`,
        label: `Opportunity Scholarship: ${issue.message}`,
        jumpTo: `#opportunity-${String(issue.path[issue.path.length - 1] ?? "start")}`,
      });
    }
  }

  return reqs;
}

// ---------------------------------------------------------------------------
// Emergency Contact + Registration sections — used by the registration page
// ---------------------------------------------------------------------------

export const emergencyContactSchema = z.object({
  first_name: requiredString("First name is required"),
  last_name: requiredString("Last name is required"),
  email: requiredEmail("Email is required"),
  phone: requiredString("Phone is required"),
  relationship: requiredString("Relationship is required"),
  address_line_1: requiredString("Street address is required"),
  city: requiredString("City is required"),
  state: requiredString("State is required"),
  zipcode: requiredString("Zip code is required"),
});

export const registrationSchema = z.object({
  parents: z.array(parentSchema).min(1),
  emergency_contacts: z.array(emergencyContactSchema).min(1, "At least one emergency contact is required"),
});

// ---------------------------------------------------------------------------
// Top-level submit check — every section must pass its schema
// ---------------------------------------------------------------------------

export type SectionKey = "family" | "students" | "financial_aid";

export interface SectionCheckResult {
  section: SectionKey;
  complete: boolean;
  total: number;
  missing: Requirement[];
}

export interface SubmitReadiness {
  ready: boolean;
  sections: SectionCheckResult[];
}

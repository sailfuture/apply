/**
 * What a student needs before a Toddle sync will work — and what it
 * needs before the resulting Toddle profile is actually complete.
 *
 * The field rules live HERE and `lib/toddle-sync.ts` imports them, so
 * the checklist an admin reads and the values the sync actually pushes
 * can never drift apart. A readiness report that says "phone will be
 * pushed" while the sync silently drops it is worse than no report.
 *
 * Deliberately pure: no Toddle calls, no Xano calls. Toddle rate-limits
 * hard (see `lib/toddle-sync.ts`), so a roster-wide pre-flight has to
 * be answerable from data we already hold.
 */

import type { XanoParent, XanoSchoolYear, XanoStudent } from "@/lib/xano";

/* ── Field-level rules, shared with the sync ─────────────────────── */

/** Toddle wants `YYYY-MM-DD`; anything else is omitted from the push. */
export function toddleDob(raw: string | null | undefined): string | undefined {
  const value = (raw ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : undefined;
}

/** Toddle's enum is M/F/X; we only map the two values our forms
 *  collect, so "Non-binary" / "Prefer not to say" are not pushed. */
export function toddleGender(
  raw: string | null | undefined
): "M" | "F" | undefined {
  if (raw === "Male") return "M";
  if (raw === "Female") return "F";
  return undefined;
}

/** Canonical 10-digit US digits only — Toddle rejects anything else. */
export function toddlePhone(
  raw: string | null | undefined
): string | undefined {
  const value = (raw ?? "").trim();
  return /^\d{10}$/.test(value) ? value : undefined;
}

/** Any string carrying an "@". Used for the student's school email
 *  (their Toddle login) and for family-member accounts. */
export function toddleEmail(
  raw: string | null | undefined
): string | undefined {
  const value = (raw ?? "").trim();
  return /@/.test(value) ? value : undefined;
}

/** Start date of the school year the student first enrolled in —
 *  becomes Toddle's enrollment date. */
export function toddleEnrollmentDate(
  year: XanoSchoolYear | null | undefined
): string | undefined {
  const value = (year?.start_date ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : undefined;
}

/* ── Readiness report ────────────────────────────────────────────── */

export type ToddleFieldStatus = "ok" | "missing" | "not_pushed";

export interface ToddleReadinessField {
  /** Stable key so the UI can link to the card that fixes it. */
  key: string;
  label: string;
  status: ToddleFieldStatus;
  /** `blocking` fields stop the sync outright; `profile` fields just
   *  leave the Toddle record thinner than it should be. */
  severity: "blocking" | "profile";
  /** Why it isn't usable, or what it feeds — one short sentence. */
  detail: string;
  /** Where an admin fixes it. */
  fixedOn: string;
}

export interface ToddleReadiness {
  student_id: number;
  student_name: string;
  /** True when a sync run right now would succeed. */
  ready: boolean;
  /** Set when `ready` is false — the single reason to show. */
  blockedReason: string | null;
  /** Already linked to a Toddle record (so a missing grade level no
   *  longer blocks: grade is only required to CREATE). */
  linked: boolean;
  fields: ToddleReadinessField[];
}

export interface ToddleReadinessInput {
  student: XanoStudent;
  /** The year's registration packet — grade level + crew. */
  packet?: { grade_level?: string; crew_assignment?: string } | null;
  /** Incoming grade off the application, the fallback the sync uses
   *  when the packet has no placement grade yet. */
  applicationGrade?: string | null;
  /** The family's contacts, primary first (lowest id), as the sync
   *  orders them. */
  parents?: XanoParent[];
  /** School years, for resolving the enrollment date. */
  years?: XanoSchoolYear[];
}

/**
 * Evaluate one student against everything the sync needs.
 *
 * Blocking rules mirror `syncStudentToToddle` exactly:
 *   - first + last name, always
 *   - a grade level that carries a number, but ONLY when the student
 *     has no Toddle record yet (`toddle_student_id`), because the
 *     year group is required to create and ignored to update
 *
 * Everything else is `profile` severity: the sync succeeds without it
 * and simply pushes less.
 */
export function evaluateToddleReadiness(
  input: ToddleReadinessInput
): ToddleReadiness {
  const { student, packet, applicationGrade, parents = [], years = [] } = input;
  const fields: ToddleReadinessField[] = [];

  const firstName = (student.first_name ?? "").trim();
  const lastName = (student.last_name ?? "").trim();
  const linked = Boolean((student.toddle_student_id ?? "").trim());

  fields.push({
    key: "name",
    label: "First + last name",
    status: firstName && lastName ? "ok" : "missing",
    severity: "blocking",
    detail: "Toddle can't create or match a student without both.",
    fixedOn: "Student Information card",
  });

  // Grade level: the sync prefers the packet's placement grade and
  // falls back to the application's incoming grade. It must contain a
  // number, or the year-group lookup has nothing to match on (an
  // explicit TODDLE_YEAR_GROUP_MAP entry can still rescue it, which is
  // why the copy says "usually").
  const gradeLabel =
    (packet?.grade_level ?? "").trim() || (applicationGrade ?? "").trim();
  const gradeUsable = /\d/.test(gradeLabel);
  fields.push({
    key: "grade_level",
    label: "Grade level",
    status: gradeUsable ? "ok" : linked ? "not_pushed" : "missing",
    severity: linked ? "profile" : "blocking",
    detail: linked
      ? "Already in Toddle, so their year group only updates when a grade is set."
      : "Required to create a Toddle student — it picks their year group.",
    fixedOn: "Placement card",
  });

  const email = toddleEmail(student.school_email);
  fields.push({
    key: "school_email",
    label: "School email",
    status: email ? "ok" : "missing",
    severity: "profile",
    detail: email
      ? "Becomes the student's Toddle sign-in."
      : "Without it the student has no Toddle sign-in — generate school accounts first.",
    fixedOn: "School Account card",
  });

  const dob = toddleDob(student.date_of_birth);
  fields.push({
    key: "date_of_birth",
    label: "Date of birth",
    status: dob ? "ok" : "missing",
    severity: "profile",
    detail: "Pushed to the Toddle profile; also disambiguates name matches.",
    fixedOn: "Student Information card",
  });

  const gender = toddleGender(student.gender);
  const genderRaw = (student.gender ?? "").trim();
  fields.push({
    key: "gender",
    label: "Gender",
    status: gender ? "ok" : genderRaw ? "not_pushed" : "missing",
    severity: "profile",
    detail: gender
      ? "Pushed as M/F."
      : genderRaw
        ? `Toddle only accepts Male or Female here, so "${genderRaw}" isn't pushed.`
        : "Not set, so nothing is pushed.",
    fixedOn: "Student Information card",
  });

  const phone = toddlePhone(student.student_phone);
  const phoneRaw = (student.student_phone ?? "").trim();
  fields.push({
    key: "student_phone",
    label: "Student phone",
    status: phone ? "ok" : phoneRaw ? "not_pushed" : "missing",
    severity: "profile",
    detail: phone
      ? "Pushed to the Toddle profile."
      : phoneRaw
        ? "Needs to be 10 digits, so it isn't pushed."
        : "Optional — nothing is pushed when it's blank.",
    fixedOn: "Student Information card",
  });

  const enrollmentYear =
    years.find((y) => y.id === Number(student.enrollment_school_years_id)) ??
    null;
  const enrollmentDate = toddleEnrollmentDate(enrollmentYear);
  fields.push({
    key: "enrollment_school_years_id",
    label: "Enrollment year",
    status: enrollmentDate ? "ok" : "missing",
    severity: "profile",
    detail: enrollmentDate
      ? "Sets Toddle's enrollment date from the year's start date."
      : enrollmentYear
        ? "The selected year has no start date, so no enrollment date is pushed."
        : "Not set, so Toddle gets no enrollment date.",
    fixedOn: "School Account card",
  });

  const primary = parents[0] ?? null;
  const hasAddress = Boolean((primary?.address_line_1 ?? "").trim());
  fields.push({
    key: "home_address",
    label: "Home address",
    status: hasAddress ? "ok" : "missing",
    severity: "profile",
    detail: hasAddress
      ? "Taken from the primary contact."
      : "The primary contact has no street address on file.",
    fixedOn: "Family contact record",
  });

  const contactCount = parents.filter(
    (p) => (p.first_name ?? "").trim() && (p.last_name ?? "").trim()
  ).length;
  fields.push({
    key: "family_contacts",
    label: "Family contacts",
    status: contactCount > 0 ? "ok" : "missing",
    severity: "profile",
    detail:
      contactCount > 0
        ? `${contactCount} contact${contactCount === 1 ? "" : "s"} become Toddle family members.`
        : "No contact has both a first and last name, so none can be pushed.",
    fixedOn: "Family contact records",
  });

  const hasPhoto = Boolean(student.student_photo);
  fields.push({
    key: "student_photo",
    label: "Student photo",
    status: hasPhoto ? "ok" : "missing",
    severity: "profile",
    detail: hasPhoto
      ? "Uploaded onto the Toddle profile."
      : "No photo on file, so the Toddle profile stays blank.",
    fixedOn: "Student Photo card",
  });

  const crew = (packet?.crew_assignment ?? "").trim();
  fields.push({
    key: "crew_assignment",
    label: "Crew",
    status: crew ? "ok" : "missing",
    severity: "profile",
    detail: crew
      ? `Placed in the ${crew} Toddle class.`
      : "No crew set, so the student joins no Toddle class.",
    fixedOn: "Placement card",
  });

  const blocking = fields.filter(
    (f) => f.severity === "blocking" && f.status !== "ok"
  );
  return {
    student_id: student.id,
    student_name: `${firstName} ${lastName}`.trim() || `Student #${student.id}`,
    ready: blocking.length === 0,
    blockedReason:
      blocking.length === 0
        ? null
        : blocking.map((f) => `${f.label}: ${f.detail}`).join(" "),
    linked,
    fields,
  };
}

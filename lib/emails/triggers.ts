/**
 * High-level "fire email X" entry points the API routes call from
 * their status-change paths. Each function:
 *
 *   1. Resolves the family + its parents (To: addresses) and the
 *      affected student name(s) (template variable).
 *   2. Builds the template context, renders the template, and hands
 *      it to `sendEmail`.
 *   3. Swallows errors. The caller's PATCH/POST has already done the
 *      important work — a failed notification shouldn't bubble up
 *      and surface as a 500 to the parent.
 *
 * All triggers are best-effort. Failures log with the template tag
 * so we can grep production for `[email/<tag>] threw:` to triage.
 */

import { xano } from "@/lib/xano";
import type { XanoFamily, XanoParent, XanoStudent } from "@/lib/xano";
import { sendEmail, type SendResult } from "./send";
import * as t from "./templates";

/* ────────────────────────── Context resolution ────────────────────────── */

interface FamilyContext {
  /** Lowercased, dedup'd parent emails. To: list. Sorted with the
   *  primary parent first so the email's `parent_first_name` matches
   *  the first recipient. */
  parentEmails: string[];
  /** First name of the primary parent (lowest-id parent on the
   *  family). Used in the salutation. */
  primaryParentFirstName: string;
  /** Joined first names of the active students whose names should
   *  appear in the message. Family-level events get all active
   *  students; per-application events pass the specific student. */
  studentDisplayNames: string;
  /** Names of students for per-student emails (when caller wants
   *  one email per student). */
  individualStudents: Array<{ id: number; firstName: string }>;
  /** Login URL for the CTA button. Routes through the root path so
   *  the dashboard's stage detector lands the parent on the right
   *  step (apply / registration / dashboard). */
  loginUrl: string;
  /** Raw rows in case a caller needs more than the cooked context. */
  family: XanoFamily;
  parents: XanoParent[];
  students: XanoStudent[];
}

/** Pick the primary parent — lowest id wins, matches the convention
 *  used in `app/api/admin/enrolled/route.ts` and other surfaces that
 *  pick a single "primary" contact from a family's parent list. */
function pickPrimaryParent(parents: XanoParent[]): XanoParent | null {
  if (parents.length === 0) return null;
  return [...parents].sort((a, b) => a.id - b.id)[0];
}

/** Format ["Sam"] → "Sam"; ["Sam", "Jane"] → "Sam and Jane";
 *  ["Sam", "Jane", "Jack"] → "Sam, Jane, and Jack". Falls back to
 *  "your student" if the list is empty so the email still reads. */
function joinStudentNames(names: string[]): string {
  const clean = names.map((n) => n.trim()).filter(Boolean);
  if (clean.length === 0) return "your student";
  if (clean.length === 1) return clean[0];
  if (clean.length === 2) return `${clean[0]} and ${clean[1]}`;
  return `${clean.slice(0, -1).join(", ")}, and ${clean[clean.length - 1]}`;
}

function getLoginUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "https://apply.sailfuture.org";
}

/** Resolve the To-list + display variables for an entire family.
 *  Used by the family-level event triggers (1, 3, 4, 6, 11). Returns
 *  null if the family can't be loaded — caller logs and bails. */
export async function resolveFamilyContext(
  familyId: number,
  yearId?: number
): Promise<FamilyContext | null> {
  try {
    const family = await xano.families.getById(familyId);
    const parentIds = xano.families.getParentIds(family);
    const parents = parentIds.length
      ? await Promise.all(parentIds.map((id) => xano.parents.getById(id)))
      : [];
    const allStudents = await xano.students.getByFamilyId(familyId);

    // Filter to students relevant to this year — anyone with an
    // active application for the year. Falls back to "all
    // non-archived students" if year filtering can't run (e.g.
    // family-level events not scoped to a year).
    let students = allStudents.filter((s) => s.isArchived !== true);
    if (yearId) {
      try {
        const apps = await xano.applications.getByFamilyId(familyId);
        const idsForYear = new Set(
          apps
            .filter(
              (a) =>
                Number(a.registration_school_years_id) === yearId &&
                a.isActive !== false
            )
            .map((a) => Number(a.registration_students_id))
        );
        const yearScoped = students.filter((s) => idsForYear.has(s.id));
        if (yearScoped.length > 0) students = yearScoped;
      } catch {
        // Year-scoping failed — keep the full active-student list.
      }
    }

    const sortedParents = [...parents].sort((a, b) => a.id - b.id);
    const primary = pickPrimaryParent(parents);
    const parentEmails = sortedParents
      .map((p) => p.email)
      .filter((e): e is string => typeof e === "string" && e.length > 0);

    return {
      family,
      parents: sortedParents,
      students,
      parentEmails,
      primaryParentFirstName: primary?.first_name?.trim() || "there",
      studentDisplayNames: joinStudentNames(
        students.map((s) => s.first_name)
      ),
      individualStudents: students.map((s) => ({
        id: s.id,
        firstName: s.first_name?.trim() || "your student",
      })),
      loginUrl: getLoginUrl(),
    };
  } catch (err) {
    console.error(
      `[email/resolveFamilyContext] failed for family=${familyId}:`,
      err
    );
    return null;
  }
}

/** Resolve context for a single application — primary parent stays
 *  the family's primary, but `studentDisplayNames` is just that
 *  application's student. Used by the per-application denial trigger
 *  so multi-student families get one email per student status flip. */
async function resolveApplicationContext(
  applicationId: number
): Promise<FamilyContext | null> {
  try {
    const app = await xano.applications.getById(applicationId);
    const familyId = Number(app.registration_families_id);
    const yearId = Number(app.registration_school_years_id);
    const ctx = await resolveFamilyContext(familyId, yearId);
    if (!ctx) return null;

    // Override the student display to the specific application's
    // student. If the student isn't in the year-filtered list
    // (shouldn't happen, but defensive), look them up directly.
    const studentId = Number(app.registration_students_id);
    let studentFirstName = ctx.individualStudents.find(
      (s) => s.id === studentId
    )?.firstName;
    if (!studentFirstName) {
      try {
        const student = await xano.students.getById(studentId);
        studentFirstName = student.first_name?.trim() || "your student";
      } catch {
        studentFirstName = "your student";
      }
    }
    return {
      ...ctx,
      studentDisplayNames: studentFirstName,
    };
  } catch (err) {
    console.error(
      `[email/resolveApplicationContext] failed for application=${applicationId}:`,
      err
    );
    return null;
  }
}

/* ────────────────────────── Event triggers ────────────────────────── */

/** Email 1: parent submitted their application. Fires from PATCH
 *  /api/family-progress when `isSubmitted` transitions false→true. */
export async function sendApplicationReceivedEmail(
  familyId: number,
  yearId: number
): Promise<SendResult> {
  const ctx = await resolveFamilyContext(familyId, yearId);
  if (!ctx) return { ok: false, error: "context-failed" };
  return sendEmail({
    to: ctx.parentEmails,
    content: t.applicationReceived({
      parent_first_name: ctx.primaryParentFirstName,
      student_first_name: ctx.studentDisplayNames,
      login_url: ctx.loginUrl,
    }),
    tag: "application-received",
  });
}

/** Email 2: admin accepted the family. Fires from PATCH
 *  /api/admin/family-progress when `isAccepted` transitions
 *  false→true. */
export async function sendAcceptanceEmail(
  familyId: number,
  yearId: number
): Promise<SendResult> {
  const ctx = await resolveFamilyContext(familyId, yearId);
  if (!ctx) return { ok: false, error: "context-failed" };
  return sendEmail({
    to: ctx.parentEmails,
    content: t.accepted({
      parent_first_name: ctx.primaryParentFirstName,
      student_first_name: ctx.studentDisplayNames,
      login_url: ctx.loginUrl,
    }),
    tag: "accepted",
  });
}

/** Email 3: parent submitted the registration packet. Fires from
 *  PATCH /api/student-registration-progress when all four section
 *  bools (tuition / enrollment / registration / volunteer hours)
 *  transition to true (matches the existing `submitted_date`
 *  stamping logic). */
export async function sendRegistrationReceivedEmail(
  familyId: number,
  yearId: number
): Promise<SendResult> {
  const ctx = await resolveFamilyContext(familyId, yearId);
  if (!ctx) return { ok: false, error: "context-failed" };
  return sendEmail({
    to: ctx.parentEmails,
    content: t.registrationReceived({
      parent_first_name: ctx.primaryParentFirstName,
      student_first_name: ctx.studentDisplayNames,
      login_url: ctx.loginUrl,
    }),
    tag: "registration-received",
  });
}

/** Email 4: admin confirmed registration → student is officially
 *  enrolled. Fires from PATCH /api/admin/registration-progress when
 *  `isRegistrationConfirmed` transitions false→true. */
export async function sendEnrolledEmail(
  familyId: number,
  yearId: number
): Promise<SendResult> {
  const ctx = await resolveFamilyContext(familyId, yearId);
  if (!ctx) return { ok: false, error: "context-failed" };
  return sendEmail({
    to: ctx.parentEmails,
    content: t.enrolled({
      parent_first_name: ctx.primaryParentFirstName,
      student_first_name: ctx.studentDisplayNames,
      login_url: ctx.loginUrl,
    }),
    tag: "enrolled",
  });
}

/** Email 8: admin denied a single application. Per-application
 *  rather than family-level — a family with multiple kids could have
 *  one accepted and one denied, and we want each parent message to
 *  reference the specific student. Fires from PATCH
 *  /api/admin/applications/[id] when `isDenied` transitions
 *  false→true. */
export async function sendNotAcceptedEmail(
  applicationId: number
): Promise<SendResult> {
  const ctx = await resolveApplicationContext(applicationId);
  if (!ctx) return { ok: false, error: "context-failed" };
  return sendEmail({
    to: ctx.parentEmails,
    content: t.notAccepted({
      parent_first_name: ctx.primaryParentFirstName,
      student_first_name: ctx.studentDisplayNames,
      login_url: ctx.loginUrl,
    }),
    tag: "not-accepted",
  });
}

/* ────────────────────────── Scheduled triggers ────────────────────────── */

/** Email 5: draft reminder (cron). The cron route decides which
 *  families qualify; this function just sends. */
export async function sendDraftReminderEmail(
  familyId: number,
  yearId: number
): Promise<SendResult> {
  const ctx = await resolveFamilyContext(familyId, yearId);
  if (!ctx) return { ok: false, error: "context-failed" };
  return sendEmail({
    to: ctx.parentEmails,
    content: t.draftReminder({
      parent_first_name: ctx.primaryParentFirstName,
      student_first_name: ctx.studentDisplayNames,
      login_url: ctx.loginUrl,
    }),
    tag: "draft-reminder",
  });
}

/** Email 6: enrollment agreement reminder (cron). */
export async function sendEnrollmentReminderEmail(
  familyId: number,
  yearId: number
): Promise<SendResult> {
  const ctx = await resolveFamilyContext(familyId, yearId);
  if (!ctx) return { ok: false, error: "context-failed" };
  return sendEmail({
    to: ctx.parentEmails,
    content: t.enrollmentAgreementReminder({
      parent_first_name: ctx.primaryParentFirstName,
      student_first_name: ctx.studentDisplayNames,
      login_url: ctx.loginUrl,
    }),
    tag: "enrollment-reminder",
  });
}

/** Email 11: back-to-school welcome (cron). Sent 1-2 weeks before
 *  August 24th to every enrolled family. */
export async function sendBackToSchoolEmail(
  familyId: number,
  yearId: number
): Promise<SendResult> {
  const ctx = await resolveFamilyContext(familyId, yearId);
  if (!ctx) return { ok: false, error: "context-failed" };
  return sendEmail({
    to: ctx.parentEmails,
    content: t.backToSchool({
      parent_first_name: ctx.primaryParentFirstName,
      student_first_name: ctx.studentDisplayNames,
      login_url: ctx.loginUrl,
    }),
    tag: "back-to-school",
  });
}

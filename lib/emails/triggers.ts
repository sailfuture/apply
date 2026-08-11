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
  /** Scope for the email-notifications audit log. `familyId` is
   *  always set; `yearId` is set when the originating event is
   *  year-scoped (which is all current triggers — left optional on
   *  the type for forward-compat with future global notifications). */
  familyId: number;
  yearId?: number;
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
  return process.env.NEXT_PUBLIC_APP_URL ?? "https://apply.sailfutureacademy.org";
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
      familyId,
      yearId,
    };
  } catch (err) {
    console.error(
      `[email/resolveFamilyContext] failed for family=${familyId}:`,
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
    familyId: ctx.familyId,
    yearId: ctx.yearId,
  });
}

/** Email 2: admin accepted the family. Fires from PATCH
 *  /api/admin/family-progress when `isAccepted` transitions
 *  false→true.
 *
 *  Once-per-family-year: the audit log is the source of truth.
 *  If a prior `accepted` send for this (family, year) already
 *  landed as `status="sent"`, we skip — this dedupes the case
 *  where admin clicks Undo and then Accept again (each toggle
 *  re-trips the `false → true` PATCH guard, but the family has
 *  already received the email). Failed sends are NOT counted so
 *  a transient Resend error can be retried by a re-Accept. Dev
 *  `dry_run` rows are also ignored so contributors can iterate
 *  without `RESEND_API_KEY` set. */
export async function sendAcceptanceEmail(
  familyId: number,
  yearId: number
): Promise<SendResult> {
  const alreadySent = await hasAlreadySentEmail({
    familyId,
    yearId,
    template: "accepted",
  });
  if (alreadySent) {
    console.log(
      `[email/accepted] dedupe — family=${familyId} year=${yearId} already received the acceptance email`
    );
    return { ok: true, id: "deduped" };
  }
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
    familyId: ctx.familyId,
    yearId: ctx.yearId,
  });
}

/** Audit-log dedupe — returns true when there's a successful
 *  prior send for the (family, year, template) tuple. Used by
 *  triggers that need once-per-family-year semantics. Failures
 *  (Xano down, table missing) coerce to `false` so the email
 *  still fires; better to risk a duplicate than to silently
 *  swallow a legitimate send because we couldn't read the log. */
async function hasAlreadySentEmail({
  familyId,
  yearId,
  template,
}: {
  familyId: number;
  yearId: number;
  template: string;
}): Promise<boolean> {
  try {
    const rows = await xano.emailNotifications.getByFamily(familyId, yearId);
    return rows.some(
      (r) => r.template === template && r.status === "sent"
    );
  } catch (err) {
    console.error(
      `[email/${template}] dedupe lookup failed for family=${familyId} year=${yearId}:`,
      err
    );
    return false;
  }
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
    familyId: ctx.familyId,
    yearId: ctx.yearId,
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
    familyId: ctx.familyId,
    yearId: ctx.yearId,
  });
}

// Email 8 (not-accepted) was removed 2026-08-11: its trigger fired on
// a per-application isDenied transition, but that column never existed
// in Xano and no Deny UI remains — declining a family is Archive /
// Return Application, neither of which emails. Removed at the user's
// direction rather than rewired.

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
    familyId: ctx.familyId,
    yearId: ctx.yearId,
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
    familyId: ctx.familyId,
    yearId: ctx.yearId,
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
    familyId: ctx.familyId,
    yearId: ctx.yearId,
  });
}

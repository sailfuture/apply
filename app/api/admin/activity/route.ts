import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";

/**
 * Unified per-family activity stream for the admin Activity sheet.
 *
 *   GET /api/admin/activity?familyId=X&yearId=Y  →  ActivityResponse
 *
 * One time-sorted feed merging three sources — NO dedicated event
 * table; everything is derived from data the app already stores:
 *
 *   - notes  — `registration_admin_notes` (comments, logged calls /
 *              emails / in-person conversations; the `category`
 *              column already distinguishes them)
 *   - sms    — `sms_messages` (real two-way texts, family-scoped)
 *   - system — derived from the audit stamps the routes already
 *              write: application submitted/accepted + section
 *              verifies, registration packet submitted/confirmed,
 *              enrollment agreement + liability waivers sent,
 *              document approvals, the SUFS pipeline (request sent /
 *              parent confirmed / quarterly payments), crew changes,
 *              unenrollment, and Stripe invoice sent/paid from the
 *              payment-transactions mirror.
 *
 * Because system events come from audit stamps, each milestone shows
 * its LATEST occurrence (re-flipping a checkbox re-dates the event) —
 * an accepted tradeoff for a zero-migration stream. If true toggle
 * history is ever needed, a dedicated event table can be layered in
 * without changing the response shape.
 *
 * Scope mapping feeds the sheet's filter pills:
 *   application  — apply-flow milestones + apply-phase notes
 *   registration — packet/docs/agreement milestones + reg-phase notes
 *   sufs         — Step Up pipeline milestones + `section:"sufs"` notes
 *   enrollment   — billing invoices, crew changes, unenrollment
 *   general      — untagged notes
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const familyId = Number(req.nextUrl.searchParams.get("familyId"));
    const yearId = Number(req.nextUrl.searchParams.get("yearId"));
    if (!Number.isFinite(familyId) || familyId <= 0) {
      return NextResponse.json(
        { error: "familyId is required" },
        { status: 400 }
      );
    }
    if (!Number.isFinite(yearId) || yearId <= 0) {
      return NextResponse.json(
        { error: "yearId is required" },
        { status: 400 }
      );
    }

    const [
      notesResult,
      smsResult,
      emailsResult,
      appProgressResult,
      regProgressResult,
      packetsResult,
      studentsResult,
      transactionsResult,
      familyResult,
      appointmentsResult,
    ] = await Promise.allSettled([
      xano.adminNotes.getByFamilyId(familyId),
      xano.smsMessages.getByFamilyId(familyId),
      // Resend audit rows — `sendEmail` writes one per send (sent /
      // failed / dry_run) with the template tag + subject.
      xano.emailNotifications.getByFamily(familyId),
      xano.familyApplicationProgress.getByFamilyAndYear(familyId, yearId),
      xano.studentRegistrationProgress.getByFamilyAndYear(familyId, yearId),
      xano.studentRegistration.getByYear(yearId),
      xano.students.getByFamilyId(familyId),
      xano.paymentTransactions.getByFamilyAndYear(familyId, yearId),
      xano.families.getById(familyId).catch(() => null),
      // Google Calendar appointments mirrored by the calendar-sync
      // cron — [] until the table exists.
      xano.googleAppointments.getAll().catch(() => []),
    ]);

    const val = <T,>(r: PromiseSettledResult<T>, fallback: T): T =>
      r.status === "fulfilled" ? r.value : fallback;

    const notes = val(notesResult, []);
    const sms = val(smsResult, []);
    const emails = val(emailsResult, []);
    const appProgress = val(appProgressResult, null);
    const regProgress = val(regProgressResult, null);
    const allPackets = val(packetsResult, []);
    const students = val(studentsResult, []);
    const transactions = val(transactionsResult, []);
    const family = val(familyResult, null);
    const appointments = val(appointmentsResult, []).filter(
      (a) => Number(a.registration_families_id) === familyId
    );

    const studentIds = new Set(students.map((s) => s.id));
    const studentName = (id: number | null | undefined): string => {
      const s = students.find((x) => x.id === Number(id));
      return s ? `${s.first_name ?? ""} ${s.last_name ?? ""}`.trim() : "";
    };
    const packets = allPackets.filter((p) =>
      studentIds.has(Number(p.registration_students_id))
    );

    const events: ActivityEvent[] = [];
    const push = (
      e: Omit<ActivityEvent, "ts"> & {
        // Raw Xano timestamps arrive as ms numbers OR date strings
        // (e.g. `liability_waiver_sent_at`, `unenrollment_date`);
        // coerceTs normalizes and drops the unplaceable.
        ts: number | string | null | undefined;
      }
    ) => {
      const ts = coerceTs(e.ts);
      if (ts == null) return; // no timestamp → can't place on a timeline
      events.push({ ...e, ts });
    };

    // ── Notes ────────────────────────────────────────────────────────
    for (const n of notes) {
      // Family-wide notes (no year) always show; year-tagged notes
      // only for the requested year so switching years doesn't bleed.
      const nYear = Number(n.registration_school_years_id ?? 0);
      if (nYear > 0 && nYear !== yearId) continue;
      const scope: ActivityScope =
        typeof n.section === "string" && n.section.startsWith("sufs")
          ? "sufs"
          : n.registration_student_registration_progress_id
            ? "registration"
            : n.registration_family_application_progress_id ||
                n.reapply_family_progress_id
              ? "application"
              : "general";
      push({
        id: `note-${n.id}`,
        ts: n.created_at,
        kind: "note",
        scope,
        title: categoryLabel(n.category),
        body: n.body,
        author: n.author_name || n.author_email || "Admin",
        category: n.category,
        pinned: n.is_pinned === true,
        studentName: studentName(n.registration_students_id),
      });
    }

    // ── Texts ────────────────────────────────────────────────────────
    for (const m of sms) {
      // Group-blast rows carry template `group:<yearId>:<blastId>` —
      // surfaced so the stream distinguishes a blast from a 1:1 text.
      const isGroup =
        typeof m.template === "string" && m.template.startsWith("group");
      push({
        id: `sms-${m.id}`,
        ts: m.created_at,
        kind: "sms",
        scope: "general",
        title: isGroup ? "Group text" : "Text message",
        body: m.body,
        author:
          m.direction === "outbound"
            ? m.author_name ||
              (m.template && m.template !== "manual" && !isGroup
                ? "SailFuture (automated)"
                : "SailFuture")
            : family?.family_name?.trim() || "Family",
        direction: m.direction === "outbound" ? "outbound" : "inbound",
        status: m.status,
        isGroup,
      });
    }

    // ── Automated emails (Resend audit rows) ─────────────────────────
    for (const e of emails) {
      // Family-wide sends (no year) always show; year-tagged sends
      // only for the requested year — same rule as notes.
      const eYear = Number(e.registration_school_years_id ?? 0);
      if (eYear > 0 && eYear !== yearId) continue;
      // Local dry-run rows are dev noise, not real account history.
      if (e.status === "dry_run") continue;
      push({
        id: `email-${e.id}`,
        ts: e.created_at,
        kind: "email",
        scope: EMAIL_TEMPLATE_SCOPE[e.template] ?? "general",
        title:
          e.status === "failed" ? "Email failed to send" : "Email sent",
        body: e.subject,
        author: "SailFuture (automated)",
        status: e.status,
        // Lets the sheet's "View email" fetch the exact sent content
        // from Resend via /api/admin/email-preview.
        resendId: e.resend_id ?? undefined,
        // First-open stamp from the Resend webhook (open tracking) —
        // renders as "Viewed …" in the bubble footer.
        openedAt: e.opened_at ?? undefined,
        // Delivery note — a bounce that DIDN'T fail the send (one of
        // several recipients, or a transient one). Surfaced so a
        // partial failure isn't invisible just because the row is
        // still "sent".
        deliveryNote:
          e.status !== "failed" && e.error_message
            ? e.error_message
            : undefined,
      });
    }

    // ── Google Calendar appointments (calendar-sync mirror) ──────────
    for (const a of appointments) {
      const when = a.start_at
        ? new Date(Number(a.start_at)).toLocaleString("en-US", {
            weekday: "short",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
            timeZone: "America/New_York",
          })
        : "";
      push({
        id: `appt-${a.id}`,
        ts: a.created_at,
        kind: "system",
        scope: "general",
        title:
          a.status === "cancelled"
            ? "Appointment cancelled"
            : "Appointment booked",
        body: [a.title, when, a.location?.trim()]
          .filter(Boolean)
          .join(" · "),
        author: "Google Calendar",
      });
    }

    // ── Application milestones ───────────────────────────────────────
    if (appProgress) {
      push({
        id: `app-submitted-${appProgress.id}`,
        ts: appProgress.submitted_at,
        kind: "system",
        scope: "application",
        title: "Application submitted",
        body: "",
        author: "",
      });
      push({
        id: `app-accepted-${appProgress.id}`,
        ts: appProgress.accepted_at,
        kind: "system",
        scope: "application",
        title: "Application accepted",
        body: "",
        author: "",
      });
      const sections: Array<[string, number | null | undefined, string]> = [
        ["family", appProgress.family_admin_confirm_time, "Family section verified"],
        ["students", appProgress.students_admin_confirm_time, "Students section verified"],
        ["testing", appProgress.testing_admin_confirm_time, "Testing section verified"],
        ["finaid", appProgress.financial_aid_admin_confirm_time, "Financial Aid section verified"],
        ["scholarship", appProgress.scholarship_complete_admin_time, "Scholarship determination verified"],
      ];
      for (const [key, ts, title] of sections) {
        push({
          id: `app-${key}-${appProgress.id}`,
          ts,
          kind: "system",
          scope: "application",
          title,
          body: "",
          author: sectionAdmin(appProgress, key),
        });
      }
    }

    // ── Registration milestones (family-level) ───────────────────────
    if (regProgress) {
      push({
        id: `reg-submitted-${regProgress.id}`,
        ts: regProgress.submitted_date,
        kind: "system",
        scope: "registration",
        title: "Registration packet submitted",
        body: "",
        author: "",
      });
      push({
        id: `reg-confirmed-${regProgress.id}`,
        ts: regProgress.registration_confirmed_time,
        kind: "system",
        scope: "registration",
        title: "Family registration confirmed",
        body: "",
        author: regProgress.registration_confirmed_admin ?? "",
      });
      push({
        id: `reg-agreement-sent-${regProgress.id}`,
        ts: regProgress.enrollment_agreement_sent,
        kind: "system",
        scope: "registration",
        title: regProgress.is_enrollment_agreement_signed
          ? "Enrollment agreement sent (now signed)"
          : "Enrollment agreement sent",
        body: "",
        author: "",
      });
      const regSections: Array<[string, number | null | undefined, string, string]> = [
        ["tuition", regProgress.tuition_admin_confirm_time, "Tuition section verified", regProgress.tuition_admin_confirm_admin ?? ""],
        ["enrollment", regProgress.enrollment_admin_confirm_time, "Enrollment Agreement section verified", regProgress.enrollment_admin_confirm_admin ?? ""],
        ["volunteer", regProgress.volunteer_admin_confirm_time, "Volunteer Hours section verified", regProgress.volunteer_admin_confirm_admin ?? ""],
        ["emergency", regProgress.emergency_contacts_admin_confirm_time, "Emergency Contacts verified", regProgress.emergency_contacts_admin_confirm_admin ?? ""],
      ];
      for (const [key, ts, title, admin] of regSections) {
        push({
          id: `reg-${key}-${regProgress.id}`,
          ts,
          kind: "system",
          scope: "registration",
          title,
          body: "",
          author: admin,
        });
      }
    }

    // ── Per-student packet + document + SUFS milestones ──────────────
    for (const p of packets) {
      const sName = studentName(p.registration_students_id);
      push({
        id: `pkt-confirmed-${p.id}`,
        ts: p.registration_confirmed_admin_time,
        kind: "system",
        scope: "registration",
        title: "Student registration confirmed",
        body: "",
        author: "",
        studentName: sName,
      });
      push({
        id: `pkt-waiver-${p.id}`,
        ts: p.liability_waiver_sent_at,
        kind: "system",
        scope: "registration",
        title:
          p.liability_waiver_status === "completed"
            ? "Liability waiver sent (now signed)"
            : "Liability waiver sent",
        body: "",
        author: "",
        studentName: sName,
      });
      push({
        id: `pkt-crew-${p.id}`,
        ts: p.crew_assignment_change,
        kind: "system",
        scope: "enrollment",
        title: p.previous_crew_assignment
          ? `Crew changed: ${p.previous_crew_assignment} → ${p.crew_assignment || "—"}`
          : `Crew assigned: ${p.crew_assignment || "—"}`,
        body: "",
        author: "",
        studentName: sName,
      });
      // SUFS pipeline
      push({
        id: `sufs-request-${p.id}`,
        ts: p.sufs_enrollment_request_sent === true ? p.sufs_enrollment_request_time : null,
        kind: "system",
        scope: "sufs",
        title: "Step Up enrollment request sent",
        body: "",
        author: p.sufs_enrollment_request_by ?? "",
        studentName: sName,
      });
      push({
        id: `sufs-parent-${p.id}`,
        ts:
          p.sufs_parent_enrollment_confirmation === true
            ? p.sufs_parent_enrollment_request_time
            : null,
        kind: "system",
        scope: "sufs",
        title: "Parent Step Up enrollment confirmed",
        body: "",
        author: p.sufs_parent_enrollment_request_by ?? "",
        studentName: sName,
      });
      const quarters: Array<[number, boolean | undefined, number | null | undefined, string | undefined]> = [
        [1, p.sufs_q1_payment, p.sufs_q1_payment_confirmed, p.sufs_q1_payment_confirmed_by],
        [2, p.sufs_q2_payment, p.sufs_q2_payment_confirmed, p.sufs_q2_payment_confirmed_by],
        [3, p.sufs_q3_payment, p.sufs_q3_payment_confirmed, p.sufs_q3_payment_confirmed_by],
        [4, p.sufs_q4_payment, p.sufs_q4_payment_confirmed, p.sufs_q4_payment_confirmed_by],
      ];
      for (const [q, paid, ts, by] of quarters) {
        push({
          id: `sufs-q${q}-${p.id}`,
          ts: paid === true ? ts : null,
          kind: "system",
          scope: "sufs",
          title: `Q${q} Step Up payment confirmed`,
          body: "",
          author: by ?? "",
          studentName: sName,
        });
      }
      // Legacy inline SUFS note (pre-activity-sheet scratch field) —
      // shown as a note so the text isn't lost, anchored to the
      // packet's last edit since the column has no own timestamp.
      const legacyNote = (p.sufs_enrollment_request_notes ?? "").trim();
      if (legacyNote) {
        push({
          id: `sufs-legacynote-${p.id}`,
          ts: p.last_edited_time ?? p.created_at,
          kind: "note",
          scope: "sufs",
          title: "SUFS note (legacy)",
          body: legacyNote,
          author: "",
          category: "other",
          studentName: sName,
        });
      }
    }

    // ── Document approvals (evergreen student rows) ──────────────────
    for (const s of students) {
      const sName = `${s.first_name ?? ""} ${s.last_name ?? ""}`.trim();
      const docs: Array<[string, number | null | undefined, string, string]> = [
        ["imm", s.immunization_admin_confirm_time, "Immunization forms approved", s.immunization_admin_confirm_admin ?? ""],
        ["bc", s.birth_certificate_admin_confirm_time, "Birth certificate approved", s.birth_certificate_admin_confirm_admin ?? ""],
        ["shf", s.school_health_form_admin_confirm_time, "School health form approved", s.school_health_form_admin_confirm_admin ?? ""],
        ["tr", s.transcripts_admin_confirm_time, "Transcripts approved", s.transcripts_admin_confirm_admin ?? ""],
      ];
      for (const [key, ts, title, admin] of docs) {
        push({
          id: `doc-${key}-${s.id}`,
          ts,
          kind: "system",
          scope: "registration",
          title,
          body: "",
          author: admin,
          studentName: sName,
        });
      }
      push({
        id: `unenrolled-${s.id}`,
        ts: s.unenrollment_date,
        kind: "system",
        scope: "enrollment",
        title: "Student unenrolled",
        body: s.unenrollment_reason ?? "",
        author: "",
        studentName: sName,
      });
    }

    // ── Stripe invoices (payment-transactions mirror) ────────────────
    for (const t of transactions) {
      const dollars = ((t.amount_due_cents ?? 0) / 100).toLocaleString(
        "en-US",
        { style: "currency", currency: "USD" }
      );
      push({
        id: `inv-sent-${t.id}`,
        ts: t.finalized_at,
        kind: "system",
        scope: "enrollment",
        title: `Invoice sent — ${dollars}`,
        body: "",
        author: "",
      });
      if (t.status === "paid") {
        push({
          id: `inv-paid-${t.id}`,
          ts: t.paid_at,
          kind: "system",
          scope: "enrollment",
          title: `Invoice paid — ${dollars}`,
          body: "",
          author: "",
        });
      }
    }

    // Ascending — the sheet renders chat-style with newest at the
    // bottom and auto-scrolls to the end. Stable tie-break on id so
    // same-timestamp events don't shuffle between refetches.
    events.sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id));

    return NextResponse.json({
      events,
      familyName: family?.family_name?.trim() || `Family #${familyId}`,
    } satisfies ActivityResponse);
  } catch (err) {
    return handleAdminError(err);
  }
}

/** Section-verify admin display name off the apply progress row.
 *  Accessed via a string index because the column names don't follow
 *  one pattern (`scholarship_admin_complete_admin` vs
 *  `family_admin_confirm_admin`) and testing has no admin column. */
function sectionAdmin(p: object, key: string): string {
  const map: Record<string, string> = {
    family: "family_admin_confirm_admin",
    students: "students_admin_confirm_admin",
    finaid: "financial_aid_admin_confirm_admin",
    scholarship: "scholarship_admin_complete_admin",
  };
  const col = map[key];
  const v = col ? (p as Record<string, unknown>)[col] : null;
  return typeof v === "string" ? v : "";
}

/**
 * Resend template tag → activity scope, so automated emails land under
 * the right filter pill. Tags come from the `tag:` field each trigger
 * passes to `sendEmail` (lib/emails/triggers.ts + records-request).
 * Unknown/future tags fall back to "general" rather than vanishing.
 */
const EMAIL_TEMPLATE_SCOPE: Record<string, ActivityScope> = {
  "application-received": "application",
  accepted: "application",
  "not-accepted": "application",
  "draft-reminder": "application",
  "registration-received": "registration",
  "enrollment-reminder": "registration",
  "records-request": "registration",
  enrolled: "enrollment",
  "back-to-school": "enrollment",
  "sms-reply-received": "general",
};

/** Human label for a note's category bucket. */
function categoryLabel(category: string | null | undefined): string {
  switch (category) {
    case "phone":
      return "Call logged";
    case "email":
      return "Email logged";
    case "in-person":
      return "In-person conversation";
    case "sms":
      return "Text logged";
    default:
      return "Note";
  }
}

/**
 * Coerce the mixed timestamp shapes Xano hands back (unix ms number,
 * numeric string, ISO/`YYYY-MM-DD` date string) into unix ms, or null
 * when absent/unparseable — events without a real timestamp are
 * skipped rather than guessed.
 */
function coerceTs(v: number | string | null | undefined): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") {
    return Number.isFinite(v) && v > 0 ? v : null;
  }
  const asNum = Number(v);
  if (Number.isFinite(asNum) && asNum > 0) return asNum;
  const parsed = Date.parse(v);
  return Number.isFinite(parsed) ? parsed : null;
}

export type ActivityScope =
  | "application"
  | "registration"
  | "sufs"
  | "enrollment"
  | "general";

export interface ActivityEvent {
  /** Stable synthetic id (`note-12`, `sufs-q1-44`, …) for React keys. */
  id: string;
  /** Unix ms. */
  ts: number;
  kind: "note" | "sms" | "email" | "system";
  scope: ActivityScope;
  /** System events: the milestone label. Notes: the category label.
   *  Emails: "Email sent" / "Email failed to send". */
  title: string;
  /** Note/text body, email subject; empty for most system events. */
  body: string;
  /** Who did it — admin display name, or the family name for inbound
   *  texts. Empty when the stamp doesn't record an actor. */
  author: string;
  /** Texts only. */
  direction?: "inbound" | "outbound";
  /** Texts: Twilio delivery status. Emails: sent | failed. */
  status?: string;
  /** Emails only — a delivery problem that did NOT fail the send,
   *  e.g. one of three recipients hard-bounced or a transient bounce
   *  that may still deliver. Present only when `status` isn't
   *  "failed", so the two never contradict each other. */
  deliveryNote?: string;
  /** Texts only — this row was part of a group blast. */
  isGroup?: boolean;
  /** Emails only — Resend message id for the full-content preview. */
  resendId?: string;
  /** Emails only — unix-ms of the FIRST open reported by Resend's
   *  open tracking (webhook-stamped). Absent = no open recorded,
   *  which means "unknown", not "unread" (pixel tracking). */
  openedAt?: number;
  /** Set when the event is about one student. */
  studentName?: string;
  /** Notes only — raw category bucket. */
  category?: string;
  /** Notes only. */
  pinned?: boolean;
}

export interface ActivityResponse {
  events: ActivityEvent[];
  familyName: string;
}

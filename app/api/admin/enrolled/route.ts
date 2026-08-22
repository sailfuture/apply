import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import type { XanoSchoolYear } from "@/lib/xano";

/**
 * Admin Enrolled Students list — one row per student who has an
 * active application for the requested academic year. Each row
 * carries an `is_enrolled` flag so the page can split the list into
 * two groups: officially enrolled vs not-yet-enrolled (or
 * unenrolled). Admin sees the full population of students tied to
 * the year, with the workflow status surfaced as the group divide.
 *
 * "Enrolled" === the student row carries `isEnrolled=true` AND
 * `isArchived !== true`. The registration-progress route cascades
 * `isEnrolled=true` onto every family student when admin clicks
 * Confirm Family Registration (so the family's registration is
 * formally confirmed first). The Unenroll modal on the detail page
 * clears `isEnrolled=false` + sets `isArchived=true` together.
 *
 * Per-year scope is enforced via `registration_application` — the
 * student must have an active app for the selected year. The
 * student's registration packet
 * (`registration_student_registration`) is joined as a side lookup
 * for liability-waiver state + "verified at" timestamp, but
 * doesn't gate the list.
 *
 * Joins:
 *   - `xano.students.getAll()` → primary pivot, gated by isEnrolled
 *   - `xano.applications.getAll()` → year scope + `current_grade` +
 *     the first-enrolled-year fallback
 *   - `xano.studentRegistration.getAll()` → waiver state + "verified
 *     at" timestamp for the selected year (side join, not the gate),
 *     AND every OTHER year's packet, which is what lets us derive
 *     each student's first enrolled year. Deliberately the whole
 *     table rather than `getByYear(yearId)`: the cohort year is a
 *     cross-year question, and one full read is cheaper than a
 *     per-year fan-out.
 *   - `xano.schoolYears.getAll()` → year id → display name +
 *     chronological ordering for the cohort year
 *   - `xano.families.getAll()` → family label
 *   - `xano.parents.getAll()` → primary parent name + email
 *
 * Each lookup is wrapped in `Promise.allSettled` so a single Xano
 * hiccup degrades gracefully rather than 500'ing the whole route.
 */

/**
 * Chronological sort key for a school year. Prefers the row's
 * `start_date`; falls back to a leading 4-digit year parsed out of
 * `year_name` ("2023-2024" → Jul 2023), which covers rows where the
 * date columns were never filled in. Anything unparseable sorts last
 * rather than colliding with real years near epoch zero — the same
 * "unknown drops to the end" treatment the grade sort uses on the
 * page.
 */
function yearSortKey(year: XanoSchoolYear | null | undefined): number {
  if (!year) return Number.MAX_SAFE_INTEGER;
  const fromStartDate = year.start_date ? Date.parse(year.start_date) : NaN;
  if (Number.isFinite(fromStartDate)) return fromStartDate;
  const leading = parseInt(String(year.year_name ?? "").trim().slice(0, 4), 10);
  // Range-guard the parse so a short label like "23-24" doesn't
  // resolve to the year 23 AD and sort ahead of everything real.
  if (Number.isFinite(leading) && leading >= 1900 && leading <= 3000) {
    return Date.UTC(leading, 6, 1);
  }
  return Number.MAX_SAFE_INTEGER;
}
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const yearIdParam = req.nextUrl.searchParams.get("yearId");
    if (!yearIdParam) {
      return NextResponse.json(
        { error: "yearId is required" },
        { status: 400 }
      );
    }
    const yearId = Number(yearIdParam);
    if (!Number.isFinite(yearId) || yearId <= 0) {
      return NextResponse.json(
        { error: "yearId must be a positive number" },
        { status: 400 }
      );
    }

    const [
      packetsResult,
      appsResult,
      studentsResult,
      familiesResult,
      parentsResult,
      yearsResult,
    ] = await Promise.allSettled([
      xano.studentRegistration.getAll(),
      xano.applications.getAll(),
      xano.students.getAll(),
      xano.families.getAll(),
      xano.parents.getAll(),
      xano.schoolYears.getAll(),
    ]);

    if (packetsResult.status === "rejected") {
      console.error(
        "[/api/admin/enrolled] failed to load packets:",
        packetsResult.reason
      );
    }
    if (yearsResult.status === "rejected") {
      console.error(
        "[/api/admin/enrolled] failed to load school years:",
        yearsResult.reason
      );
    }
    if (appsResult.status === "rejected") {
      console.error(
        "[/api/admin/enrolled] failed to load applications:",
        appsResult.reason
      );
    }
    if (studentsResult.status === "rejected") {
      console.error(
        "[/api/admin/enrolled] failed to load students:",
        studentsResult.reason
      );
    }
    if (familiesResult.status === "rejected") {
      console.error(
        "[/api/admin/enrolled] failed to load families:",
        familiesResult.reason
      );
    }
    if (parentsResult.status === "rejected") {
      console.error(
        "[/api/admin/enrolled] failed to load parents:",
        parentsResult.reason
      );
    }

    // Every packet across every year. The selected year's slice is
    // pulled out below for the waiver / verified-at side join; the
    // full set feeds the first-enrolled-year derivation.
    const allPackets =
      packetsResult.status === "fulfilled" ? packetsResult.value : [];
    const packets = allPackets.filter(
      (p) => Number(p.registration_school_years_id) === yearId
    );
    const years =
      yearsResult.status === "fulfilled" ? yearsResult.value : [];
    const apps =
      appsResult.status === "fulfilled" ? appsResult.value : [];
    const students =
      studentsResult.status === "fulfilled" ? studentsResult.value : [];
    const families =
      familiesResult.status === "fulfilled" ? familiesResult.value : [];
    const parents =
      parentsResult.status === "fulfilled" ? parentsResult.value : [];

    const familyById = new Map(families.map((f) => [f.id, f]));
    // Per-student app for the year — gives us the current grade. Map by
    // student id so the join below stays an O(1) lookup.
    const appByStudent = new Map<number, (typeof apps)[number]>();
    for (const a of apps) {
      if (Number(a.registration_school_years_id) !== yearId) continue;
      if (a.isActive === false) continue;
      appByStudent.set(Number(a.registration_students_id), a);
    }

    // ── First-enrolled ("cohort") year, per student ──────────────
    //
    // The roster is scoped to ONE school year, so "which year did
    // this student enrol?" can't be read off the row — it's a
    // cross-year question. Three tiers, best signal first:
    //
    //   1. `student.enrollment_school_years_id` — the year admin
    //      picked on the student's School Account card (or that the
    //      bulk backfill wrote). An explicit human statement of
    //      "this is the year they started", so nothing derived
    //      outranks it.
    //   2. The earliest year in which the student has a packet with
    //      `registrationConfirmed === true` — admin signed off on a
    //      registration that year.
    //   3. Failing that (packet drift, legacy rows, a student
    //      enrolled via the family-level cascade before their own
    //      packet was confirmed), the earliest year they hold an
    //      active application for.
    //
    // Tiers 2 and 3 are only as deep as the data behind them, and in
    // practice that data does NOT go back: every application and
    // packet row currently in Xano belongs to the newest year, because
    // returning students get a fresh row each cycle rather than a
    // historical trail. Deriving from them alone therefore answers
    // "this year" for literally everyone and empties the Returning
    // bucket — which is exactly why tier 1 leads.
    //
    // Tier 3 always resolves for anyone in this list — an active
    // application for the selected year is the list's own gate — so
    // every row gets a year. `basis` rides along so the column can
    // hover-explain which tier answered, rather than presenting a
    // softer number with the same confidence as a hard one.
    const yearById = new Map<number, XanoSchoolYear>(
      years.map((y) => [y.id, y])
    );
    const yearKeyById = new Map<number, number>(
      years.map((y) => [y.id, yearSortKey(y)])
    );
    /** Keep whichever of the two year ids sits earlier on the
     *  calendar. Unknown years (no row in `registration_school_years`)
     *  score MAX_SAFE_INTEGER and therefore lose to any known year. */
    const earlier = (a: number | null, b: number) => {
      if (a === null) return b;
      const aKey = yearKeyById.get(a) ?? Number.MAX_SAFE_INTEGER;
      const bKey = yearKeyById.get(b) ?? Number.MAX_SAFE_INTEGER;
      return bKey < aKey ? b : a;
    };
    const firstConfirmedYearByStudent = new Map<number, number>();
    for (const p of allPackets) {
      if (p.registrationConfirmed !== true) continue;
      const sid = Number(p.registration_students_id);
      const yid = Number(p.registration_school_years_id);
      if (!Number.isFinite(sid) || !Number.isFinite(yid)) continue;
      const next = earlier(firstConfirmedYearByStudent.get(sid) ?? null, yid);
      firstConfirmedYearByStudent.set(sid, next);
    }
    const firstAppliedYearByStudent = new Map<number, number>();
    for (const a of apps) {
      if (a.isActive === false) continue;
      const sid = Number(a.registration_students_id);
      const yid = Number(a.registration_school_years_id);
      if (!Number.isFinite(sid) || !Number.isFinite(yid)) continue;
      const next = earlier(firstAppliedYearByStudent.get(sid) ?? null, yid);
      firstAppliedYearByStudent.set(sid, next);
    }

    // Primary parent per family — lowest id wins, mirroring how the
    // applications + registrations endpoints pick one for display.
    const primaryByFamily = new Map<number, (typeof parents)[number] | null>();
    for (const f of families) {
      const ids = xano.families.getParentIds(f);
      const matched = parents
        .filter((p) => ids.includes(p.id))
        .sort((a, b) => a.id - b.id);
      primaryByFamily.set(f.id, matched[0] ?? null);
    }

    // List ALL students with an active application for the year —
    // both currently enrolled and not-yet-enrolled / unenrolled.
    // The `is_enrolled` flag on each row tells the page which group
    // to render it under; the gate that used to filter to
    // enrolled-only was `student.isEnrolled === true &&
    // student.isArchived !== true`. We compute the same predicate
    // per-row below.
    const studentsForYear = students.filter((s) =>
      appByStudent.has(s.id)
    );

    // Side join: packet lookup by student id so each row can
    // surface waiver state without a separate query per student.
    // `null` when the family hasn't started the year's packet yet.
    const packetByStudent = new Map<
      number,
      (typeof packets)[number] | null
    >();
    for (const p of packets) {
      packetByStudent.set(Number(p.registration_students_id), p);
    }

    const rows: EnrolledStudentRow[] = studentsForYear.flatMap((student) => {
      const studentId = student.id;
      const app = appByStudent.get(studentId);
      // Defensive guard — `studentsForYear` was built off the same
      // map, so this is effectively always defined; the guard keeps
      // TypeScript happy without an `!` assertion.
      if (!app) return [];
      const familyId = Number(app.registration_families_id);
      const family = familyById.get(familyId) ?? null;
      const primary = primaryByFamily.get(familyId) ?? null;
      // Side-joined packet (if any). Used for waiver state and the
      // "verified at" enrolled-at fallback. Optional — students
      // accepted but with no packet yet still render here.
      const packet = packetByStudent.get(studentId) ?? null;
      // Audit "enrolled at" timestamp prefers the packet's verify
      // time (when admin actually clicked Verify Registration);
      // falls back to packet.created_at (when the parent opened
      // the packet); finally to the student row's `created_at`
      // (when the student was added to the system). Always picks
      // the most recent meaningful timestamp available.
      const enrolledAt =
        packet?.registration_confirmed_admin_time ??
        packet?.created_at ??
        student.created_at ??
        0;
      const isEnrolled =
        student.isEnrolled === true && student.isArchived !== true;
      // Cohort year — see the three-tier derivation above. Falls all
      // the way back to the selected year so the column never renders
      // blank on a row that is, by definition, here for this year.
      // The admin pick only counts when it names a year we actually
      // know about, so a stale id pointing at a deleted year drops
      // through to the derived tiers instead of rendering "—".
      const adminCohortYearId =
        Number(student.enrollment_school_years_id) > 0 &&
        yearById.has(Number(student.enrollment_school_years_id))
          ? Number(student.enrollment_school_years_id)
          : null;
      const confirmedCohortYearId =
        firstConfirmedYearByStudent.get(studentId) ?? null;
      const cohortYearId =
        adminCohortYearId ??
        confirmedCohortYearId ??
        firstAppliedYearByStudent.get(studentId) ??
        yearId;
      const cohortYear = yearById.get(cohortYearId) ?? null;
      // Returning = their first year sits chronologically BEFORE the
      // year this roster is scoped to. Deliberately not a `!==` on the
      // year id: an unknown or later cohort year is not evidence that
      // someone was here last year, and the compare has to happen
      // here, where both years' sort keys are known.
      const selectedYearSort =
        yearKeyById.get(yearId) ?? Number.MAX_SAFE_INTEGER;
      const cohortYearSort =
        yearKeyById.get(cohortYearId) ?? Number.MAX_SAFE_INTEGER;
      return [
        {
          id: studentId,
          packet_id: packet?.id ?? null,
          student_id: studentId,
          family_id: familyId,
          year_id: yearId,
          student_first_name: student.first_name ?? "",
          student_last_name: student.last_name ?? "",
          student_full_name:
            `${student.first_name ?? ""} ${student.last_name ?? ""}`.trim() ||
            `Student #${studentId}`,
          student_dob: student.date_of_birth ?? "",
          student_grade: app.current_grade ?? "",
          // Admin-assigned grade level from the packet (the placement
          // field set on the student detail page). The roster groups
          // students by this. Empty until admin sets it — those rows
          // fall under the "No grade level set" group.
          grade_level: packet?.grade_level ?? "",
          family_name:
            family?.family_name?.trim() || `Family #${familyId}`,
          primary_name: primary
            ? `${primary.first_name ?? ""} ${primary.last_name ?? ""}`.trim()
            : "",
          primary_email: primary?.email ?? "",
          primary_phone: (primary?.phone ?? "").toString(),
          confirmed_at: enrolledAt,
          enrolled_year_id: cohortYearId,
          enrolled_year_name: cohortYear?.year_name?.trim() || "—",
          enrolled_year_sort: cohortYearSort,
          enrolled_year_basis:
            adminCohortYearId !== null
              ? "admin"
              : confirmedCohortYearId !== null
                ? "confirmed"
                : "application",
          is_returning: cohortYearSort < selectedYearSort,
          liability_waiver_status: packet?.liability_waiver_status ?? "",
          liability_waiver_pdf_url: packet?.liability_waiver_pdf_url ?? "",
          is_enrolled: isEnrolled,
          is_archived: student.isArchived === true,
          // Required-document states for the row-click detail sheet —
          // same derivation as the Registrations list (submitted =
          // parent uploaded files, approved = admin doc-confirm).
          doc_immunization_submitted: hasFiles(student.immunization_forms),
          doc_immunization_approved:
            student.immunization_admin_confirm === true,
          doc_birth_certificate_submitted: hasFiles(
            student.birth_certificate
          ),
          doc_birth_certificate_approved:
            student.birth_certificate_admin_confirm === true,
          doc_school_health_form_submitted: hasFiles(
            student.school_health_form
          ),
          doc_school_health_form_approved:
            student.school_health_form_admin_confirm === true,
          doc_transcripts_submitted: hasFiles(student.transcripts),
          doc_transcripts_approved:
            student.transcripts_admin_confirm === true,
          // IEP presence — parent (or admin) uploaded at least one
          // file to the student's evergreen `iep` document slot.
          // Drives the roster's IEP filter + the batch IEP download.
          has_iep: hasFiles(student.iep),
          // School Google account generated (email + password stored
          // on the student row). A boolean, deliberately NOT the
          // credentials themselves — the printable sign-in sheets read
          // those server-side in
          // `/api/admin/enrolled/credential-cards`, so passwords never
          // ride along in the roster payload.
          has_school_account:
            (student.school_email ?? "").trim().length > 0 &&
            (student.school_password ?? "").trim().length > 0,
        },
      ];
    });

    rows.sort((a, b) => {
      // Most recently confirmed first, then alphabetical by last
      // name. Newest at the top puts the active enrollment work in
      // admin's eye line.
      if (a.confirmed_at !== b.confirmed_at) {
        return (b.confirmed_at ?? 0) - (a.confirmed_at ?? 0);
      }
      return (a.student_last_name ?? "").localeCompare(
        b.student_last_name ?? ""
      );
    });

    return NextResponse.json(rows);
  } catch (err) {
    return handleAdminError(err);
  }
}

export interface EnrolledStudentRow {
  /** Stable row id — uses the student id (unique per row in the
   *  list) so React keys stay stable even when a student has no
   *  packet yet. */
  id: number;
  /** Packet id when the parent has opened the year's packet, or
   *  `null` when admin has accepted the student but the parent
   *  hasn't started the registration packet yet. The list no
   *  longer gates on packet existence — the student's
   *  `isAccepted` is the canonical signal. */
  packet_id: number | null;
  student_id: number;
  family_id: number;
  year_id: number;
  student_first_name: string;
  student_last_name: string;
  student_full_name: string;
  student_dob: string;
  student_grade: string;
  /** Admin-assigned grade level from the registration packet
   *  ("8th"–"12th"). The enrolled roster groups students by this
   *  field. Distinct from `student_grade` (the application's incoming
   *  grade); empty until admin sets it on the student detail page. */
  grade_level: string;
  family_name: string;
  primary_name: string;
  primary_email: string;
  /** Best-effort "enrolled at" timestamp — packet verify time,
   *  packet created_at, or student created_at, in that order of
   *  preference. Scoped to the SELECTED year; see
   *  `enrolled_year_*` for the student's cohort year. */
  confirmed_at: number;
  /** School-year id the student FIRST enrolled under — their cohort
   *  year, which is usually earlier than the year this list is
   *  scoped to. Derived cross-year; see the derivation block in the
   *  route for the two tiers. */
  enrolled_year_id: number;
  /** Display label for `enrolled_year_id` ("2023-2024"), or "—" when
   *  the year row is missing from `registration_school_years`. */
  enrolled_year_name: string;
  /** Chronological sort key for `enrolled_year_id` (epoch ms of the
   *  year's start). Unknown years score `MAX_SAFE_INTEGER` so they
   *  land at the end of an ascending sort instead of the front.
   *  The column sorts on THIS, not on `enrolled_year_name` — a
   *  string sort would put "—" ahead of every real year. */
  enrolled_year_sort: number;
  /** Which tier of the derivation answered: `"admin"` (the year set
   *  on the student's School Account card — an explicit human
   *  statement), `"confirmed"` (a registration packet was
   *  admin-confirmed that year — hard signal) or `"application"` (no
   *  confirmed packet anywhere, so we fell back to their earliest
   *  active application year — soft signal). Drives the column's
   *  hover text. */
  enrolled_year_basis: "admin" | "confirmed" | "application";
  /** True when `enrolled_year_id` sits chronologically BEFORE the
   *  year this roster is scoped to — i.e. the student was already
   *  here in an earlier year. Drives the New/Returning cohort chips.
   *  Computed server-side because it needs both years' sort keys. */
  is_returning: boolean;
  liability_waiver_status: string;
  liability_waiver_pdf_url: string;
  /** Primary parent's phone (bare digits as stored) — surfaced in the
   *  row-click detail sheet. */
  primary_phone: string;
  /** Required-document states for the detail sheet — submitted =
   *  parent uploaded files into the slot, approved = admin
   *  doc-confirm. Same derivation as the Registrations list. */
  doc_immunization_submitted: boolean;
  doc_immunization_approved: boolean;
  doc_birth_certificate_submitted: boolean;
  doc_birth_certificate_approved: boolean;
  doc_school_health_form_submitted: boolean;
  doc_school_health_form_approved: boolean;
  doc_transcripts_submitted: boolean;
  doc_transcripts_approved: boolean;
  /** Student has at least one file in the evergreen `iep` document
   *  slot. Drives the roster's IEP filter and batch IEP download. */
  has_iep: boolean;
  /** Student has a generated school Google account (both
   *  `school_email` and `school_password` stored). Drives the count on
   *  the "Sign-in sheets" button; the credentials themselves stay
   *  server-side. */
  has_school_account: boolean;
  /** True when the student is officially enrolled for the year:
   *  `student.isEnrolled === true && student.isArchived !== true`.
   *  Drives the Enrolled vs Not Enrolled grouping on the page. */
  is_enrolled: boolean;
  /** True when the student has been formally unenrolled via the
   *  Unenroll modal (sets `isArchived=true` alongside
   *  `isEnrolled=false` + reason/date/notes). Distinguishes
   *  "never enrolled yet" from "was enrolled and later removed". */
  is_archived: boolean;
  /** Index signature so the row matches `DataTable`'s
   *  `<T extends Record<string, unknown>>` constraint without a
   *  client-side cast. Mirrors the same pattern on
   *  `RegistrationStudentRow`. */
  [key: string]: unknown;
}

/** Xano file-field presence check — upload columns come back as an
 *  array of file objects (or a bare object on legacy rows). Hoisted
 *  module function so the row map above can use it. */
function hasFiles(v: unknown): boolean {
  if (!v) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v).length > 0;
  return false;
}

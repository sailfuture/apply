import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import {
  generateSchoolEmail,
  generateSchoolPassword,
  schoolYearStartYear,
} from "@/lib/school-account";

/**
 * Bulk school-account backfill — generates the school email +
 * starter password for every currently-enrolled student who doesn't
 * have one yet, defaulting each student's enrollment year to the
 * earliest school year they're associated with (the year they first
 * applied/enrolled). Students who already have a `school_email` are
 * left untouched, so the action is idempotent and safe to re-run.
 *
 * POST body: `{ dryRun?: boolean }`. Dry run computes and returns
 * the full plan without writing — the dialog shows it for admin
 * review before the real run. The live run PATCHes each student via
 * the admin API group and reports per-student outcomes.
 *
 * Response: `{ dryRun, totals, rows: BackfillRow[] }` — rows cover
 * every enrolled student, including skips, so admin sees the whole
 * roster accounted for.
 */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = await req.json().catch(() => ({}));
    const dryRun = body?.dryRun !== false;

    const [studentsResult, yearsResult] = await Promise.allSettled([
      xano.students.getAll(),
      xano.schoolYears.getAll(),
    ]);
    if (studentsResult.status === "rejected") {
      console.error(
        "[/api/admin/school-accounts/backfill] failed to load students:",
        studentsResult.reason
      );
      return NextResponse.json(
        { error: "Couldn't load the student list from Xano." },
        { status: 502 }
      );
    }
    if (yearsResult.status === "rejected") {
      console.error(
        "[/api/admin/school-accounts/backfill] failed to load school years:",
        yearsResult.reason
      );
      return NextResponse.json(
        { error: "Couldn't load the school-years list from Xano." },
        { status: 502 }
      );
    }

    const students = studentsResult.value;
    const years = yearsResult.value;
    const yearById = new Map(years.map((y) => [y.id, y]));

    const enrolled = students
      .filter((s) => s.isEnrolled === true && s.isArchived !== true)
      .sort((a, b) =>
        `${a.last_name ?? ""} ${a.first_name ?? ""}`.localeCompare(
          `${b.last_name ?? ""} ${b.first_name ?? ""}`
        )
      );

    // Every school_email already stored on ANY student (enrolled or
    // not) seeds the collision set — two "John Smith"s entering the
    // same year would otherwise both get john.smith26@… and the
    // second Google account creation would bounce. Conflicting rows
    // are reported for manual resolution rather than guessed at.
    const takenEmails = new Set(
      students
        .map((s) => (s.school_email ?? "").trim().toLowerCase())
        .filter(Boolean)
    );

    const rows: BackfillRow[] = [];
    for (const s of enrolled) {
      const name =
        `${s.first_name ?? ""} ${s.last_name ?? ""}`.trim() ||
        `Student #${s.id}`;

      if ((s.school_email ?? "").trim()) {
        rows.push({
          student_id: s.id,
          student_name: name,
          year_name:
            (s.enrollment_school_years_id
              ? yearById.get(s.enrollment_school_years_id)?.year_name
              : null) ?? "",
          email: s.school_email ?? "",
          password: "",
          status: "skipped_existing",
        });
        continue;
      }

      if (!(s.first_name ?? "").trim() || !(s.last_name ?? "").trim()) {
        rows.push({
          student_id: s.id,
          student_name: name,
          year_name: "",
          email: "",
          password: "",
          status: "no_name",
          detail: "Student needs both a first and last name.",
        });
        continue;
      }

      // Enrollment year: the stored pick wins; otherwise the earliest
      // school year the student is associated with. "Earliest" by the
      // year name's start year so 2024-2025 sorts before 2026-2027
      // regardless of row-creation order.
      let year =
        (s.enrollment_school_years_id
          ? yearById.get(s.enrollment_school_years_id)
          : undefined) ?? null;
      if (!year) {
        const associated = (
          Array.isArray(s.registration_school_years_id)
            ? s.registration_school_years_id
            : []
        )
          .map((id) => yearById.get(id))
          .filter((y): y is NonNullable<typeof y> => Boolean(y))
          .filter((y) => schoolYearStartYear(y.year_name) !== null)
          .sort(
            (a, b) =>
              (schoolYearStartYear(a.year_name) ?? 0) -
              (schoolYearStartYear(b.year_name) ?? 0)
          );
        year = associated[0] ?? null;
      }
      if (!year) {
        rows.push({
          student_id: s.id,
          student_name: name,
          year_name: "",
          email: "",
          password: "",
          status: "no_year",
          detail:
            "No school year associated with this student — set the enrollment year on their School Account card.",
        });
        continue;
      }

      const email = generateSchoolEmail(
        s.first_name ?? "",
        s.last_name ?? "",
        year.year_name
      );
      const password = generateSchoolPassword(
        s.first_name ?? "",
        s.last_name ?? "",
        year.year_name
      );
      if (!email || !password) {
        rows.push({
          student_id: s.id,
          student_name: name,
          year_name: year.year_name,
          email: "",
          password: "",
          status: "no_name",
          detail: "Name doesn't reduce to email-safe characters.",
        });
        continue;
      }

      if (takenEmails.has(email.toLowerCase())) {
        rows.push({
          student_id: s.id,
          student_name: name,
          year_name: year.year_name,
          email,
          password: "",
          status: "conflict",
          detail:
            "Another student already has this email — set this student's account by hand from their detail page.",
        });
        continue;
      }
      takenEmails.add(email.toLowerCase());

      if (dryRun) {
        rows.push({
          student_id: s.id,
          student_name: name,
          year_name: year.year_name,
          email,
          password,
          status: "planned",
        });
        continue;
      }

      try {
        await xano.students.updateOnAdminGroup(s.id, {
          enrollment_school_years_id: year.id,
          school_email: email,
          school_password: password,
        });
        rows.push({
          student_id: s.id,
          student_name: name,
          year_name: year.year_name,
          email,
          password,
          status: "updated",
        });
      } catch (err) {
        console.error(
          `[/api/admin/school-accounts/backfill] PATCH failed for student ${s.id}:`,
          err
        );
        rows.push({
          student_id: s.id,
          student_name: name,
          year_name: year.year_name,
          email,
          password: "",
          status: "error",
          detail: err instanceof Error ? err.message : "Write failed.",
        });
      }
    }

    const totals: Record<BackfillStatus, number> = {
      planned: 0,
      updated: 0,
      skipped_existing: 0,
      no_year: 0,
      no_name: 0,
      conflict: 0,
      error: 0,
    };
    for (const row of rows) totals[row.status] += 1;

    return NextResponse.json({ dryRun, totals, rows });
  } catch (err) {
    return handleAdminError(err);
  }
}

export type BackfillStatus =
  | "planned"
  | "updated"
  | "skipped_existing"
  | "no_year"
  | "no_name"
  | "conflict"
  | "error";

export interface BackfillRow {
  student_id: number;
  student_name: string;
  year_name: string;
  email: string;
  /** Only populated on planned/updated rows — blank elsewhere so the
   *  response doesn't echo existing passwords back out. */
  password: string;
  status: BackfillStatus;
  detail?: string;
}

export interface BackfillResponse {
  dryRun: boolean;
  totals: Record<BackfillStatus, number>;
  rows: BackfillRow[];
}

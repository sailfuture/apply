import { NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import {
  getAllStudents,
  getYearGroups,
  isToddleConfigured,
  resolveYearGroupId,
  ToddleDuplicateError,
  ToddleSyncError,
  type ToddleDuplicateCandidate,
  type ToddleStudent,
} from "@/lib/toddle";
import {
  buildToddleSyncFields,
  buildToddleSyncShared,
  previewToddleStudent,
  syncStudentToToddle,
  type ToddleSyncPreview,
} from "@/lib/toddle-sync";
import {
  evaluateToddleReadiness,
  type ToddleReadiness,
} from "@/lib/toddle-readiness";

/**
 * Bulk "Sync all to Toddle" — runs the full per-student Toddle sync
 * (see `lib/toddle-sync.ts#syncStudentToToddle`) for every currently
 * enrolled student, sharing one fetch of the org-wide Toddle lists
 * (roster, parents, crew-class rosters) across the whole run.
 *
 * Sequentialish: a small worker pool (3 lanes) keeps the run well
 * under serverless limits for a roster this size without hammering
 * Toddle's API. Per-student failures (including admin-fixable
 * `ToddleSyncError`s like an unmapped year group) become "failed"
 * rows with the message — one bad student never stops the rest.
 *
 * Response: `{ totals, rows: BulkToddleSyncRow[] }`, rows in roster
 * order (last name, first name). Each row says which of four things
 * happened — created, updated (with the fields that differed),
 * unchanged, or failed (with the reason Toddle gave) — so a run
 * answers "what actually moved?" rather than just "it ran".
 */
export const maxDuration = 300;

const CONCURRENCY = 3;

/**
 * Pre-flight — what would happen if you ran the sync right now.
 *
 *   GET → { rows: (ToddleReadiness & { preview })[], comparedToToddle }
 *
 * Two halves. The readiness half is Xano-only — what each student is
 * missing. The preview half reads Toddle ONCE (the roster, plus the
 * year-group list) and reports, per student, whether the run would
 * create them, change specific fields, leave them untouched, or fail
 * on an email already taken by another Toddle record.
 *
 * Toddle rate-limits hard, so the preview is capped at those two
 * requests for the whole roster and degrades to `comparedToToddle:
 * false` rather than failing the dialog — an admin who can't see the
 * comparison can still see what's missing and still run the sync.
 */
export async function GET() {
  try {
    await requireAdmin();
    const [students, parents, families, years, packets, apps] =
      await Promise.all([
        xano.students.getAll(),
        xano.parents.getAll().catch(() => []),
        xano.families.getAll().catch(() => []),
        xano.schoolYears.getAll().catch(() => []),
        xano.studentRegistration.getAll().catch(() => []),
        xano.applications.getAll().catch(() => []),
      ]);

    const activeYear = years.find((y) => y.isActive) ?? null;
    // Contacts hang off the FAMILY row's id array, and the sync treats
    // the lowest id as primary — the address it pushes comes from that
    // one, so the ordering has to match here too.
    const parentById = new Map(parents.map((p) => [p.id, p]));
    const familyParents = new Map<number, typeof parents>();
    for (const f of families) {
      const contacts = xano.families
        .getParentIds(f)
        .map((id) => parentById.get(id))
        .filter((p): p is NonNullable<typeof p> => Boolean(p))
        .sort((a, b) => a.id - b.id);
      familyParents.set(f.id, contacts);
    }
    // Packet per student — the active year's when there is one, else
    // whatever packet exists, mirroring the sync's own fallback.
    const packetByStudent = new Map<number, (typeof packets)[number]>();
    for (const pk of packets) {
      const sid = Number(pk.registration_students_id);
      const current = packetByStudent.get(sid);
      const isActiveYear =
        activeYear && Number(pk.registration_school_years_id) === activeYear.id;
      if (!current || isActiveYear) packetByStudent.set(sid, pk);
    }
    const appByStudent = new Map<number, (typeof apps)[number]>();
    for (const a of apps) {
      if (a.isActive === false) continue;
      const sid = Number(a.registration_students_id);
      const current = appByStudent.get(sid);
      const isActiveYear =
        activeYear && Number(a.registration_school_years_id) === activeYear.id;
      if (!current || isActiveYear) appByStudent.set(sid, a);
    }

    const enrolled = students
      .filter((s) => s.isEnrolled === true && s.isArchived !== true)
      .sort((a, b) =>
        `${a.last_name ?? ""} ${a.first_name ?? ""}`.localeCompare(
          `${b.last_name ?? ""} ${b.first_name ?? ""}`
        )
      )
      .map((s) => s);

    // One roster read + one year-group read for the whole preview.
    let roster: ToddleStudent[] | null = null;
    let yearGroups: Awaited<ReturnType<typeof getYearGroups>> = [];
    if (isToddleConfigured()) {
      try {
        [roster, yearGroups] = await Promise.all([
          getAllStudents(),
          getYearGroups().catch(() => []),
        ]);
      } catch (err) {
        // Rate limit or outage — report readiness without the diff.
        console.error(
          "[/api/admin/students/toddle-sync-all] preview read failed:",
          err
        );
        roster = null;
      }
    }

    // Grades repeat across a roster, so resolve each label once.
    const yearGroupCache = new Map<string, string | undefined>();
    async function yearGroupFor(label: string): Promise<string | undefined> {
      const key = label.trim();
      if (!key) return undefined;
      if (yearGroupCache.has(key)) return yearGroupCache.get(key);
      const resolved = await resolveYearGroupId(key, yearGroups).catch(
        () => undefined
      );
      yearGroupCache.set(key, resolved);
      return resolved;
    }

    const rows: Array<ToddleReadiness & { preview: ToddleSyncPreview }> = [];
    for (const s of enrolled) {
      const famId = Number(s.registration_families_id) || 0;
      const contacts = familyParents.get(famId) ?? [];
      const packet = packetByStudent.get(s.id) ?? null;
      const applicationGrade = appByStudent.get(s.id)?.current_grade ?? null;
      const readiness = evaluateToddleReadiness({
        student: s,
        packet,
        applicationGrade,
        parents: contacts,
        years,
      });
      const fields = buildToddleSyncFields({
        student: s,
        packet,
        primaryParent: contacts[0] ?? null,
        enrollmentYear:
          years.find(
            (y) => y.id === Number(s.enrollment_school_years_id)
          ) ?? null,
        // No hint: the bulk sync passes none either, so the packet's
        // placement grade decides. Passing the application grade here
        // would preview a year group the run wouldn't actually send.
      });
      rows.push({
        ...readiness,
        preview: previewToddleStudent({
          student: s,
          fields,
          roster,
          yearGroupId: roster
            ? await yearGroupFor(fields.gradeLevel ?? "")
            : undefined,
        }),
      });
    }

    return NextResponse.json({ rows, comparedToToddle: roster !== null });
  } catch (err) {
    return handleAdminError(err);
  }
}

export async function POST(req: Request) {
  try {
    await requireAdmin();
    if (!isToddleConfigured()) {
      return NextResponse.json(
        {
          error:
            "Toddle isn't configured — set TODDLE_API_TOKEN (and TODDLE_REGION or TODDLE_API_BASE_URL) in the environment.",
        },
        { status: 503 }
      );
    }

    // Students the admin explicitly cleared to be created even though
    // the preview flagged a near-match in Toddle. Absent = no student
    // gets created past the duplicate guard, which is the safe default
    // for a bulk run nobody is watching field by field.
    const body = await req.json().catch(() => null);
    const allowCreate = new Set<number>(
      Array.isArray(body?.allowCreateStudentIds)
        ? body.allowCreateStudentIds
            .map((v: unknown) => Number(v))
            .filter((v: number) => Number.isFinite(v))
        : []
    );

    const students = await xano.students.getAll();
    const enrolled = students
      .filter((s) => s.isEnrolled === true && s.isArchived !== true)
      .sort((a, b) =>
        `${a.last_name ?? ""} ${a.first_name ?? ""}`.localeCompare(
          `${b.last_name ?? ""} ${b.first_name ?? ""}`
        )
      );

    const shared = await buildToddleSyncShared({ preloadToddle: true });

    const rows: BulkToddleSyncRow[] = new Array(enrolled.length);
    let next = 0;
    async function worker() {
      while (next < enrolled.length) {
        const index = next++;
        const s = enrolled[index];
        const name =
          `${s.first_name ?? ""} ${s.last_name ?? ""}`.trim() ||
          `Student #${s.id}`;
        try {
          const outcome = await syncStudentToToddle(s, undefined, shared, {
            allowCreate: allowCreate.has(s.id),
          });
          rows[index] = {
            student_id: s.id,
            student_name: name,
            action: outcome.action,
            matched_by: outcome.matchedBy,
            changed_fields: outcome.changedFields,
            source_id_blocked: outcome.sourceIdBlocked === true,
            photo: outcome.photo,
            family_synced: outcome.familyMembers.filter(
              (m) => m.account !== "failed" && m.contact !== "failed"
            ).length,
            family_failed: outcome.familyMembers.filter(
              (m) => m.account === "failed" || m.contact === "failed"
            ).length,
            crew: outcome.crew,
          };
        } catch (err) {
          // A near-match isn't a failure — nothing was written and
          // nothing is broken. It's a question, and it gets its own
          // action so a run that only needs decisions doesn't read as
          // a run that went wrong.
          const duplicate = err instanceof ToddleDuplicateError;
          rows[index] = {
            student_id: s.id,
            student_name: name,
            action: duplicate ? "skipped" : "failed",
            matched_by: null,
            changed_fields: [],
            source_id_blocked: false,
            photo: "none",
            family_synced: 0,
            family_failed: 0,
            crew: null,
            candidates: duplicate ? err.candidates : undefined,
            error:
              err instanceof ToddleSyncError
                ? err.message
                : err instanceof Error
                  ? err.message.slice(0, 300)
                  : "Sync failed.",
          };
        }
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, enrolled.length) }, worker)
    );

    const totals = {
      created: 0,
      updated: 0,
      unchanged: 0,
      skipped: 0,
      failed: 0,
    };
    for (const row of rows) totals[row.action] += 1;

    return NextResponse.json({ totals, rows });
  } catch (err) {
    return handleAdminError(err);
  }
}

export interface BulkToddleSyncRow {
  student_id: number;
  student_name: string;
  /** `unchanged` = the record was pushed but every field Toddle
   *  reports back already matched. `skipped` = nothing was written
   *  because Toddle looks like it already holds this child under
   *  another spelling; `candidates` says which records. `failed` =
   *  Toddle neither matched nor accepted this student; `error` says
   *  why. */
  action: "created" | "updated" | "unchanged" | "skipped" | "failed";
  /** How Toddle found the existing record: `stored` (the id we saved),
   *  `sourceId`, `email` (the school address, unique in Toddle), or
   *  `name`. The last two mean the Toddle record was NOT carrying our
   *  sourceId, so it was identified indirectly. Null on create and on
   *  failure. */
  matched_by: "stored" | "sourceId" | "email" | "name" | null;
  /** Fields that actually differed from what Toddle held, e.g.
   *  ["email", "gradeLevel"]. Empty on created / unchanged. */
  changed_fields: string[];
  /** The profile synced, but our student id couldn't be stamped onto
   *  it — an archived Toddle record still holds that id. Harmless for
   *  this run (we address the record directly from now on), but the
   *  ghost record wants deleting in Toddle. */
  source_id_blocked: boolean;
  photo: "synced" | "none" | "failed";
  /** Family contacts fully synced (account + contact card). */
  family_synced: number;
  family_failed: number;
  /** Crew-class result ("added to Crew C", …) or null when the
   *  student has no crew assignment. */
  crew: string | null;
  /** Set on `skipped` — the Toddle records this student might already
   *  be, so the decision can be made without leaving the dialog. */
  candidates?: ToddleDuplicateCandidate[];
  error?: string;
}

export interface BulkToddleSyncResponse {
  totals: {
    created: number;
    updated: number;
    unchanged: number;
    skipped: number;
    failed: number;
  };
  rows: BulkToddleSyncRow[];
}

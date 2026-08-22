import { NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import { isToddleConfigured, ToddleSyncError } from "@/lib/toddle";
import {
  buildToddleSyncShared,
  syncStudentToToddle,
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
 *   GET → { rows: ToddleReadiness[] }
 *
 * Reads only Xano: no Toddle call at all, so opening the dialog is
 * free and can't burn into Toddle's rate limit before the run that
 * needs it. Every rule comes from `lib/toddle-readiness.ts`, the same
 * module the sync itself uses to decide what to push.
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

    const rows: ToddleReadiness[] = students
      .filter((s) => s.isEnrolled === true && s.isArchived !== true)
      .sort((a, b) =>
        `${a.last_name ?? ""} ${a.first_name ?? ""}`.localeCompare(
          `${b.last_name ?? ""} ${b.first_name ?? ""}`
        )
      )
      .map((s) => {
        const famId = Number(s.registration_families_id) || 0;
        const contacts = familyParents.get(famId) ?? [];
        return evaluateToddleReadiness({
          student: s,
          packet: packetByStudent.get(s.id) ?? null,
          applicationGrade: appByStudent.get(s.id)?.current_grade ?? null,
          parents: contacts,
          years,
        });
      });

    return NextResponse.json({ rows });
  } catch (err) {
    return handleAdminError(err);
  }
}

export async function POST() {
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
          const outcome = await syncStudentToToddle(s, undefined, shared);
          rows[index] = {
            student_id: s.id,
            student_name: name,
            action: outcome.action,
            matched_by: outcome.matchedBy,
            changed_fields: outcome.changedFields,
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
          rows[index] = {
            student_id: s.id,
            student_name: name,
            action: "failed",
            matched_by: null,
            changed_fields: [],
            photo: "none",
            family_synced: 0,
            family_failed: 0,
            crew: null,
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

    const totals = { created: 0, updated: 0, unchanged: 0, failed: 0 };
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
   *  reports back already matched. `failed` = Toddle neither matched
   *  nor accepted this student; `error` says why. */
  action: "created" | "updated" | "unchanged" | "failed";
  /** How Toddle found the existing record: `stored` (the id we saved),
   *  `sourceId`, or `name` — a name match means the Toddle record was
   *  NOT carrying our sourceId, so it was loosely identified. Null on
   *  create and on failure. */
  matched_by: "stored" | "sourceId" | "name" | null;
  /** Fields that actually differed from what Toddle held, e.g.
   *  ["email", "gradeLevel"]. Empty on created / unchanged. */
  changed_fields: string[];
  photo: "synced" | "none" | "failed";
  /** Family contacts fully synced (account + contact card). */
  family_synced: number;
  family_failed: number;
  /** Crew-class result ("added to Crew C", …) or null when the
   *  student has no crew assignment. */
  crew: string | null;
  error?: string;
}

export interface BulkToddleSyncResponse {
  totals: {
    created: number;
    updated: number;
    unchanged: number;
    failed: number;
  };
  rows: BulkToddleSyncRow[];
}

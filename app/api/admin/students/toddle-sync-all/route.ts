import { NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import { isToddleConfigured, ToddleSyncError } from "@/lib/toddle";
import {
  buildToddleSyncShared,
  syncStudentToToddle,
} from "@/lib/toddle-sync";

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

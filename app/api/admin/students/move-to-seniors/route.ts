import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { isGoogleAdminConfigured } from "@/lib/google-admin";
import {
  runSeniorsMove,
  SeniorParentMissingError,
} from "@/lib/google-student-ou";

/**
 * "Move to Seniors" for the 12th grade card on the Enrolled Students
 * page — put a whole grade's Google accounts into their own org units
 * under the Seniors OU in one press, instead of opening each student's
 * School Account card. See lib/google-student-ou.ts for the rules.
 *
 *   POST { studentIds: number[], dryRun?: boolean } → SeniorsMoveResponse
 *
 * The card sends the students it is showing: grade lives on the
 * year's registration packet, and the card has already resolved it.
 *
 * `dryRun` defaults to TRUE: a body that forgets the flag gets the
 * read-only plan, never a grade-wide move. The dialog sends
 * `dryRun: false` only from its confirm button.
 */

// A grade is ~20 students × (an OU, a policy write, an account move,
// and a laptop for some), three at a time. Normally under a minute;
// the headroom covers a slow Google or Xano without cutting the run
// off with half a grade moved.
export const maxDuration = 300;

/** Far above any real grade; stops a malformed body from fanning out
 *  into hundreds of Directory calls. */
const MAX_STUDENTS = 200;

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    if (!isGoogleAdminConfigured()) {
      return NextResponse.json(
        { error: "Google Admin integration is not configured" },
        { status: 503 }
      );
    }
    const body = await req.json().catch(() => ({}));
    const dryRun = body?.dryRun !== false;
    const studentIds: number[] = Array.isArray(body?.studentIds)
      ? Array.from(
          new Set<number>(
            body.studentIds
              .map((v: unknown) => Number(v))
              .filter((n: number) => Number.isInteger(n) && n > 0)
          )
        )
      : [];
    if (studentIds.length === 0) {
      return NextResponse.json(
        { error: "studentIds is required" },
        { status: 400 }
      );
    }
    if (studentIds.length > MAX_STUDENTS) {
      return NextResponse.json(
        { error: `Too many students (${studentIds.length}).` },
        { status: 400 }
      );
    }

    try {
      const result = await runSeniorsMove({ studentIds, dryRun });
      if (!dryRun) {
        console.log(
          `[/api/admin/students/move-to-seniors] moved ${result.totals.moved}, failed ${result.totals.failed}, already in place ${result.totals.in_place}, no account ${result.totals.no_account}`
        );
      }
      return NextResponse.json(result);
    } catch (err) {
      if (err instanceof SeniorParentMissingError) {
        return NextResponse.json({ error: err.message }, { status: 409 });
      }
      // Google's own sentence is the useful part (missing scope,
      // revoked delegation) — pass it through rather than a bare 500.
      console.error("[/api/admin/students/move-to-seniors] failed:", err);
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Google Admin call failed" },
        { status: 502 }
      );
    }
  } catch (err) {
    return handleAdminError(err);
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { isGoogleAdminConfigured } from "@/lib/google-admin";
import { runGooglePhotoBackfill } from "@/lib/google-photo-backfill";

/**
 * "Sync Photos to Google" for the Enrolled Students page — push every
 * enrolled student's stored headshot onto their Google Workspace
 * account photo. See lib/google-photo-backfill.ts for the rules.
 *
 *   POST { dryRun?: boolean } → PhotoBackfillResponse
 *
 * `dryRun` defaults to TRUE: a body that forgets the flag gets the
 * read-only plan, never a roster-wide write. The dialog sends
 * `dryRun: false` only from its confirm button.
 */

// ~70 students × (a photo download + a Google PUT), five at a time.
// Normally well under a minute; the headroom covers a slow Xano file
// host without cutting the run off halfway.
export const maxDuration = 300;

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

    const result = await runGooglePhotoBackfill({ dryRun });
    if (!dryRun) {
      console.log(
        `[/api/admin/students/google-photo-sync-all] synced ${result.totals.synced}, failed ${result.totals.failed}, no account ${result.totals.no_account}`
      );
    }
    return NextResponse.json(result);
  } catch (err) {
    return handleAdminError(err);
  }
}

import { NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { matchLeadsToFamilies } from "@/lib/lead-conversion";

/**
 * POST — sweep every unlinked recruitment lead against every
 * registration family (email + phone match) and stamp the conversion
 * link on the hits. Idempotent and safe to re-run: already-linked
 * leads are never touched, so this doubles as the one-time historical
 * backfill AND the "re-run auto-match" button on All Leads (catches
 * families whose submit predates the auto-match hook, or leads that
 * arrived after the family applied).
 *
 * Responds with the match summary; `wiringWarnings` names any lead
 * table whose Xano edit endpoint hasn't exposed the conversion
 * columns as inputs yet — surface those, they mean links silently
 * can't save for that source.
 */
export async function POST() {
  try {
    await requireAdmin();
    const summary = await matchLeadsToFamilies();
    return NextResponse.json(summary);
  } catch (err) {
    return handleAdminError(err);
  }
}

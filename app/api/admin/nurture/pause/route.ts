import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import {
  xano,
  LEAD_NOTE_COLUMN,
  LEAD_NOTE_SOURCES,
  tourLeadFk,
  type LeadNoteSource,
} from "@/lib/xano";
import {
  AUTOMATION_NOTE_CATEGORY,
  PAUSED_NOTE_BODY,
  RESUMED_NOTE_BODY,
  pausedLeadKeys,
} from "@/lib/nurture/plan";

/**
 * Per-lead pause for the automated follow-up texts.
 *
 * State is a note on the lead's timeline (category "automation") — the
 * newest one wins — so staff see who paused it and when, right in the
 * comms log, and no lead table needed a new column. Notes are written
 * straight to Xano, NOT through /api/admin/notes: that route bumps
 * `last_reach_out`, and pausing texts isn't reaching out.
 *
 * GET  ?source=&id=           → { paused }
 * POST { source, id, paused } → { paused }
 */
export const dynamic = "force-dynamic";

function parseLead(
  source: unknown,
  id: unknown
): { source: LeadNoteSource; id: number } | null {
  const n = Number(id);
  if (
    typeof source !== "string" ||
    !LEAD_NOTE_SOURCES.includes(source as LeadNoteSource) ||
    !Number.isInteger(n) ||
    n <= 0
  ) {
    return null;
  }
  return { source: source as LeadNoteSource, id: n };
}

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const lead = parseLead(
      req.nextUrl.searchParams.get("source"),
      req.nextUrl.searchParams.get("id")
    );
    if (!lead) {
      return NextResponse.json({ error: "Unknown lead" }, { status: 400 });
    }
    const notes = await xano.adminNotes.getAll();
    return NextResponse.json({
      paused: pausedLeadKeys(notes).has(`${lead.source}:${lead.id}`),
    });
  } catch (err) {
    return handleAdminError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { admin } = await requireAdmin();
    const body = await req.json().catch(() => null);
    const lead = parseLead(body?.source, body?.id);
    if (!lead || typeof body?.paused !== "boolean") {
      return NextResponse.json(
        { error: "Expected { source, id, paused }" },
        { status: 400 }
      );
    }
    const note = await xano.adminNotes.create({
      registration_families_id: 0,
      registration_students_id: null,
      registration_school_years_id: null,
      ...tourLeadFk(lead),
      registration_student_registration_progress_id: null,
      registration_family_application_progress_id: null,
      author_email: admin.email,
      author_name: admin.name,
      body: body.paused ? PAUSED_NOTE_BODY : RESUMED_NOTE_BODY,
      category: AUTOMATION_NOTE_CATEGORY,
      is_pinned: false,
      section: null,
      is_shared_with_parent: false,
    });
    // Xano drops undeclared inputs silently; a note that didn't land on
    // the lead would leave the switch showing a state that isn't real.
    const column = LEAD_NOTE_COLUMN[lead.source];
    if (Number(note?.[column]) !== lead.id) {
      await xano.adminNotes.delete(note.id).catch(() => {});
      return NextResponse.json(
        { error: `Couldn't save the pause on this lead (${column} not accepted).` },
        { status: 502 }
      );
    }
    return NextResponse.json({ paused: body.paused });
  } catch (err) {
    return handleAdminError(err);
  }
}

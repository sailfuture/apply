import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import { getCallRecordings, getCallVoicemail } from "@/lib/quo";

/**
 * Play a call's recording (or its voicemail). Admin-only; the browser
 * is sent to a fresh signed URL from Quo each time, because Quo's
 * recording links expire and the audio itself is never copied here.
 *
 *   GET /api/admin/calls/12/recording  →  302 to the audio
 */
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const { id } = await params;
    const rowId = Number(id);
    if (!Number.isInteger(rowId) || rowId <= 0) {
      return NextResponse.json({ error: "Unknown call" }, { status: 400 });
    }
    const row = await xano.calls.getById(rowId);
    if (!row?.quo_call_id) {
      return NextResponse.json({ error: "Unknown call" }, { status: 404 });
    }
    const recordings = await getCallRecordings(row.quo_call_id);
    const audio =
      recordings.find((r) => r.url && r.status === "completed") ??
      recordings.find((r) => r.url);
    if (audio?.url) return NextResponse.redirect(audio.url, 302);
    if (row.has_voicemail) {
      const voicemail = await getCallVoicemail(row.quo_call_id);
      if (voicemail?.recordingUrl) return NextResponse.redirect(voicemail.recordingUrl, 302);
    }
    return NextResponse.json({ error: "No recording for this call" }, { status: 404 });
  } catch (err) {
    return handleAdminError(err);
  }
}

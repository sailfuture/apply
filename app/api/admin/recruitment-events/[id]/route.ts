import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import {
  normalizeRecruitmentEvent,
  parseRecruitmentEventBody,
} from "@/lib/recruitment-events";

/**
 * One recruitment event.
 *
 *   PATCH  /api/admin/recruitment-events/:id   body: any subset of columns
 *   DELETE /api/admin/recruitment-events/:id
 *
 * PATCH is partial — only the keys sent are written — and empty values
 * clear (the table's endpoint has no empty-value guard), so unsetting
 * the type, un-checking Paid or removing the last file all work.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const id = await eventId(params);
    if (!id) {
      return NextResponse.json({ error: "Invalid event id" }, { status: 400 });
    }
    const body = await req.json().catch(() => null);
    const parsed = parseRecruitmentEventBody(body);
    if ("error" in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    if (Object.keys(parsed).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }
    const row = await xano.recruitmentEvents.update(id, parsed);
    return NextResponse.json({
      ok: true,
      event: normalizeRecruitmentEvent(row),
    });
  } catch (err) {
    return handleAdminError(err);
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const id = await eventId(params);
    if (!id) {
      return NextResponse.json({ error: "Invalid event id" }, { status: 400 });
    }
    await xano.recruitmentEvents.remove(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleAdminError(err);
  }
}

async function eventId(params: Promise<{ id: string }>): Promise<number> {
  const { id } = await params;
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

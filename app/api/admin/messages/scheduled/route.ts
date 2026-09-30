import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano, type XanoScheduledSend } from "@/lib/xano";
import { mintBlastId, parseSendAt, snapshotContacts } from "@/lib/sms/scheduled";

/**
 * Scheduled texts (Parents → Scheduled texts, and "Send later" in the
 * composers).
 *
 *   GET  → { sends } — everything pending, plus the last 30 days of
 *          sent / failed / canceled, newest-due first
 *   POST { yearId, contacts: [{ type, id, name }], body, sendAt,
 *          label?, scope?, eventId? } → the new row
 */
export const dynamic = "force-dynamic";

export interface ScheduledSendsResponse {
  sends: XanoScheduledSend[];
}

const HISTORY_MS = 30 * 86_400_000;
const MAX_BODY = 1600;

export async function GET() {
  try {
    await requireAdmin();
    const cutoff = Date.now() - HISTORY_MS;
    const sends = (await xano.scheduledSends.getAll())
      .filter(
        (s) =>
          s.status === "scheduled" ||
          s.status === "sending" ||
          Math.max(s.send_at, s.sent_at, s.canceled_at, s.created_at) >= cutoff
      )
      .sort((a, b) => b.send_at - a.send_at || b.id - a.id);
    return NextResponse.json({ sends } satisfies ScheduledSendsResponse);
  } catch (err) {
    return handleAdminError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { admin } = await requireAdmin();
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const yearId = Number(body.yearId);
    if (!Number.isFinite(yearId) || yearId <= 0) {
      return NextResponse.json({ error: "A school year is required" }, { status: 400 });
    }
    const contacts = snapshotContacts(body.contacts);
    if (typeof contacts === "string") {
      return NextResponse.json({ error: contacts }, { status: 400 });
    }
    const text = typeof body.body === "string" ? body.body.trim() : "";
    if (!text) {
      return NextResponse.json({ error: "Message body is required" }, { status: 400 });
    }
    if (text.length > MAX_BODY) {
      return NextResponse.json({ error: `Keep the text under ${MAX_BODY} characters` }, { status: 400 });
    }
    const sendAt = parseSendAt(body.sendAt);
    if (typeof sendAt === "string") {
      return NextResponse.json({ error: sendAt }, { status: 400 });
    }
    const eventId = Number(body.eventId);
    const row = await xano.scheduledSends.create({
      send_at: sendAt,
      status: "scheduled",
      label:
        typeof body.label === "string" && body.label.trim()
          ? body.label.trim().slice(0, 120)
          : text.slice(0, 60),
      body: text,
      contacts,
      registration_school_years_id: yearId,
      school_calendar_events_id: Number.isInteger(eventId) && eventId > 0 ? eventId : null,
      scope: typeof body.scope === "string" ? body.scope.slice(0, 20) : "",
      blast_id: mintBlastId(),
      claim_token: "",
      created_by_email: admin.email,
      created_by_name: admin.name,
      updated_by: "",
      sent_at: 0,
      canceled_at: 0,
      canceled_by: "",
      recipients_count: contacts.length,
      sent_count: 0,
      failed_count: 0,
      skipped_count: 0,
      error: "",
    });
    return NextResponse.json(row, { status: 201 });
  } catch (err) {
    return handleAdminError(err);
  }
}

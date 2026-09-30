import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import {
  BLAST_ID_RE,
  GroupSendError,
  parseContacts,
  sendGroupText,
} from "@/lib/sms/group-send";

/**
 * Group SMS blast to an EXPLICIT recipient list, sent now. The compose
 * dialog builds the audience itself (search + multi-select over
 * `/api/admin/messages/group/audience`) and posts exactly who to text:
 *
 *   POST { yearId, contacts: [{ type, id }, …], body, blastId }
 *
 * Reachability, personalization and the blast-id resume live in
 * `sendGroupText` (lib/sms/group-send.ts), shared with the scheduled
 * sends that go out later from the cron.
 */
export const maxDuration = 300;

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

    const contacts = parseContacts(body.contacts);
    if (typeof contacts === "string") {
      return NextResponse.json({ error: contacts }, { status: 400 });
    }

    const text = typeof body.body === "string" ? body.body.trim() : "";
    if (!text) {
      return NextResponse.json({ error: "Message body is required" }, { status: 400 });
    }

    const blastId = typeof body.blastId === "string" ? body.blastId : "";
    if (!BLAST_ID_RE.test(blastId)) {
      return NextResponse.json({ error: "A valid blastId is required" }, { status: 400 });
    }

    const result = await sendGroupText({
      yearId,
      contacts,
      body: text,
      blastId,
      author: { email: admin.email, name: admin.name },
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof GroupSendError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return handleAdminError(err);
  }
}

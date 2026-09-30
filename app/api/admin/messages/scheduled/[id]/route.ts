import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import { parseSendAt, runScheduledSend, snapshotContacts } from "@/lib/sms/scheduled";

/**
 * One scheduled text. Only a row that is still waiting ("scheduled")
 * can be changed; one in flight or already sent can't.
 *
 *   PATCH { body?, sendAt?, contacts? }  → edit, returns the row
 *   PATCH { action: "cancel" }           → status "canceled"
 *   PATCH { action: "send_now" }         → sends immediately, returns
 *                                          the row and the outcome
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_BODY = 1600;

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { admin } = await requireAdmin();
    const { id } = await params;
    const rowId = Number(id);
    if (!Number.isInteger(rowId) || rowId <= 0) {
      return NextResponse.json({ error: "Unknown scheduled text" }, { status: 400 });
    }
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const row = await xano.scheduledSends.getById(rowId);
    if (!row) {
      return NextResponse.json({ error: "Unknown scheduled text" }, { status: 404 });
    }
    if (row.status !== "scheduled") {
      return NextResponse.json(
        {
          error:
            row.status === "sending"
              ? "This text is going out right now and can't be changed."
              : `This text was already ${row.status}.`,
        },
        { status: 409 }
      );
    }
    const by = admin.email || admin.name;

    if (body.action === "cancel") {
      const updated = await xano.scheduledSends.update(rowId, {
        status: "canceled",
        canceled_at: Date.now(),
        canceled_by: by,
        updated_by: by,
      });
      return NextResponse.json(updated);
    }

    if (body.action === "send_now") {
      const outcome = await runScheduledSend(
        { ...row, send_at: Date.now() },
        Date.now()
      );
      const updated = await xano.scheduledSends.getById(rowId);
      return NextResponse.json({ ...(updated ?? row), outcome });
    }

    const patch: Record<string, unknown> = { updated_by: by };
    if (body.body !== undefined) {
      const text = typeof body.body === "string" ? body.body.trim() : "";
      if (!text) return NextResponse.json({ error: "Message body is required" }, { status: 400 });
      if (text.length > MAX_BODY) {
        return NextResponse.json({ error: `Keep the text under ${MAX_BODY} characters` }, { status: 400 });
      }
      patch.body = text;
    }
    if (body.sendAt !== undefined) {
      const sendAt = parseSendAt(body.sendAt);
      if (typeof sendAt === "string") return NextResponse.json({ error: sendAt }, { status: 400 });
      patch.send_at = sendAt;
    }
    if (body.contacts !== undefined) {
      const contacts = snapshotContacts(body.contacts);
      if (typeof contacts === "string") return NextResponse.json({ error: contacts }, { status: 400 });
      patch.contacts = contacts;
      patch.recipients_count = contacts.length;
    }
    if (Object.keys(patch).length === 1) {
      return NextResponse.json({ error: "Nothing to change" }, { status: 400 });
    }
    const updated = await xano.scheduledSends.update(rowId, patch);
    return NextResponse.json(updated);
  } catch (err) {
    return handleAdminError(err);
  }
}

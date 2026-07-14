import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano, type XanoSmsMessage } from "@/lib/xano";
import { sendSms, getFamilyRecipient } from "@/lib/sms/send";

/** One row in the global inbox's conversation list — the latest text
 *  per family plus a needs-reply flag. */
export interface SmsConversation {
  familyId: number;
  familyName: string;
  lastBody: string;
  lastAt: number;
  lastDirection: string;
  messageCount: number;
  /** True when the most recent message is inbound (family texted, no
   *  reply yet) — drives the unread dot in the inbox. */
  needsReply: boolean;
}

/**
 * Admin SMS messages.
 *
 *  - `GET ?familyId=X` — one family's text thread + the recipient
 *    summary (who it goes to, opt-out state), for the family message
 *    drawer.
 *  - `GET` (no familyId) — every message, newest-first, for the global
 *    inbox feed (Phase 3).
 *  - `POST { familyId, body }` — send a manual text to the family's
 *    account-holder phone and log it.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const familyIdParam = req.nextUrl.searchParams.get("familyId");

    if (!familyIdParam) {
      // Global inbox feed — group the flat message log into one
      // conversation per family, keyed on the newest message.
      const [messages, families] = await Promise.all([
        xano.smsMessages.getAll(),
        xano.families.getAll().catch(() => []),
      ]);
      const nameById = new Map(families.map((f) => [f.id, f.family_name]));
      const byFamily = new Map<
        number,
        { last: XanoSmsMessage; count: number }
      >();
      for (const m of messages) {
        const fid = m.registration_families_id;
        if (!fid) continue;
        const existing = byFamily.get(fid);
        if (!existing) {
          byFamily.set(fid, { last: m, count: 1 });
        } else {
          existing.count += 1;
          if (m.created_at > existing.last.created_at) existing.last = m;
        }
      }
      const conversations: SmsConversation[] = [...byFamily.entries()]
        .map(([familyId, { last, count }]) => ({
          familyId,
          familyName:
            (nameById.get(familyId) || "").trim() || `Family #${familyId}`,
          lastBody: last.body,
          lastAt: last.created_at,
          lastDirection: last.direction,
          messageCount: count,
          needsReply: last.direction === "inbound",
        }))
        .sort((a, b) => b.lastAt - a.lastAt);
      return NextResponse.json({ conversations });
    }

    const familyId = Number(familyIdParam);
    if (!Number.isFinite(familyId)) {
      return NextResponse.json(
        { error: "familyId must be a number" },
        { status: 400 }
      );
    }

    const [messages, recipient] = await Promise.all([
      xano.smsMessages.getByFamilyId(familyId),
      getFamilyRecipient(familyId),
    ]);
    return NextResponse.json({ messages, recipient });
  } catch (err) {
    return handleAdminError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { admin } = await requireAdmin();
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 }
      );
    }

    const familyId = Number(body?.familyId);
    if (!Number.isFinite(familyId)) {
      return NextResponse.json(
        { error: "familyId is required" },
        { status: 400 }
      );
    }
    const text = typeof body?.body === "string" ? body.body.trim() : "";
    if (!text) {
      return NextResponse.json(
        { error: "Message body is required" },
        { status: 400 }
      );
    }

    const result = await sendSms({
      familyId,
      body: text,
      template: "manual",
      studentId: body?.studentId ?? null,
      yearId: body?.yearId ?? null,
      author: { email: admin.email, name: admin.name },
    });

    if (!result.ok) {
      // Map the skip/error to an HTTP status + a human message the
      // composer can toast. `opted_out` is a 409 (conflict with a
      // standing state), missing/unconfigured are 422, a real Twilio
      // failure is 502.
      const status =
        result.skipped === "opted_out"
          ? 409
          : result.skipped
            ? 422
            : 502;
      const message =
        result.skipped === "opted_out"
          ? "This family has opted out of text messages."
          : result.skipped === "no_phone"
            ? "No valid phone number on file for this family."
            : result.skipped === "not_configured"
              ? "SMS isn't configured yet (missing Twilio credentials)."
              : (result.error ?? "Failed to send message.");
      return NextResponse.json(
        { error: message, skipped: result.skipped ?? null },
        { status }
      );
    }

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return handleAdminError(err);
  }
}

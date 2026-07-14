import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import { sendSms, getFamilyRecipient } from "@/lib/sms/send";

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
      const messages = await xano.smsMessages.getAll();
      return NextResponse.json({ messages });
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
    const body = await req.json();

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

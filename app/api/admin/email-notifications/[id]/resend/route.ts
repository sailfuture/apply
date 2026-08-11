import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { sendEmail } from "@/lib/emails/send";
import { xano } from "@/lib/xano";

/**
 * Re-send one already-sent email, optionally to a corrected address.
 *
 *   POST /api/admin/email-notifications/[id]/resend
 *     { to: "fixed@address.com" }   → { ok, id }
 *
 * The point is bounce recovery: a parent's address had a typo, the
 * mail hard-bounced, and admin wants the same message delivered to the
 * right place without re-triggering whatever workflow produced it.
 *
 * Sends the STORED html and subject rather than re-rendering the
 * template. The template's inputs (names, dates, amounts) may have
 * moved on since, and the parent should receive the message that was
 * actually written for them — not a regenerated one that says
 * something subtly different.
 *
 * CC is deliberately dropped. dean@ and admissions@ already received
 * the original; the retry exists for the one address that didn't, and
 * re-copying staff on every correction is noise.
 *
 * Writes its own audit row (a new send is a new event), so the log
 * shows both the bounce and the recovery rather than overwriting
 * history.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const { id: idParam } = await params;
    const id = Number(idParam);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const body = await req.json().catch(() => null);
    const toRaw =
      typeof (body as { to?: unknown })?.to === "string"
        ? (body as { to: string }).to.trim()
        : "";

    const row = await xano.emailNotifications.getById(id).catch(() => null);
    if (!row) {
      return NextResponse.json({ error: "Email not found" }, { status: 404 });
    }

    // Fall back to whatever the original went to, so "resend as-is" is
    // a valid action and not a special case.
    const to = toRaw || (row.recipient_emails ?? "").split(",")[0]?.trim() || "";
    if (!isEmail(to)) {
      return NextResponse.json(
        { error: "Enter a valid email address." },
        { status: 400 }
      );
    }

    const html = (row.html ?? "").trim();
    if (!html) {
      return NextResponse.json(
        {
          error:
            "This email's content wasn't stored, so it can't be re-sent. " +
            "Re-trigger it from the family's record instead.",
        },
        { status: 409 }
      );
    }

    const result = await sendEmail({
      to: [to],
      // `cc: []` suppresses the dean@/admissions@ defaults — see above.
      cc: [],
      tag: row.template || "resend",
      familyId: Number(row.registration_families_id) || undefined,
      yearId: Number(row.registration_school_years_id) || undefined,
      content: {
        subject: row.subject ?? "",
        html,
        // Stored rows keep only the HTML part; Resend is happy with
        // an html-only message.
        text: "",
      },
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error ?? "Send failed" },
        { status: 502 }
      );
    }
    return NextResponse.json({ ok: true, id: result.id, to });
  } catch (err) {
    return handleAdminError(err);
  }
}

/** Deliberately permissive — Resend is the real validator. This only
 *  catches the obvious typo (missing @, stray spaces) before spending
 *  an API call. */
function isEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

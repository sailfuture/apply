import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { xano } from "@/lib/xano";

/**
 * Resend webhook — stamps open-tracking events onto the
 * `registration_email_notifications` audit rows so the activity feed
 * can show "Viewed …" on email bubbles.
 *
 * Handled events:
 *   - `email.opened`  → sets `opened_at` (FIRST open only; later
 *     opens are ignored so the stamp stays "first viewed at")
 *   - `email.bounced` → records WHICH recipient bounced and why, and
 *     marks the row failed only when the send genuinely didn't land
 *     for anyone (see `bounceOutcome` below)
 *
 * Everything else (delivered, clicked, complained…) is acknowledged
 * and ignored. Rows are matched by `resend_id` = the event's
 * `data.email_id`.
 *
 * Auth: Resend signs webhooks with Svix. We verify the
 * `svix-signature` HMAC against RESEND_WEBHOOK_SECRET (`whsec_…`) —
 * no secret configured → 503 so Resend retries once it's set. The
 * route is Clerk-exempt via the `/api/webhooks(.*)` matcher in
 * proxy.ts.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[resend webhook] RESEND_WEBHOOK_SECRET not set");
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }

  const payload = await req.text();
  const svixId = req.headers.get("svix-id") ?? "";
  const svixTimestamp = req.headers.get("svix-timestamp") ?? "";
  const svixSignature = req.headers.get("svix-signature") ?? "";
  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 401 });
  }

  // Svix scheme: HMAC-SHA256 over `${id}.${timestamp}.${payload}`
  // keyed with the base64-decoded secret (after the `whsec_` prefix);
  // the header carries space-separated `v1,<base64>` candidates.
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = crypto
    .createHmac("sha256", key)
    .update(`${svixId}.${svixTimestamp}.${payload}`)
    .digest("base64");
  const candidates = svixSignature
    .split(" ")
    .map((part) => part.split(",")[1] ?? "")
    .filter(Boolean);
  const valid = candidates.some((sig) => {
    try {
      return crypto.timingSafeEqual(
        Buffer.from(sig),
        Buffer.from(expected)
      );
    } catch {
      return false; // length mismatch
    }
  });
  if (!valid) {
    return NextResponse.json({ error: "Bad signature" }, { status: 401 });
  }
  // Reject stale timestamps (replay window: 5 minutes).
  const ts = Number(svixTimestamp) * 1000;
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > 5 * 60_000) {
    return NextResponse.json({ error: "Stale timestamp" }, { status: 401 });
  }

  let event: {
    type?: string;
    created_at?: string;
    data?: {
      email_id?: string;
      /** Recipients of the message, not of the bounce. */
      to?: string[] | string;
      /** Resend's bounce detail. `type` is "Permanent" | "Transient"
       *  | "Undetermined"; `subType` narrows it ("General",
       *  "MailboxFull", "Suppressed"…). Both optional — older payload
       *  shapes and some providers omit them. */
      bounce?: {
        type?: string;
        subType?: string;
        message?: string;
        /** Present on some providers — the address that bounced,
         *  which is what admin actually needs. */
        email?: string;
      };
    };
  } | null = null;
  try {
    event = JSON.parse(payload);
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }
  const type = event?.type ?? "";
  const emailId = event?.data?.email_id ?? "";
  if (!emailId || (type !== "email.opened" && type !== "email.bounced")) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  try {
    // Scan-and-match by resend_id — the audit table is small (one row
    // per send) and has no by-resend-id query endpoint.
    const rows = await xano.emailNotifications.getAll();
    const row = rows.find((r) => r.resend_id === emailId);
    if (!row) return NextResponse.json({ ok: true, unmatched: true });

    if (type === "email.opened") {
      if (row.opened_at) {
        return NextResponse.json({ ok: true, already: true });
      }
      const openedAt = event?.created_at
        ? Date.parse(event.created_at) || Date.now()
        : Date.now();
      await xano.emailNotifications.update(row.id, {
        opened_at: openedAt,
      });
      return NextResponse.json({ ok: true, opened: true });
    }

    // email.bounced
    const outcome = bounceOutcome(event?.data, {
      alreadyOpened: Boolean(row.opened_at),
      recipientCount: countRecipients(row.recipient_emails, row.cc_emails),
    });
    await xano.emailNotifications.update(row.id, {
      // Only re-status the row when the bounce means nobody got it.
      // Xano drops keys it doesn't know, and `status` is deliberately
      // omitted (not set to the old value) when we're leaving it be.
      ...(outcome.markFailed ? { status: "failed" } : {}),
      error_message: outcome.message,
    });
    return NextResponse.json({
      ok: true,
      bounced: true,
      markedFailed: outcome.markFailed,
    });
  } catch (err) {
    console.error("[resend webhook] handling failed:", err);
    // 500 → Resend retries with backoff.
    return NextResponse.json({ error: "Handler failed" }, { status: 500 });
  }
}

/** How many addresses the message went to, across To and CC. */
function countRecipients(to: string, cc: string): number {
  return [to, cc]
    .flatMap((s) => (s ?? "").split(","))
    .map((s) => s.trim())
    .filter(Boolean).length;
}

/**
 * What a bounce means for the row's status.
 *
 * A bounce event is per-MESSAGE, not per-recipient: Resend fires one
 * when any single address fails, and our sends carry the parent on To
 * plus dean@ and admissions@ on CC. Flipping the row to failed on any
 * bounce therefore reported "Failed" for messages that had reached —
 * and been read by — two other people. Three rows in the audit log
 * were in exactly that state, marked failed with an `opened_at`
 * stamped minutes earlier.
 *
 * So `status` only moves to failed when the bounce plausibly means
 * nobody received it:
 *
 *   - Already opened → never. An open is proof it reached a real
 *     inbox, whichever recipient it was.
 *   - Transient / undetermined → never. Resend fires these for full
 *     mailboxes, greylisting and deferrals that usually deliver on
 *     retry, and nothing here ever un-fails a row.
 *   - Permanent + multiple recipients → not failed. The others very
 *     likely got it; the message says which address didn't.
 *   - Permanent + single recipient → failed. Nobody got it.
 *
 * The message always records the address and reason either way — that
 * detail was previously discarded in favour of a flat string, so
 * there was no way to tell which of three addresses had died.
 */
export function bounceOutcome(
  data:
    | {
        to?: string[] | string;
        bounce?: {
          type?: string;
          subType?: string;
          message?: string;
          email?: string;
        };
      }
    | undefined,
  ctx: { alreadyOpened: boolean; recipientCount: number }
): { markFailed: boolean; message: string } {
  const bounce = data?.bounce ?? {};
  const kind = (bounce.type ?? "").toLowerCase();
  const permanent = kind === "permanent";
  const address =
    bounce.email ??
    (Array.isArray(data?.to) ? data?.to[0] : data?.to) ??
    "";

  const detail = [bounce.subType, bounce.message].filter(Boolean).join(" — ");
  const label = permanent
    ? "Hard bounce"
    : kind
      ? `${kind[0].toUpperCase()}${kind.slice(1)} bounce`
      : "Bounce";

  const markFailed =
    permanent && !ctx.alreadyOpened && ctx.recipientCount <= 1;

  const suffix = ctx.alreadyOpened
    ? " — message was opened, so it did reach a recipient"
    : !permanent
      ? " — may still deliver on retry"
      : ctx.recipientCount > 1
        ? " — other recipients may still have received it"
        : "";

  return {
    markFailed,
    message:
      `${label}${address ? `: ${address}` : ""}` +
      `${detail ? ` (${detail})` : ""}${suffix}`,
  };
}

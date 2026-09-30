import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  applyCallRecording,
  applyCallSummary,
  applyCallTranscript,
  applyCallVoicemail,
  loadIngestContext,
  upsertQuoCall,
  upsertQuoText,
  type QuoCallInput,
} from "@/lib/quo/ingest";

/**
 * Quo webhook — every text and call on the Main Line, as it happens.
 *
 * Registered with Quo scoped to the Main Line's phone number id
 * (Quo-Api-Version 2026-03-30), so the Faculty Line never reaches
 * this route; the ingest layer checks the number again anyway.
 *
 * Signature: Standard Webhooks. `webhook-signature` holds one or more
 * `v1,<base64>` entries; each is HMAC-SHA256 over
 * `{webhook-id}.{webhook-timestamp}.{raw body}` with the base64 secret
 * behind the `whsec_` prefix. Fails CLOSED in production when the
 * secret isn't set. Timestamps more than five minutes off are refused
 * (replay protection).
 *
 * Quo retries any non-2xx up to 8 times over ~27 hours and may deliver
 * out of order or twice. Every handler is an idempotent upsert keyed
 * on Quo's ids, so a retry or a duplicate changes nothing — which is
 * why an internal failure answers 500: the retry is what fixes a
 * transient Xano blip.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const TOLERANCE_SECONDS = 5 * 60;

function verify(
  req: NextRequest,
  raw: string
): { ok: true } | { ok: false; response: NextResponse } {
  const secret = process.env.QUO_WEBHOOK_SECRET ?? "";
  if (!secret) {
    if (process.env.NODE_ENV !== "production") return { ok: true };
    console.error("[quo webhook] QUO_WEBHOOK_SECRET is not set — rejecting unverifiable webhook.");
    return {
      ok: false,
      response: NextResponse.json({ error: "Webhook auth is not configured" }, { status: 503 }),
    };
  }
  const id = req.headers.get("webhook-id") ?? "";
  const timestamp = req.headers.get("webhook-timestamp") ?? "";
  const signatures = req.headers.get("webhook-signature") ?? "";
  if (!id || !timestamp || !signatures) {
    return { ok: false, response: NextResponse.json({ error: "Missing signature headers" }, { status: 400 }) };
  }
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > TOLERANCE_SECONDS) {
    return { ok: false, response: NextResponse.json({ error: "Stale timestamp" }, { status: 400 }) };
  }
  const key = Buffer.from(secret.startsWith("whsec_") ? secret.slice(6) : secret, "base64");
  const expected = crypto
    .createHmac("sha256", key)
    .update(`${id}.${timestamp}.${raw}`)
    .digest();
  const valid = signatures
    .split(" ")
    .map((entry) => entry.split(",")[1] ?? "")
    .filter(Boolean)
    .some((sig) => {
      const given = Buffer.from(sig, "base64");
      return given.length === expected.length && crypto.timingSafeEqual(given, expected);
    });
  if (!valid) {
    return { ok: false, response: NextResponse.json({ error: "Invalid signature" }, { status: 403 }) };
  }
  return { ok: true };
}

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" ? (v as Rec) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const check = verify(req, raw);
  if (!check.ok) return check.response;

  let event: Rec;
  try {
    event = rec(JSON.parse(raw));
  } catch {
    return NextResponse.json({ error: "Expected JSON" }, { status: 400 });
  }
  const type = str(event.type) ?? "";
  const data = rec(event.data);
  const resource = rec(data.resource);
  const context = rec(data.context);
  const links = rec(data.links);
  const phoneNumberId = str(context.phoneNumberId);
  const conversationId = str(context.conversationId);
  const quoLink = str(links.quo);

  try {
    const ctx = await loadIngestContext();
    let outcome: string = "ignored";

    if (type.startsWith("message.")) {
      const direction = resource.direction === "incoming" ? "incoming" : "outgoing";
      const sender = str(context.senderIdentifier) ?? "";
      const recipient = strArr(context.recipientIdentifiers)[0] ?? "";
      outcome = await upsertQuoText(
        {
          id: str(resource.id) ?? "",
          conversationId,
          phoneNumberId,
          direction,
          text: str(resource.text) ?? "",
          hasMedia: Array.isArray(resource.media) && resource.media.length > 0,
          status: str(resource.status) ?? (direction === "incoming" ? "received" : "sent"),
          createdAt: str(resource.createdAt) ?? new Date().toISOString(),
          from: sender,
          to: recipient,
          userId: str(context.userId),
          errorCode: str(resource.errorCode),
          quoLink,
        },
        ctx
      );
    } else if (type === "call.completed" || type === "call.missed") {
      const participants = rec(context.participants);
      const external = strArr(participants.external)[0] ?? null;
      const input: QuoCallInput = {
        id: str(resource.id) ?? "",
        conversationId,
        phoneNumberId,
        direction: resource.direction === "outgoing" ? "outgoing" : "incoming",
        status: type === "call.missed" ? "missed" : (str(resource.status) ?? "completed"),
        createdAt: str(resource.createdAt) ?? new Date().toISOString(),
        answeredAt: str(resource.answeredAt),
        completedAt: str(resource.completedAt) ?? str(resource.updatedAt),
        duration: typeof resource.duration === "number" ? resource.duration : null,
        // Incoming: only the answering user counts (the context user is
        // the line's user even when nobody picked up). Outgoing: the
        // context user placed the call.
        userId:
          resource.direction === "outgoing"
            ? str(context.userId)
            : str(resource.answeredByUserId),
        counterparty: external,
        hasVoicemail: typeof resource.hasVoicemail === "boolean" ? resource.hasVoicemail : null,
        voicemail: null,
        summary: null,
        quoLink,
      };
      outcome = (await upsertQuoCall(input, ctx)).outcome;
    } else if (type === "call.recording.completed") {
      const recordings = (Array.isArray(resource.recordings) ? resource.recordings : [])
        .map(rec)
        .map((r) => ({
          id: str(r.id) ?? "",
          duration: typeof r.duration === "number" ? r.duration : null,
          status: str(r.status),
        }))
        .filter((r) => r.id);
      outcome = await applyCallRecording(str(resource.id) ?? "", recordings, ctx);
    } else if (type === "call.transcript.completed") {
      const dialogue = (Array.isArray(resource.dialogue) ? resource.dialogue : []).map((l) => {
        const line = rec(l);
        return {
          content: str(line.content) ?? "",
          start: typeof line.start === "number" ? line.start : 0,
          end: typeof line.end === "number" ? line.end : 0,
          identifier: str(line.identifier),
          userId: str(line.userId) ?? str(line.actorId),
        };
      });
      outcome = await applyCallTranscript(str(resource.callId) ?? "", dialogue, ctx);
    } else if (type === "call.summary.completed") {
      outcome = await applyCallSummary(
        str(resource.callId) ?? "",
        strArr(resource.summary),
        strArr(resource.nextSteps),
        ctx
      );
    } else if (type === "call.voicemail.completed") {
      outcome = await applyCallVoicemail(
        str(resource.callId) ?? str(resource.id) ?? "",
        {
          transcript: str(resource.transcript),
          duration: typeof resource.duration === "number" ? resource.duration : null,
        },
        ctx
      );
    }
    // call.ringing / call.answered / call.forwarded / call.menu.selected
    // are in-progress noise: the completed event carries everything.
    return NextResponse.json({ ok: true, type, outcome });
  } catch (err) {
    console.error(`[quo webhook] ${type} failed:`, err);
    return NextResponse.json({ error: "Ingest failed" }, { status: 500 });
  }
}

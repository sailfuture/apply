import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { xano } from "@/lib/xano";
import { getDocumentDownloadUrl } from "@/lib/pandadoc";

/**
 * PandaDoc webhook receiver — the push channel that replaces (most of)
 * the client's status polling. PandaDoc POSTs an array of events; we
 * verify the HMAC signature, then for each document status change map
 * it straight to the owning Xano row via the `metadata` we stamped at
 * create time (family_id / year_id / student_id / doc_type) — no
 * lookup, no dependence on the parent's tab being open.
 *
 * Configure in the PandaDoc dashboard (Settings → API & Webhooks):
 *   - URL: https://<app>/api/webhooks/pandadoc
 *   - Shared key → `PANDADOC_WEBHOOK_SHARED_KEY` in Vercel
 *   - Events: at least `document_state_changed` (+ recipient events)
 *
 * This endpoint is public via the proxy's `/api/webhooks(.*)` rule and
 * authenticates itself with the signature — no Clerk session. The
 * client poll stays as a fallback for environments where the webhook
 * isn't configured; both paths converge on the same row writes and are
 * id-guarded, so they can't fight.
 */
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  const sharedKey = process.env.PANDADOC_WEBHOOK_SHARED_KEY;
  if (!sharedKey) {
    console.error(
      "[/api/webhooks/pandadoc] PANDADOC_WEBHOOK_SHARED_KEY not set — rejecting."
    );
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }

  // PandaDoc signs the raw body with HMAC-SHA256 (shared key) and
  // passes the hex digest as the `signature` query param.
  const provided = req.nextUrl.searchParams.get("signature") ?? "";
  const expected = crypto
    .createHmac("sha256", sharedKey)
    .update(rawBody)
    .digest("hex");
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  if (
    providedBuf.length !== expectedBuf.length ||
    !crypto.timingSafeEqual(providedBuf, expectedBuf)
  ) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let events: unknown;
  try {
    events = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!Array.isArray(events)) {
    return NextResponse.json({ received: true });
  }

  try {
    for (const ev of events as WebhookEvent[]) {
      await handleEvent(ev);
    }
    return NextResponse.json({ received: true });
  } catch (err) {
    // 500 → PandaDoc retries. Better a retry than a silently-dropped
    // completion.
    console.error("[/api/webhooks/pandadoc] handler error:", err);
    return NextResponse.json({ error: "Handler failed" }, { status: 500 });
  }
}

interface WebhookEvent {
  event?: string;
  data?: {
    id?: string;
    status?: string;
    metadata?: Record<string, string | undefined> | null;
  };
}

async function handleEvent(ev: WebhookEvent): Promise<void> {
  const doc = ev.data;
  const documentId = doc?.id;
  const rawStatus = doc?.status;
  const meta = doc?.metadata ?? null;
  if (!documentId || !rawStatus || !meta) return;

  const docType = meta.doc_type;
  const yearId = Number(meta.year_id);
  const familyId = Number(meta.family_id);
  const studentId = Number(meta.student_id);
  if (
    (docType !== "liability_waiver" && docType !== "enrollment_agreement") ||
    !Number.isFinite(yearId)
  ) {
    return;
  }

  const normalizedStatus =
    rawStatus === "document.completed"
      ? "completed"
      : rawStatus === "document.viewed"
        ? "viewed"
        : rawStatus === "document.sent"
          ? "sent"
          : rawStatus === "document.draft"
            ? "draft"
            : rawStatus;

  // Only sync meaningful states — ignore draft/upload churn.
  if (!["completed", "viewed", "sent"].includes(normalizedStatus)) return;
  const wantCompleted = normalizedStatus === "completed";
  const pdfUrl = wantCompleted ? getDocumentDownloadUrl(documentId) : "";

  if (docType === "liability_waiver") {
    if (!Number.isFinite(studentId)) return;
    const packet = await xano.studentRegistration.resolve(studentId, yearId);
    // Id guard — only touch the row that actually stores this envelope.
    if (
      packet.liability_waiver_pandadoc_id &&
      packet.liability_waiver_pandadoc_id !== documentId
    ) {
      return;
    }
    const changed = packet.liability_waiver_status !== normalizedStatus;
    const staleUrl = !wantCompleted && !!packet.liability_waiver_pdf_url;
    if (changed || staleUrl) {
      await xano.studentRegistration.update(packet.id, {
        liability_waiver_status: normalizedStatus,
        liability_waiver_pdf_url: pdfUrl,
      });
    }
    return;
  }

  // enrollment_agreement — family-level progress row.
  if (!Number.isFinite(familyId)) return;
  const progress = await xano.studentRegistrationProgress.resolve(
    familyId,
    yearId
  );
  if (
    progress.enrollment_agreement_pandadoc_id &&
    progress.enrollment_agreement_pandadoc_id !== documentId
  ) {
    return;
  }
  const isLatched =
    progress.is_enrollment_agreement_signed === true ||
    progress.isEnrollment === true ||
    !!progress.enrollment_agreement_pdf_url;
  const changed = progress.enrollment_agreement_status !== normalizedStatus;
  const latchMismatch = wantCompleted !== isLatched;
  if (changed || latchMismatch) {
    await xano.studentRegistrationProgress.update(progress.id, {
      enrollment_agreement_status: normalizedStatus,
      enrollment_agreement_pdf_url: pdfUrl,
      is_enrollment_agreement_signed: wantCompleted,
      isEnrollment: wantCompleted,
    });
  }
}

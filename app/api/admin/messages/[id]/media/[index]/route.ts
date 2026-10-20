import { NextRequest, NextResponse } from "next/server";
import { handleAdminError, requireAdmin } from "@/lib/admin-auth";
import { getMessage } from "@/lib/quo";
import { quoMediaItems } from "@/lib/quo/ingest";
import { smsMedia } from "@/lib/sms/media";
import { xano, type SmsMediaItem } from "@/lib/xano";

/**
 * GET /api/admin/messages/[id]/media/[index]
 *
 * The bytes of one attachment on a text — what the thumbnail in the
 * messenger shows, and what "open" / "download" fetch. The browser
 * only ever sees THIS url: the provider's own url is a credential.
 *
 *   - Quo rows: the stored share.quo.com url is signed. The signature
 *     has outlived three weeks so far, but nothing promises it will,
 *     so the message is re-read from Quo first (GET /v1/messages/{id})
 *     for a fresh url, and the stored one is the fallback when Quo
 *     can't be reached or no longer has it.
 *   - Twilio rows: the api.twilio.com media url needs the account's
 *     basic auth.
 *
 * Streams the upstream body with its content type. Private, cached an
 * hour in the admin's browser so scrolling a thread doesn't re-fetch
 * every photo; a 404 when the row or the index doesn't exist.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; index: string }> }
) {
  try {
    await requireAdmin();
    const { id: idParam, index: indexParam } = await params;
    const id = Number(idParam);
    const index = Number(indexParam);
    if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(index) || index < 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const row = await xano.smsMessages.getById(id);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const stored = smsMedia(row)[index];
    if (!stored) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const upstream = await fetchUpstream(row.provider ?? null, row.quo_message_id ?? null, stored, index);
    if (!upstream) {
      return NextResponse.json(
        { error: "The attachment is no longer available from the phone system" },
        { status: 502 }
      );
    }
    const headers = new Headers();
    headers.set(
      "Content-Type",
      upstream.headers.get("content-type") || stored.type || "application/octet-stream"
    );
    const length = upstream.headers.get("content-length");
    if (length) headers.set("Content-Length", length);
    headers.set("Cache-Control", "private, max-age=3600");
    headers.set("X-Content-Type-Options", "nosniff");
    // Images open inline (the thumbnail's "open in new tab"); anything
    // else is handed to the browser as a download with a sensible name.
    const inline = (headers.get("Content-Type") ?? "").startsWith("image/");
    headers.set(
      "Content-Disposition",
      `${inline ? "inline" : "attachment"}; filename="${filenameFor(stored, index, headers.get("Content-Type") ?? "")}"`
    );
    return new NextResponse(upstream.body, { status: 200, headers });
  } catch (err) {
    return handleAdminError(err);
  }
}

/** The upstream response for the attachment, or null when neither
 *  the fresh nor the stored url answers with the bytes. */
async function fetchUpstream(
  provider: string | null,
  quoMessageId: string | null,
  stored: SmsMediaItem,
  index: number
): Promise<Response | null> {
  if (provider === "quo") {
    // Fresh url first. The item order in Quo's answer is the order the
    // ingest stored, so the same index names the same attachment; a
    // mismatch (Quo reordered, or the row was backfilled from a
    // different read) falls back to the stored url below.
    if (quoMessageId) {
      try {
        const message = await getMessage(quoMessageId);
        const fresh = message ? quoMediaItems(message.media) : [];
        const candidate = fresh[index];
        if (candidate) {
          const res = await fetch(candidate.url, { cache: "no-store" });
          if (res.ok && res.body) return res;
        }
      } catch (err) {
        console.warn(`[messages/media] Quo lookup for ${quoMessageId} failed, using stored url:`, err);
      }
    }
    const res = await fetch(stored.url, { cache: "no-store" }).catch(() => null);
    return res?.ok && res.body ? res : null;
  }

  // Twilio (and legacy rows with no provider): the media url is on
  // api.twilio.com and needs the account's basic auth. Anything that
  // isn't Twilio's host is fetched plainly — never send the token
  // elsewhere.
  const sid = process.env.TWILIO_ACCOUNT_SID ?? "";
  const token = process.env.TWILIO_AUTH_TOKEN ?? "";
  const isTwilioHost = /^https:\/\/([a-z0-9-]+\.)*twilio\.com\//i.test(stored.url);
  const headers: Record<string, string> =
    isTwilioHost && sid && token
      ? { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}` }
      : {};
  const res = await fetch(stored.url, { headers, cache: "no-store", redirect: "follow" }).catch(
    () => null
  );
  return res?.ok && res.body ? res : null;
}

function filenameFor(item: SmsMediaItem, index: number, contentType: string): string {
  const given = (item.name ?? "").replace(/[^\w.\-]+/g, "_");
  if (given) return given;
  const ext = extensionFor(contentType || item.type);
  return `attachment-${index + 1}${ext ? `.${ext}` : ""}`;
}

function extensionFor(type: string): string {
  const t = type.toLowerCase().split(";")[0].trim();
  const known: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/heic": "heic",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "audio/mpeg": "mp3",
    "application/pdf": "pdf",
    "text/vcard": "vcf",
    "text/x-vcard": "vcf",
  };
  return known[t] ?? "";
}

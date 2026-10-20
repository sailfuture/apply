import type { SmsMediaItem, XanoSmsMessage } from "@/lib/xano";

/**
 * Attachments on a text — shared by the ingest paths that write them,
 * the proxy route that serves them, and the bubbles that render them.
 * Safe to import from client components (no secrets, no fetches).
 */

/** The body a photo-only text is logged with — the same words
 *  everywhere a text arrives (Quo webhook, Quo sync, Twilio webhook),
 *  so the UI can recognise "nothing was typed" and show the photo
 *  instead of the words. */
export const MEDIA_ONLY_BODY = "(sent a photo or file)";

/** Body rule for an inbound text: the words when there are any,
 *  otherwise the placeholder when something was attached, otherwise
 *  "(no text)" (Xano trims text and the create() echo-guard needs a
 *  non-empty body). */
export function inboundBody(text: string | null | undefined, hasMedia: boolean): string {
  const words = (text ?? "").trim();
  if (words) return words;
  return hasMedia ? MEDIA_ONLY_BODY : "(no text)";
}

/** The row's attachments as an array, whatever Xano echoed: rows from
 *  before the column read null, a row written without the input can
 *  come back as "" (the json column's default), and anything that
 *  isn't a well-formed item is dropped rather than rendered. */
export function smsMedia(
  row: Pick<XanoSmsMessage, "media"> | null | undefined
): SmsMediaItem[] {
  const raw = row?.media;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (m): m is SmsMediaItem =>
      !!m &&
      typeof m === "object" &&
      typeof (m as SmsMediaItem).url === "string" &&
      (m as SmsMediaItem).url.length > 0
  );
}

/** True when the text carried no words of its own — the body is just
 *  the placeholder the ingest wrote for a bare photo or file. */
export function isMediaOnlyBody(body: string | null | undefined): boolean {
  const b = (body ?? "").trim();
  return b === MEDIA_ONLY_BODY || b === "(no text)";
}

export function isImageMedia(item: Pick<SmsMediaItem, "type">): boolean {
  return (item.type ?? "").toLowerCase().startsWith("image/");
}

/** Short label for a non-image attachment chip: "PDF", "Video", "File". */
export function mediaKindLabel(item: Pick<SmsMediaItem, "type" | "name">): string {
  const type = (item.type ?? "").toLowerCase();
  if (type.startsWith("image/")) return "Photo";
  if (type.startsWith("video/")) return "Video";
  if (type.startsWith("audio/")) return "Audio";
  if (type === "application/pdf") return "PDF";
  if (type.startsWith("text/vcard") || type === "text/x-vcard") return "Contact";
  const ext = (item.name ?? "").split(".").pop();
  if (ext && ext.length <= 4 && item.name?.includes(".")) return ext.toUpperCase();
  return "File";
}

/** What the conversation list shows for a text with attachments and
 *  no words: "Photo", "2 photos", "File", "Photo + file". */
export function mediaPreviewLabel(media: SmsMediaItem[]): string {
  const images = media.filter(isImageMedia).length;
  const files = media.length - images;
  if (images && files) return "Photo + file";
  if (images) return images === 1 ? "Photo" : `${images} photos`;
  return files === 1 ? "File" : `${files} files`;
}

/** The admin proxy URL for one attachment — the only URL the browser
 *  ever sees for media (the provider's signed URL stays server-side). */
export function smsMediaUrl(messageId: number, index: number): string {
  return `/api/admin/messages/${messageId}/media/${index}`;
}

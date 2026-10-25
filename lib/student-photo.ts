/**
 * Helpers for the admin-uploaded student headshot (`student_photo`, a
 * Xano *image* column on `registration_students`).
 *
 * The same photo is pushed to two outside systems — the Toddle LMS
 * profile (lib/toddle-sync.ts) and the student's Google Workspace
 * account photo (lib/google-student-photo.ts) — so resolving the
 * stored metadata blob to a fetchable URL and downloading the bytes
 * lives here, once, rather than in each integration.
 */

/** Pick a fetchable URL out of the Xano image-metadata blob on
 *  `student_photo` — `url` when present, else the public Xano base +
 *  `path`. Mirrors the client-side `resolveFileUrl` on the enrolled
 *  detail page. */
export function resolvePhotoUrl(photo: object | null | undefined): string | null {
  if (!photo || typeof photo !== "object") return null;
  const url = (photo as { url?: unknown }).url;
  if (typeof url === "string" && url.length > 0) return url;
  const path = (photo as { path?: unknown }).path;
  if (typeof path === "string" && path.length > 0) {
    const base =
      process.env.NEXT_PUBLIC_XANO_BASE ??
      "https://xsc3-mvx7-r86m.n7e.xano.io";
    return `${base}${path}`;
  }
  return null;
}

/** Hard cap on what we'll pull down and forward. The card compresses
 *  uploads to ~300KB, so anything near this is a mis-uploaded original
 *  and shouldn't be shipped to a third party in a request body. */
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

/**
 * Download the student photo as raw bytes. Rejects non-image
 * responses (an expired/invalid Xano URL answers with an HTML or JSON
 * error page, not a 404) and anything over the size cap.
 */
export async function fetchImageBytes(
  url: string
): Promise<{ buffer: Buffer; contentType: string }> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`photo fetch failed (${res.status})`);
  }
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType && !contentType.startsWith("image/")) {
    throw new Error(`photo URL returned non-image content (${contentType})`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.byteLength > MAX_PHOTO_BYTES) {
    throw new Error(
      `photo too large to push (${Math.round(buffer.byteLength / 1024 / 1024)}MB > 8MB)`
    );
  }
  return { buffer, contentType };
}

/** Download an image and return it as a plain base64 string (no
 *  data-URI prefix — Toddle's profileImageUpload takes the bare
 *  encoded bytes). */
export async function fetchImageAsBase64(url: string): Promise<string> {
  const { buffer } = await fetchImageBytes(url);
  return buffer.toString("base64");
}

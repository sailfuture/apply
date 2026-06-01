/**
 * Browser-side HEIC/HEIF → JPEG conversion.
 *
 * iPhones default to saving photos as HEIC, which Chrome / Firefox /
 * Edge can't decode or render. We convert at upload time so what
 * actually lands in Xano is a universally viewable JPEG — every
 * downstream surface (view links, inline previews, thumbnails) then
 * works without anyone having to think about format.
 *
 * `heic2any` (libheif compiled to WASM, ~1.5MB) is loaded via dynamic
 * import so its payload only ships to the browser the moment someone
 * actually picks a HEIC file. Normal JPG/PNG/PDF uploads pay nothing.
 *
 * This is a no-op pass-through for any non-HEIC file, so it's safe to
 * call on every file entering an upload pipeline.
 */

/** True when the file looks like HEIC/HEIF by MIME or extension. */
function isHeic(file: File): boolean {
  const type = file.type.toLowerCase();
  if (type === "image/heic" || type === "image/heif") return true;
  // Some browsers/OSes leave the MIME blank for HEIC, so fall back to
  // the extension — case-insensitive, since phones emit `IMG_0001.HEIC`.
  const ext = file.name.split(".").pop()?.toLowerCase();
  return ext === "heic" || ext === "heif";
}

/**
 * Return a JPEG `File` for HEIC/HEIF input, or the original file
 * unchanged for anything else. Throws a user-friendly error if the
 * conversion itself fails (corrupt or unsupported HEIC variant) so the
 * caller's existing upload error handling can surface it.
 */
export async function convertHeicToJpeg(file: File): Promise<File> {
  if (!isHeic(file)) return file;

  try {
    // Dynamic import keeps heic2any out of the main bundle.
    const heic2any = (await import("heic2any")).default;
    const result = await heic2any({
      blob: file,
      toType: "image/jpeg",
      quality: 0.9,
    });
    // heic2any returns Blob | Blob[] (the array form is for multi-image
    // "Live Photo"/burst HEICs); take the primary image.
    const blob = Array.isArray(result) ? result[0] : result;
    const jpegName = file.name.replace(/\.(heic|heif)$/i, "") + ".jpg";
    return new File([blob], jpegName, {
      type: "image/jpeg",
      lastModified: file.lastModified,
    });
  } catch (err) {
    console.error("[convertHeicToJpeg] conversion failed:", err);
    throw new Error(
      "Couldn't convert this HEIC photo. Please export it as JPG or PNG and try again."
    );
  }
}

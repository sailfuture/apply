import type { Options } from "browser-image-compression";

/**
 * Browser-side image compression for student photos. Resizes + re-
 * encodes to keep the stored file small and quick to load — these are
 * display photos shown across the admin roster + detail pages, not
 * archival originals.
 *
 * `browser-image-compression` runs in a Web Worker, honors EXIF
 * orientation, and is dynamically imported so its weight only ships
 * when someone actually uploads a photo. Pair it with the existing
 * HEIC→JPEG step first so iPhone photos compress cleanly.
 */
export async function compressStudentPhoto(file: File): Promise<File> {
  const imageCompression = (await import("browser-image-compression")).default;

  const options: Options = {
    // Cap the long edge + target size. A head-and-shoulders student
    // photo at 1000px / ~300KB is plenty for a roster avatar and a
    // detail-page portrait while keeping storage + load times small.
    maxWidthOrHeight: 1000,
    maxSizeMB: 0.3,
    initialQuality: 0.8,
    fileType: "image/jpeg",
    useWebWorker: true,
  };

  const compressed = await imageCompression(file, options);

  // Normalize to a `.jpg` File so the upload + the stored Xano metadata
  // (filename/extension) stay consistent regardless of the source.
  const baseName = file.name.replace(/\.[^.]+$/, "") || "student-photo";
  return new File([compressed], `${baseName}.jpg`, {
    type: "image/jpeg",
    lastModified: file.lastModified,
  });
}

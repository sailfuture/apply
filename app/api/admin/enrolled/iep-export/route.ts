import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";

/**
 * Batch IEP download — zips the actual IEP documents for an explicit
 * list of students.
 *
 *   POST { studentIds: number[] }  →  application/zip
 *
 * The client (enrolled roster) sends exactly the students it is
 * showing, so the zip respects whatever filters/search the admin has
 * applied. Files come from each student's evergreen `iep` document
 * array (Xano file metadata); each lands in the archive under a
 * `Last, First/` folder with its original filename, deduped with
 * " (2)" suffixes on collisions.
 *
 * Fetching happens server-side straight from the Xano vault URL each
 * metadata blob carries (same resolution the detail pages use
 * client-side). A student whose files all fail to fetch gets a
 * `_errors.txt` note in their folder instead of silently vanishing
 * from the archive.
 */
export const maxDuration = 300;

const MAX_STUDENTS = 200;

/** Vault host — the bare Xano instance root without the `/api:group`
 *  suffix, for metadata blobs that carry only a `path`. */
function vaultBase(): string {
  const base = process.env.XANO_API_BASE_URL ?? "";
  return base.replace(/\/api:[^/]+\/?$/, "");
}

function resolveFileUrl(file: Record<string, unknown>): string | null {
  const url = typeof file.url === "string" ? file.url : "";
  if (url) return url;
  const path = typeof file.path === "string" ? file.path : "";
  if (path) return `${vaultBase()}${path.startsWith("/") ? "" : "/"}${path}`;
  return null;
}

/** Strip characters that break zip paths on Windows extractors. */
function safeName(s: string): string {
  return s.replace(/[\\/:*?"<>|]+/g, "_").trim();
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = await req.json().catch(() => null);
    const rawIds: unknown[] = Array.isArray(body?.studentIds)
      ? body.studentIds
      : [];
    const studentIds = [
      ...new Set(
        rawIds.map((v) => Number(v)).filter((n) => Number.isFinite(n) && n > 0)
      ),
    ];
    if (studentIds.length === 0) {
      return NextResponse.json(
        { error: "studentIds is required" },
        { status: 400 }
      );
    }
    if (studentIds.length > MAX_STUDENTS) {
      return NextResponse.json(
        { error: `Too many students in one request (max ${MAX_STUDENTS})` },
        { status: 400 }
      );
    }

    // One bulk read instead of N getById round-trips.
    const students = await xano.students.getAll();
    const wanted = new Set(studentIds);
    const withIeps = students.filter(
      (s) => wanted.has(s.id) && Array.isArray(s.iep) && s.iep.length > 0
    );
    if (withIeps.length === 0) {
      return NextResponse.json(
        { error: "None of the requested students have IEP documents" },
        { status: 404 }
      );
    }

    const zip = new JSZip();
    let fileCount = 0;

    // Fetch in small batches so a big cohort doesn't fire hundreds of
    // vault requests at once.
    for (let i = 0; i < withIeps.length; i += 5) {
      await Promise.all(
        withIeps.slice(i, i + 5).map(async (s) => {
          const folder = safeName(
            `${(s.last_name ?? "").trim() || "Student"}, ${(s.first_name ?? "").trim() || `#${s.id}`}`
          );
          const used = new Set<string>();
          const errors: string[] = [];
          for (const [idx, file] of (s.iep ?? []).entries()) {
            const url = resolveFileUrl(file);
            const original =
              typeof file.name === "string" && file.name.trim()
                ? file.name.trim()
                : typeof file.path === "string"
                  ? (file.path.split("/").pop() ?? `iep-${idx + 1}`)
                  : `iep-${idx + 1}`;
            let entryName = safeName(original) || `iep-${idx + 1}`;
            let n = 2;
            while (used.has(entryName.toLowerCase())) {
              const dot = entryName.lastIndexOf(".");
              entryName =
                dot > 0
                  ? `${entryName.slice(0, dot)} (${n})${entryName.slice(dot)}`
                  : `${entryName} (${n})`;
              n++;
            }
            if (!url) {
              errors.push(`${original}: no url/path on file metadata`);
              continue;
            }
            try {
              const res = await fetch(url);
              if (!res.ok) {
                errors.push(`${original}: fetch failed (${res.status})`);
                continue;
              }
              const bytes = await res.arrayBuffer();
              used.add(entryName.toLowerCase());
              zip.file(`${folder}/${entryName}`, bytes);
              fileCount++;
            } catch {
              errors.push(`${original}: fetch threw`);
            }
          }
          if (errors.length > 0) {
            zip.file(
              `${folder}/_errors.txt`,
              `Some IEP files could not be fetched:\n${errors.join("\n")}\n`
            );
          }
        })
      );
    }

    if (fileCount === 0) {
      return NextResponse.json(
        { error: "No IEP files could be fetched from storage" },
        { status: 502 }
      );
    }

    const buffer = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="iep-documents.zip"',
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return handleAdminError(err);
  }
}

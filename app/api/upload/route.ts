import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

/**
 * Resolve the Xano upload endpoint. We accept the URL via the explicit
 * `XANO_UPLOAD_URL` env var, OR derive it from `XANO_API_BASE_URL` —
 * Xano's standard "upload attachment" endpoint always lives at
 * `${api-base}/upload/attachment`, so deriving it removes a foot-gun
 * where someone configures the api base but forgets to add the upload
 * one. Production envs that already have an explicit override still
 * win.
 *
 * `kind: "image"` targets Xano's `/upload/image` endpoint instead —
 * it validates the upload is an image and returns image metadata
 * (with `meta.width`/`meta.height`), which is what an Xano *image*
 * column expects. Image uploads always derive from the API base; the
 * explicit `XANO_UPLOAD_URL` override is attachment-specific.
 */
function resolveUploadUrl(kind: "attachment" | "image"): string | null {
  const apiBase = process.env.XANO_API_BASE_URL?.trim();
  if (kind === "image") {
    return apiBase ? `${apiBase.replace(/\/+$/, "")}/upload/image` : null;
  }
  const explicit = process.env.XANO_UPLOAD_URL?.trim();
  if (explicit) return explicit;
  if (apiBase) return `${apiBase.replace(/\/+$/, "")}/upload/attachment`;
  return null;
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // `?kind=image` routes to Xano's image-upload endpoint (used by the
  // student-photo upload); everything else uploads as an attachment.
  const kind =
    req.nextUrl.searchParams.get("kind") === "image" ? "image" : "attachment";
  const uploadUrl = resolveUploadUrl(kind);
  if (!uploadUrl) {
    return NextResponse.json(
      {
        error:
          "Upload not configured: set XANO_UPLOAD_URL (or XANO_API_BASE_URL, which we'll append /upload/attachment to) in the server env, then restart the Next dev server.",
      },
      { status: 500 }
    );
  }

  const formData = await req.formData();
  const file = formData.get("file");
  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const filename =
    file instanceof File ? file.name : "upload";

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const blob = new Blob([buffer], { type: file.type || "application/octet-stream" });

  const xanoForm = new FormData();
  xanoForm.append("content", blob, filename);

  const res = await fetch(uploadUrl, {
    method: "POST",
    body: xanoForm,
  });

  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json(
      { error: `Xano upload failed (${res.status}): ${text}` },
      { status: res.status }
    );
  }

  const metadata = await res.json();
  return NextResponse.json(metadata);
}

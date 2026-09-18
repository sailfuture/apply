import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";

/**
 * One campus-visit waiver's signature, served as an image.
 *
 *   GET /api/admin/campus-visits/[id]/signature → image/png (or a
 *   redirect to the Xano-hosted file), 404 when none was captured.
 *
 * Why this exists: the waiver LIST endpoint used to carry every
 * signature as a base64 PNG in `signature_image` — 3.0 MB of a 3.1 MB
 * payload that twelve admin routes read just to resolve contact
 * names (audit 2026-09-18). The list no longer returns that column;
 * the one place that shows a signature (the campus-visits detail
 * sheet) loads it here, one row at a time, only when opened.
 *
 * The column holds either a data URL (what the marketing-site form
 * submits) or a Xano file object on older rows — both are handled.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const { id: idParam } = await params;
    const id = Number(idParam);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const waiver = await xano.websiteWaivers.getById(id);
    if (!waiver) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const sig = waiver.signature_image;

    if (typeof sig === "string") {
      const m = sig.match(/^data:([a-z0-9.+/-]+);base64,(.+)$/i);
      if (!m) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      return new Response(Buffer.from(m[2], "base64"), {
        status: 200,
        headers: {
          "Content-Type": m[1],
          // A signature never changes once captured; let the browser
          // keep it for the session without re-hitting Xano.
          "Cache-Control": "private, max-age=3600",
        },
      });
    }

    if (sig && typeof sig === "object") {
      const host = (process.env.XANO_API_BASE_URL ?? "").replace(
        /\/api:[^/]+\/?$/,
        ""
      );
      const url = sig.url ?? (sig.path && host ? `${host}${sig.path}` : null);
      if (url) return NextResponse.redirect(url, 302);
    }

    return NextResponse.json({ error: "Not found" }, { status: 404 });
  } catch (err) {
    return handleAdminError(err);
  }
}
